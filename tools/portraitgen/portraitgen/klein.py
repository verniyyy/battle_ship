"""Instruction editing with FLUX.2 [klein] 4B (Apache-2.0, 4-step distilled).

Its text encoder (Qwen3 4B) and transformer are ~8GB each, together more
than a 15GB T4 holds. So they take turns: encode() loads only the text
encoder, embeds every instruction up front and frees it; load() then
brings in the transformer and VAE, and edit() works from the embeddings.

The weights are bfloat16. A T4 has no bfloat16 units and emulates them,
which is slower but numerically safe; float16 is faster, but the model was
not trained for its narrower range and may overflow (black or noisy output).
"""

from __future__ import annotations

import gc

import torch
from PIL import Image

KLEIN = "black-forest-labs/FLUX.2-klein-4B"


class Klein:
    def __init__(self, model_id: str = KLEIN, device: str = "cuda", dtype: torch.dtype = torch.bfloat16):
        self.model_id, self.device, self.dtype = model_id, device, dtype
        self.pipe = None

    @torch.no_grad()
    def encode(self, prompts: list[str]) -> dict[str, torch.Tensor]:
        """Embeddings of each prompt, kept on the CPU until edit() needs them."""
        from diffusers import Flux2KleinPipeline

        self.unload()
        p = Flux2KleinPipeline.from_pretrained(self.model_id, transformer=None, vae=None, torch_dtype=self.dtype)
        p.text_encoder.to(self.device)
        out = {}
        for prompt in dict.fromkeys(prompts):
            embeds, _ = p.encode_prompt(prompt, device=self.device)
            out[prompt] = embeds.cpu()
        del p
        _release()
        return out

    def load(self) -> None:
        from diffusers import Flux2KleinPipeline

        if self.pipe is None:
            self.pipe = Flux2KleinPipeline.from_pretrained(self.model_id, text_encoder=None, tokenizer=None, torch_dtype=self.dtype).to(self.device)
            self.pipe.set_progress_bar_config(disable=True)

    def unload(self) -> None:
        self.pipe = None
        _release()

    @torch.no_grad()
    def edit(self, image: Image.Image, embeds: torch.Tensor, seed: int, steps: int = 4) -> Image.Image:
        """Edit image as the embedded instruction says; the result has its size."""
        self.load()
        _release()
        out = self.pipe(
            image=image.convert("RGB"),
            prompt_embeds=embeds.to(self.device, self.dtype),
            num_inference_steps=steps,
            guidance_scale=1.0,  # distilled: guidance is baked in
            generator=torch.Generator(self.device).manual_seed(int(seed)),
        ).images[0]
        # The pipeline rounds the size down to a multiple of 16.
        return out if out.size == image.size else out.resize(image.size, Image.LANCZOS)

    def memory_report(self) -> str:
        if not torch.cuda.is_available():
            return str(self.dtype)
        used = torch.cuda.memory_allocated() / 2**30
        total = torch.cuda.get_device_properties(0).total_memory / 2**30
        return f"{str(self.dtype).replace('torch.', '')}; VRAM {used:.1f} / {total:.1f} GiB"


def _release() -> None:
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
