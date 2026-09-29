"""Staged illustrations: a finished portrait set in a backdrop of light and effects.

Portraits are generated without effects or scenery, which came out mangled
when drawn together with the figure, so rarity barely shows in them. For
showcase screens high-rarity cards get a staged version instead: the
cut-out is placed on a canvas, a model paints the scene around it, and the
untouched cut-out is laid back on top, so the character stays exactly the
finished portrait whatever the model does.

Two painters, to compare on the same cards:

inpaint: Animagine (the portrait model) repaints only around the figure,
         from a guide glowing in the card's colour. Same touch as the
         portrait, but the scene stays behind the figure.
klein:   FLUX.2 [klein] 4B edits the whole picture from an instruction, so
         light can fall on the figure and effects pass in front of it. It
         redraws the figure too, which is why the cut-out goes back on top;
         the raw edit is kept alongside to judge what that loses.

Results go to <work>/stage/<card>/<painter>-<seed>.png.
"""

from __future__ import annotations

import time
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

from .run import HEIGHT, WIDTH, Job

# Figure height as a share of the canvas, and the gap under its feet.
FIGURE = 0.84
FLOOR = 0.03
NAVY = (12, 22, 40)


def staged(jobs: list[Job]) -> list[Job]:
    return [j for j in jobs if j.stage_prompt]


def portrait(work: str | Path, card: str) -> Image.Image | None:
    f = Path(work) / "final" / f"{card}.webp"
    return Image.open(f).convert("RGBA") if f.exists() else None


# ---- composition (pure, tested on CPU) ----


