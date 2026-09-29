"""Staged illustrations: a finished portrait set in a backdrop of light and effects.

Portraits are generated without effects or scenery, which came out mangled
when drawn together with the figure, so rarity barely shows in them. For
showcase screens high-rarity cards get a staged version instead: the
cut-out is placed on a canvas lit in the card's colour, FLUX.2 [klein] 4B
edits that into a scene from an instruction, and the untouched cut-out is
laid back on top, so the character stays exactly the finished portrait.

klein redraws the figure too (hair colour, face and costume drift), which
is why only its backdrop is kept. What survives around the silhouette is
the light it cast on the figure, which reads as a rim glow or aura.

paint:  render seeds scenes per card at SDXL's size into
        stage/<card>/<seed>.png, each ranked by the aesthetic score of its
        composite. The glow of the guide moves with the seed; the edit
        otherwise comes out nearly the same whatever the seed.
export: take the chosen scene, upscale it, dim its edges so the figure
        stands out, lay the full-resolution portrait on top and save
        final/staged/<card>.webp with its metadata; run.pack ships them.
"""

from __future__ import annotations

import json
import random
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from . import detect
from .run import HEIGHT, WIDTH, Job

# Figure height as a share of the canvas, and the gap under its feet.
FIGURE = 0.84
FLOOR = 0.03
NAVY = (12, 22, 40)
# The exported illustration: 1.5x the painted scene, so the portrait
# (up to 1600px tall) goes on top at about its own resolution.
OUT_SIZE = (WIDTH * 3 // 2, HEIGHT * 3 // 2)


def staged(jobs: list[Job]) -> list[Job]:
    return [j for j in jobs if j.stage_instruction]


def portrait(work: str | Path, card: str) -> Image.Image | None:
    f = Path(work) / "final" / f"{card}.webp"
    return Image.open(f).convert("RGBA") if f.exists() else None


# ---- composition (pure, tested on CPU) ----


def placement(cut: tuple[int, int], size: tuple[int, int] = (WIDTH, HEIGHT), figure: float = FIGURE, floor: float = FLOOR) -> tuple[int, int, int, int]:
    """(x, y, w, h) of the cut-out scaled to figure x canvas height, centred, feet floor above the bottom."""
    w, h = size
    k = min(figure * h / cut[1], 0.96 * w / cut[0])
    fw, fh = max(1, round(cut[0] * k)), max(1, round(cut[1] * k))
    return (w - fw) // 2, round(h * (1 - floor)) - fh, fw, fh


def place(cut: Image.Image, size: tuple[int, int] = (WIDTH, HEIGHT), figure: float = FIGURE, floor: float = FLOOR) -> Image.Image:
    x, y, fw, fh = placement(cut.size, size, figure, floor)
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    layer.alpha_composite(cut.resize((fw, fh), Image.LANCZOS), (x, y))
    return layer


def guide(size: tuple[int, int], color: str, center: tuple[float, float] = (0.5, 0.38)) -> Image.Image:
    """Dark navy lit by a soft glow of color behind the upper body.

    klein edits from this rather than from a flat background, so the scene
    it paints is lit from behind the figure in the card's colour.
    """
    w, h = size
    rgb = np.array(_hex(color), dtype=np.float32)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.hypot((x - center[0] * w) / w, (y - center[1] * h) / w)
    glow = np.clip(1 - d / 0.75, 0, 1) ** 1.6
    base = np.array(NAVY, dtype=np.float32) * (0.6 + 0.4 * y[..., None] / h)
    out = base * (1 - glow[..., None]) + (rgb * 0.55 + 255 * 0.45 * glow[..., None] ** 3) * glow[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def glow_center(seed: int) -> tuple[float, float]:
    """Where the guide glows for a seed: somewhere behind the head and shoulders."""
    r = random.Random(seed)
    return 0.5 + r.uniform(-0.18, 0.18), 0.38 + r.uniform(-0.12, 0.06)


def vignette(scene: Image.Image, strength: float) -> Image.Image:
    """Darken the scene a little everywhere and towards its corners by up to strength.

    A bright sky behind a pale costume washes the figure out; dimming only
    the backdrop (the figure goes on top afterwards) keeps the figure the
    brightest part of the picture. The centre is dimmed too, since that is
    where the sky meets the hair.
    """
    if strength <= 0:
        return scene
    w, h = scene.size
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.hypot((x / w - 0.5) / 0.5, (y / h - 0.45) / 0.55)
    t = np.clip((d - 0.35) / 0.9, 0, 1)
    k = 1 - strength * (0.35 + 0.65 * t * t * (3 - 2 * t))
    arr = np.asarray(scene.convert("RGB"), dtype=np.float32) * k[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).round().astype(np.uint8), "RGB")


def composite(scene: Image.Image, layer: Image.Image) -> Image.Image:
    out = scene.convert("RGBA").resize(layer.size)
    out.alpha_composite(layer)
    return out.convert("RGB")


def _hex(color: str) -> tuple[int, int, int]:
    c = (color or "#8899bb").lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


# ---- paint (GPU) ----


def _dir(work: str | Path, card: str) -> Path:
    return Path(work) / "stage" / card


def candidates(work: str | Path, card: str) -> list[tuple[int, dict]]:
    """(seed, report) of every painted scene, best first."""
    d = _dir(work, card)
    out = [(int(f.stem), json.loads(f.read_text())) for f in d.glob("*.json") if f.stem.isdigit()] if d.exists() else []
    return sorted(out, key=lambda c: -c[1]["aesthetic"])


def best(work: str | Path, card: str) -> int | None:
    cands = candidates(work, card)
    return cands[0][0] if cands else None


def paint(klein, jobs: list[Job], work: str | Path, seeds: int = 4, seed_offset: int = 0, steps: int = 4, size: tuple[int, int] = (WIDTH, HEIGHT), redo: bool = False, log=print) -> None:
    """klein paints seeds scenes around each card's portrait (painted ones are skipped)."""
    todo = []
    for job in staged(jobs):
        cut = portrait(work, job.id)
        if cut is None:
            log(f"{job.id}: no finished portrait in final/; run the finish step first")
            continue
        first = job.seed + seed_offset
        missing = [s for s in range(first, first + seeds) if redo or not (_dir(work, job.id) / f"{s}.json").exists()]
        if missing:
            todo.append((job, place(cut, size), missing))
    if not todo:
        return
    t = time.time()
    embeds = klein.encode([job.stage_instruction for job, _, _ in todo])
    log(f"instructions encoded ({time.time() - t:.0f}s)")
    for job, layer, missing in todo:
        d = _dir(work, job.id)
        d.mkdir(parents=True, exist_ok=True)
        for seed in missing:
            t = time.time()
            base = composite(guide(layer.size, job.color, glow_center(seed)), layer)
            scene = klein.edit(base, embeds[job.stage_instruction], seed, steps=steps)
            scene.save(d / f"{seed}.png")
            score = detect.aesthetic(composite(scene, layer))
            (d / f"{seed}.json").write_text(json.dumps({"aesthetic": round(score, 3)}))
            log(f"{job.id} seed {seed}: aesthetic {score:.2f} ({time.time() - t:.0f}s)")


# ---- export ----


def export(jobs: list[Job], work: str | Path, picks: dict[str, int] | None = None, upscaler=None, dim: float = 0.3, size: tuple[int, int] = OUT_SIZE, redo: bool = False, log=print) -> None:
    """Lay each card's portrait over its chosen scene into final/staged/<card>.webp.

    The scene is enlarged with upscaler(image, size) (Real-ESRGAN in the
    notebook; Lanczos when None) and the portrait is placed at size itself,
    so the figure keeps its full resolution.
    """
    work = Path(work)
    out = work / "final" / "staged"
    out.mkdir(parents=True, exist_ok=True)
    picks = picks or {}
    for job in staged(jobs):
        seed = picks.get(job.id) or best(work, job.id)
        cut = portrait(work, job.id)
        if seed is None or cut is None:
            log(f"{job.id}: nothing painted yet; run the paint step first")
            continue
        meta_path = out / f"{job.id}.json"
        settings = {"seed": seed, "dim": dim}
        if meta_path.exists() and not redo and {k: json.loads(meta_path.read_text()).get(k) for k in settings} == settings:
            continue
        scene = Image.open(_dir(work, job.id) / f"{seed}.png").convert("RGB")
        scene = upscaler(scene, size) if upscaler else scene.resize(size, Image.LANCZOS)
        img = composite(vignette(scene, dim), place(cut, size))
        img.save(out / f"{job.id}.webp", quality=90, method=6)
        meta = {**settings, "w": img.width, "h": img.height, "face": _face(work, job.id, cut.size, size)}
        meta_path.write_text(json.dumps(meta))
        log(f"{job.id}: staged illustration from seed {seed}")


def _face(work: Path, card: str, cut: tuple[int, int], size: tuple[int, int]) -> list[float] | None:
    """The portrait's face box, as fractions of the staged illustration."""
    face = json.loads((work / "final" / f"{card}.json").read_text()).get("face")
    if not face:
        return None
    x, y, fw, fh = placement(cut, size)
    return [round((x + face[0] * fw) / size[0], 4), round((y + face[1] * fh) / size[1], 4), round((x + face[2] * fw) / size[0], 4), round((y + face[3] * fh) / size[1], 4)]


# ---- review ----


def sheet(work: str | Path, card: str, thumb: int = 420) -> Image.Image | None:
    """Every scene of a card composited with its portrait, best first, the exported one outlined."""
    cands = candidates(work, card)
    cut = portrait(work, card)
    if not cands or cut is None:
        return None
    meta = Path(work) / "final" / "staged" / f"{card}.json"
    chosen = json.loads(meta.read_text())["seed"] if meta.exists() else None
    tw = int(thumb * WIDTH / HEIGHT)
    layer = place(cut, (tw, thumb))
    out = Image.new("RGB", (tw * len(cands), thumb + 22), NAVY)
    d = ImageDraw.Draw(out)
    for i, (seed, r) in enumerate(cands):
        scene = Image.open(_dir(work, card) / f"{seed}.png").convert("RGB").resize((tw, thumb), Image.LANCZOS)
        out.paste(composite(scene, layer), (i * tw, 22))
        d.text((i * tw + 6, 5), f"{seed}  {r['aesthetic']:.2f}" + ("  <- export" if seed == chosen else ""), fill=(255, 200, 120) if seed == chosen else (220, 230, 255))
        if seed == chosen:
            d.rectangle((i * tw, 22, i * tw + tw - 1, thumb + 21), outline=(255, 200, 120), width=3)
    return out
