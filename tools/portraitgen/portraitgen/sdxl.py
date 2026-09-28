"""SDXL passes: base render, hires refine and region detailing.

Full-body art at SDXL's native ~1MP leaves the face around 100px tall and a
buckle or a sword guard a dozen pixels wide, where the model can only smear.
Every pass after the first exists to give each part more pixels:

1. render the composition at native resolution (cheap, so many seeds can be
   tried and filtered)
2. hires: upscale 1.5x with Real-ESRGAN and img2img at low strength, so the
   model redraws fine detail without changing the composition
3. tiles: repaint the figure in overlapping squares blown up to 1024px, so
   clothes, trim and the weapon are drawn at about 2x again
4. detailers: the same for the face and each hand, with prompts written for
   just what is in the crop
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

# Fewer out-of-memory errors from fragmentation when pass sizes alternate
# (832x1216 renders, 1248x1824 refines, 1024^2 details). Only takes effect
# before CUDA is initialised, which importing this module precedes.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import math

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFilter

from .detect import Box

DEFAULT_MODEL = "John6666/wai-nsfw-illustrious-sdxl-v150-sdxl"
# The stock SDXL VAE overflows in fp16 and decodes to black/NaN images.
FP16_VAE = "madebyollin/sdxl-vae-fp16-fix"
# Illustrious models burn in contrast and saturation above ~5.5; lower keeps
# the soft, even rendering of official character art.
CFG = 5.0


@dataclass
class Embeds:
    prompt: torch.Tensor
    pooled: torch.Tensor
    negative: torch.Tensor
    negative_pooled: torch.Tensor

    def kwargs(self) -> dict:
        return dict(
            prompt_embeds=self.prompt,
            pooled_prompt_embeds=self.pooled,
            negative_prompt_embeds=self.negative,
            negative_pooled_prompt_embeds=self.negative_pooled,
        )


class Generator:
    def __init__(
        self,
        model_id: str = DEFAULT_MODEL,
        vae_id: str | None = FP16_VAE,
        device: str = "cuda",
        dtype: torch.dtype = torch.float16,
        upscaler: bool = True,
    ):
        from diffusers import (
            AutoencoderKL,
            EulerAncestralDiscreteScheduler,
            StableDiffusionXLImg2ImgPipeline,
            StableDiffusionXLInpaintPipeline,
            StableDiffusionXLPipeline,
        )

        extra = {}
        if vae_id:
            extra["vae"] = AutoencoderKL.from_pretrained(vae_id, torch_dtype=dtype)
        self.txt2img = StableDiffusionXLPipeline.from_pretrained(model_id, torch_dtype=dtype, add_watermarker=False, **extra)
        # Euler a is what Illustrious-family models are tuned and sampled with.
        self.txt2img.scheduler = EulerAncestralDiscreteScheduler.from_config(self.txt2img.scheduler.config)
        self.txt2img.vae.enable_tiling()  # hires decode would not fit a T4 otherwise
        self.txt2img.set_progress_bar_config(disable=True)
        # Same weights, different entry points. from_pipe casts the shared
        # modules to float32 unless told the dtype, which would double SDXL
        # to ~13GB in place and run a 15GB T4 out of memory.
        self.img2img = StableDiffusionXLImg2ImgPipeline.from_pipe(self.txt2img, torch_dtype=dtype)
        self.inpaint = StableDiffusionXLInpaintPipeline.from_pipe(self.txt2img, torch_dtype=dtype)
        for p in (self.img2img, self.inpaint):
            p.set_progress_bar_config(disable=True)
        # Belt and braces for other diffusers/transformers versions.
        for name in ("unet", "vae", "text_encoder", "text_encoder_2"):
            getattr(self.txt2img, name).to(device=device, dtype=dtype)
        self.device = device
        if upscaler:
            from .upscale import Upscaler

            self.upscaler = Upscaler(device, dtype)
        else:
            self.upscaler = None
        self._embeds: dict[tuple[str, str], Embeds] = {}

    def memory_report(self) -> str:
        p = self.txt2img
        dtypes = ", ".join(f"{n} {getattr(p, n).dtype}".replace("torch.", "") for n in ("unet", "vae", "text_encoder", "text_encoder_2"))
        if not torch.cuda.is_available():
            return dtypes
        used = torch.cuda.memory_allocated() / 2**30
        total = torch.cuda.get_device_properties(0).total_memory / 2**30
        return f"{dtypes}; VRAM {used:.1f} / {total:.1f} GiB"

    # ---- prompts ----

    def embed(self, prompt: str, negative: str) -> Embeds:
        """Encode prompts of any length (CLIP stops at 77 tokens).

        Long prompts are split into 75-token chunks at tag boundaries, each
        encoded separately and concatenated, the way A1111/ComfyUI do it; the
        negative is padded to the same number of chunks.
        """
        key = (prompt, negative)
        if key not in self._embeds:
            p = self.txt2img
            pos, neg = _chunks(p.tokenizer, prompt), _chunks(p.tokenizer, negative)
            n = max(len(pos), len(neg))
            pos += [[]] * (n - len(pos))
            neg += [[]] * (n - len(neg))
            pe, pp = self._encode(pos)
            ne, np_ = self._encode(neg)
            self._embeds[key] = Embeds(pe, pp, ne, np_)
        return self._embeds[key]

    @torch.no_grad()
    def _encode(self, chunks: list[list[str]]) -> tuple[torch.Tensor, torch.Tensor]:
        p = self.txt2img
        per_encoder, pooled = [], None
        for tok, enc in ((p.tokenizer, p.text_encoder), (p.tokenizer_2, p.text_encoder_2)):
            hidden = []
            for i, tags in enumerate(chunks):
                ids = tok(", ".join(tags), padding="max_length", max_length=tok.model_max_length, truncation=True, return_tensors="pt").input_ids.to(self.device)
                out = enc(ids, output_hidden_states=True)
                hidden.append(out.hidden_states[-2])
                if enc is p.text_encoder_2 and i == 0:
                    pooled = out[0]  # text_embeds of the projection model
            per_encoder.append(torch.cat(hidden, dim=1))
        embeds = torch.cat(per_encoder, dim=-1).to(p.unet.dtype)
        return embeds, pooled.to(p.unet.dtype)

    # ---- passes ----

    def render(self, embeds: Embeds, seed: int, width: int, height: int, steps: int = 28, cfg: float = CFG) -> Image.Image:
        self._release()
        return self.txt2img(
            **embeds.kwargs(),
            width=width,
            height=height,
            num_inference_steps=steps,
            guidance_scale=cfg,
            generator=self._rng(seed),
        ).images[0]

    def refine(self, image: Image.Image, embeds: Embeds, seed: int, scale: float = 1.5, strength: float = 0.35, steps: int = 28, cfg: float = CFG) -> Image.Image:
        w, h = _mult8(image.width * scale), _mult8(image.height * scale)
        self._release()
        if self.upscaler:
            big = self.upscaler(image, (w, h))
        else:
            big = image.convert("RGB").resize((w, h), Image.LANCZOS)
        self._release()
        return self.img2img(
            **embeds.kwargs(),
            image=big,
            strength=strength,
            num_inference_steps=steps,
            guidance_scale=cfg,
            generator=self._rng(seed),
        ).images[0]

    def detail(
        self,
        image: Image.Image,
        boxes: list[Box],
        embeds: Embeds,
        seed: int,
        strength: float = 0.4,
        context: float = 2.2,
        size: int = 1024,
        steps: int = 28,
        cfg: float = CFG,
        grow: float = 1.3,
    ) -> Image.Image:
        """Repaint each box at size×size under an elliptic mask and paste it back."""
        out = image.convert("RGB").copy()
        for i, box in enumerate(boxes):
            crop = square_around(box, context, out.size)
            region = out.crop(crop).resize((size, size), Image.LANCZOS)
            k = size / (crop[2] - crop[0])
            local = tuple((v - o) * k for v, o in zip(box, (crop[0], crop[1], crop[0], crop[1])))
            mask = feathered_mask((size, size), local, grow=grow, blur=size / 40)
            out = self._repaint(out, crop, region, mask, embeds, seed + 7919 * (i + 1), strength, size, steps, cfg)
        return out

    def tiles(
        self,
        image: Image.Image,
        boxes: list[Box],
        embeds: Embeds,
        seed: int,
        strength: float = 0.3,
        size: int = 1024,
        steps: int = 28,
        cfg: float = CFG,
        overlap: float = 0.25,
    ) -> Image.Image:
        """Repaint square tiles (from grid) at size×size, blending their overlaps."""
        out = image.convert("RGB").copy()
        mask = feathered_rect((size, size), inset=size * overlap / 4, blur=size * overlap / 6)
        for i, crop in enumerate(boxes):
            crop = tuple(int(v) for v in crop)
            region = out.crop(crop).resize((size, size), Image.LANCZOS)
            out = self._repaint(out, crop, region, mask, embeds, seed + 104729 * (i + 1), strength, size, steps, cfg)
        return out

    def _repaint(self, out, crop, region, mask, embeds, seed, strength, size, steps, cfg) -> Image.Image:
        self._release()
        painted = self.inpaint(
            **embeds.kwargs(),
            image=region,
            mask_image=mask,
            strength=strength,
            width=size,
            height=size,
            num_inference_steps=steps,
            guidance_scale=cfg,
            generator=self._rng(seed),
        ).images[0]
        back = crop[2] - crop[0]
        out.paste(painted.resize((back, back), Image.LANCZOS), crop[:2], mask.resize((back, back), Image.LANCZOS))
        return out

    def _release(self) -> None:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _rng(self, seed: int) -> torch.Generator:
        return torch.Generator(self.device).manual_seed(int(seed))


# ---- helpers (pure, tested on CPU) ----


def _mult8(v: float) -> int:
    return int(round(v / 8)) * 8


def _tags(prompt: str) -> list[str]:
    return [t.strip() for t in re.split(r",", prompt) if t.strip()]


def _chunks(tokenizer, prompt: str, limit: int = 75) -> list[list[str]]:
    """Greedily pack comma-separated tags into chunks of at most limit tokens."""
    chunks: list[list[str]] = [[]]
    used = 0
    for tag in _tags(prompt):
        n = len(tokenizer(tag, add_special_tokens=False).input_ids) + 1  # + the comma
        if used + n > limit and chunks[-1]:
            chunks.append([])
            used = 0
        chunks[-1].append(tag)
        used += n
    return chunks


def square_around(box: Box, context: float, size: tuple[int, int], minimum: int = 192) -> tuple[int, int, int, int]:
    """A square crop centred on box, context times its longer side, kept inside the image."""
    w, h = size
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    side = int(min(max(max(box[2] - box[0], box[3] - box[1]) * context, minimum), w, h))
    x0 = int(np.clip(cx - side / 2, 0, w - side))
    y0 = int(np.clip(cy - side / 2, 0, h - side))
    return x0, y0, x0 + side, y0 + side


def feathered_mask(size: tuple[int, int], box: Box, grow: float = 1.3, blur: float = 24) -> Image.Image:
    """White ellipse over box (grown about its centre), blurred at the edge."""
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    rx, ry = (box[2] - box[0]) * grow / 2, (box[3] - box[1]) * grow / 2
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur))


def feathered_rect(size: tuple[int, int], inset: float, blur: float) -> Image.Image:
    """White rectangle inset from the edges, blurred, so tiles fade into their neighbours."""
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rectangle((inset, inset, size[0] - inset, size[1] - inset), fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur))


def grid(body: Box, size: tuple[int, int], tile: int, overlap: float = 0.25) -> list[tuple[int, int, int, int]]:
    """Square tiles of side tile covering body, overlapping by overlap, inside the image."""
    w, h = size
    tile = min(tile, w, h)
    step = tile * (1 - overlap)

    def starts(lo: float, hi: float, limit: int) -> list[int]:
        n = max(1, math.ceil((hi - lo - tile) / step) + 1)
        if n == 1:
            first = last = (lo + hi - tile) / 2
        else:
            first, last = lo, hi - tile
        return [int(np.clip(round(v), 0, limit - tile)) for v in np.linspace(first, last, n)]

    xs, ys = starts(body[0], body[2], w), starts(body[1], body[3], h)
    return [(x, y, x + tile, y + tile) for y in ys for x in xs]