def place(cut: Image.Image, size: tuple[int, int] = (WIDTH, HEIGHT), figure: float = FIGURE, floor: float = FLOOR) -> Image.Image:
    """The cut-out scaled to figure x canvas height, centred, feet floor above the bottom."""
    w, h = size
    k = min(figure * h / cut.height, 0.96 * w / cut.width)
    fig = cut.resize((max(1, round(cut.width * k)), max(1, round(cut.height * k))), Image.LANCZOS)
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    layer.alpha_composite(fig, ((w - fig.width) // 2, round(h * (1 - floor)) - fig.height))
    return layer


def guide(size: tuple[int, int], color: str, center: tuple[float, float] = (0.5, 0.38)) -> Image.Image:
    """Dark navy lit by a soft glow of color behind the upper body.

    The inpaint starts from this rather than from the flat portrait
    background, so the scene it paints is lit from behind the figure in the
    card's colour.
    """
    w, h = size
    rgb = np.array(_hex(color), dtype=np.float32)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.hypot((x - center[0] * w) / w, (y - center[1] * h) / w)
    glow = np.clip(1 - d / 0.75, 0, 1) ** 1.6
    base = np.array(NAVY, dtype=np.float32) * (0.6 + 0.4 * y[..., None] / h)
    out = base * (1 - glow[..., None]) + (rgb * 0.55 + 255 * 0.45 * glow[..., None] ** 3) * glow[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def paint_mask(layer: Image.Image, inset: int = 4, feather: float = 3) -> Image.Image:
    """White where the model paints: everything but the figure, shrunk by inset px.

    The thin band inside the figure's edge is painted too, so the scene runs
    under soft hair tips; the cut-out laid back on top hides the rest of it.
    """
    solid = np.asarray(layer.getchannel("A")) > 128
    if inset:
        solid = ndimage.binary_erosion(solid, iterations=inset)
    m = Image.fromarray(np.where(solid, 0, 255).astype(np.uint8), "L")
    return m.filter(ImageFilter.GaussianBlur(feather)) if feather else m


def composite(scene: Image.Image, layer: Image.Image) -> Image.Image:
    out = scene.convert("RGBA").resize(layer.size)
    out.alpha_composite(layer)
    return out.convert("RGB")


def _hex(color: str) -> tuple[int, int, int]:
    c = (color or "#8899bb").lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def _dir(work: str | Path, card: str) -> Path:
    d = Path(work) / "stage" / card
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---- painters (GPU) ----


def paint_inpaint(
    gen, jobs: list[Job], work: str | Path, seeds: int = 3, strength: float = 0.95, steps: int = 28, cfg: float | None = None, size: tuple[int, int] = (WIDTH, HEIGHT), redo: bool = False, log=print
) -> None:
    """Animagine repaints around each figure, seeds times per card."""
    from .sdxl import CFG

    for job in staged(jobs):
        cut = portrait(work, job.id)
        if cut is None:
            log(f"{job.id}: no finished portrait in final/; run the finish step first")
            continue
        layer = place(cut, size)
        base = composite(guide(size, job.color), layer)
        mask = paint_mask(layer)
        emb = gen.embed(job.stage_prompt, job.stage_negative)
        for i in range(seeds):
            seed = job.seed + i
            f = _dir(work, job.id) / f"inpaint-{seed}.png"
            if f.exists() and not redo:
                continue
            t = time.time()
            scene = gen.paint(base, mask, emb, seed, strength=strength, steps=steps, cfg=cfg or CFG)
            composite(scene, layer).save(f)
            log(f"{job.id} inpaint seed {seed} ({time.time() - t:.0f}s)")


def paint_klein(klein, jobs: list[Job], work: str | Path, seeds: int = 3, steps: int = 4, size: tuple[int, int] = (WIDTH, HEIGHT), redo: bool = False, log=print) -> None:
    """FLUX.2 [klein] edits each portrait on its guide, seeds times per card."""
    todo = []
    for job in staged(jobs):
        cut = portrait(work, job.id)
        if cut is None:
            log(f"{job.id}: no finished portrait in final/; run the finish step first")
            continue
        missing = [job.seed + i for i in range(seeds) if redo or not (_dir(work, job.id) / f"klein-{job.seed + i}.png").exists()]
        if missing:
            todo.append((job, place(cut, size), missing))
    if not todo:
        return
    t = time.time()
    embeds = klein.encode([job.stage_instruction for job, _, _ in todo])
    log(f"instructions encoded ({time.time() - t:.0f}s)")
    for job, layer, missing in todo:
        base = composite(guide(layer.size, job.color), layer)
        for seed in missing:
            t = time.time()
            raw = klein.edit(base, embeds[job.stage_instruction], seed, steps=steps)
            d = _dir(work, job.id)
            raw.save(d / f"klein-{seed}.raw.png")
            composite(raw, layer).save(d / f"klein-{seed}.png")
            log(f"{job.id} klein seed {seed} ({time.time() - t:.0f}s)")


# ---- review ----


def results(work: str | Path, card: str) -> list[Path]:
    """Staged images of a card, inpaint first; raw klein edits after their composites."""
    d = Path(work) / "stage" / card
    order = {"inpaint": 0, "klein": 1}
    return sorted(d.glob("*.png"), key=lambda f: (order.get(f.stem.split("-")[0], 2), f.stem.replace(".raw", "~"))) if d.exists() else []


def sheet(work: str | Path, card: str, thumb: int = 420) -> Image.Image | None:
    files = results(work, card)
    if not files:
        return None
    tw = int(thumb * WIDTH / HEIGHT)
    out = Image.new("RGB", (tw * len(files), thumb + 22), NAVY)
    d = ImageDraw.Draw(out)
    for i, f in enumerate(files):
        out.paste(Image.open(f).convert("RGB").resize((tw, thumb), Image.LANCZOS), (i * tw, 22))
        label = f.stem.replace(".raw", " (raw: figure redrawn)")
        d.text((i * tw + 6, 5), label, fill=(255, 200, 120) if ".raw" in f.stem else (220, 230, 255))
    return out


def pack(work: str | Path, dest: str | Path) -> Path:
    """Zip every staged image for review on the local machine."""
    dest = Path(dest)
    with zipfile.ZipFile(dest, "w") as z:
        for f in sorted((Path(work) / "stage").glob("*/*.png")):
            z.write(f, f"{f.parent.name}/{f.name}")
    return dest
