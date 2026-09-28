"""The two-phase workflow the notebook drives.

explore: render cheap native-resolution candidates per card, reject bad ones
         automatically (qa.inspect) and rank the rest by aesthetic score.
finish:  take the chosen candidate of each card through the expensive passes
         (hires refine, face and hand detailing), cut it out and export it.
pack:    zip the finished portraits for `go run ./cmd/portraits import`.

Everything is written under one work directory and skipped when already
there, so a disconnected Colab session resumes where it stopped.
"""

from __future__ import annotations

import json
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from . import cutout, detect, qa

# SDXL's native portrait bucket; tall enough for a full body with margin.
WIDTH, HEIGHT = 832, 1216
# Finished portraits are stored no taller than this.
MAX_HEIGHT = 1600


@dataclass
class Job:
    id: str
    name: str
    seed: int
    prompt: str
    negative: str
    face_prompt: str
    hand_prompt: str
    detail_negative: str

    @classmethod
    def load(cls, path: str | Path) -> list[Job]:
        data = json.loads(Path(path).read_text())
        fields = cls.__dataclass_fields__
        return [cls(**{k: v for k, v in j.items() if k in fields}) for j in data["jobs"]]


def _cand_dir(work: Path, card: str) -> Path:
    return work / "candidates" / card


def candidates(work: Path, card: str) -> list[tuple[int, dict]]:
    """(seed, report) of every rendered candidate, best first."""
    out = []
    for f in sorted(_cand_dir(work, card).glob("*.json")):
        out.append((int(f.stem), json.loads(f.read_text())))
    return sorted(out, key=lambda c: (not c[1]["ok"], -c[1]["aesthetic"]))


def best(work: Path, card: str) -> int | None:
    ok = [seed for seed, r in candidates(work, card) if r["ok"]]
    return ok[0] if ok else None


def explore(gen, jobs: list[Job], work: str | Path, want: int = 4, max_tries: int = 12, seed_offset: int = 0, steps: int = 28, cfg: float = 6.0, log=print) -> None:
    """Render until each card has want accepted candidates (or max_tries renders).

    Inspection (CPU) of one render overlaps the next render (GPU); the count
    of accepted candidates therefore lags by one, which costs at most one
    extra candidate per card.
    """
    work = Path(work)

    def check(job: Job, seed: int, img: Image.Image, took: float) -> None:
        report = qa.inspect(img)
        d = _cand_dir(work, job.id)
        img.save(d / f"{seed}.png")
        (d / f"{seed}.json").write_text(json.dumps(report.to_json()))
        verdict = f"ok  aesthetic {report.aesthetic:.2f}" if report.ok else "NG  " + ", ".join(report.issues)
        log(f"{job.id} seed {seed}: {verdict}  (render {took:.0f}s)")

    with ThreadPoolExecutor(1) as pool:
        pending = None
        for job in jobs:
            d = _cand_dir(work, job.id)
            d.mkdir(parents=True, exist_ok=True)
            emb = gen.embed(job.prompt, job.negative)
            for i in range(max_tries):
                if sum(r["ok"] for _, r in candidates(work, job.id)) >= want:
                    break
                seed = job.seed + seed_offset + i
                if (d / f"{seed}.json").exists():
                    continue
                t = time.time()
                img = gen.render(emb, seed, WIDTH, HEIGHT, steps=steps, cfg=cfg)
                if pending:
                    pending.result()
                pending = pool.submit(check, job, seed, img, time.time() - t)
            if pending:
                pending.result()
                pending = None


def finish(
    gen,
    jobs: list[Job],
    work: str | Path,
    picks: dict[str, int] | None = None,
    redo: bool = False,
    refine_strength: float = 0.4,
    face_strength: float = 0.4,
    hand_strength: float = 0.35,
    steps: int = 28,
    cfg: float = 6.0,
    log=print,
) -> None:
    work = Path(work)
    out = work / "final"
    out.mkdir(parents=True, exist_ok=True)
    picks = picks or {}
    for job in jobs:
        seed = picks.get(job.id) or best(work, job.id)
        if seed is None:
            log(f"{job.id}: no accepted candidate yet; run explore again (larger max_tries or another seed_offset)")
            continue
        meta_path = out / f"{job.id}.json"
        if meta_path.exists() and not redo and json.loads(meta_path.read_text()).get("seed") == seed:
            continue
        t = time.time()
        base = Image.open(_cand_dir(work, job.id) / f"{seed}.png").convert("RGB")
        emb = gen.embed(job.prompt, job.negative)
        img = gen.refine(base, emb, seed, strength=refine_strength, steps=steps, cfg=cfg)

        faces = detect.faces(img)
        if faces:
            main = max(faces, key=lambda d: d.w * d.h)
            img = gen.detail(img, [main.box], gen.embed(job.face_prompt, job.detail_negative), seed, strength=face_strength, context=2.2, steps=steps, cfg=cfg)
        hands = [d.box for d in detect.hands(img) if d.h > img.height * 0.02]
        if hands:
            img = gen.detail(img, hands, gen.embed(job.hand_prompt, job.detail_negative), seed, strength=hand_strength, context=2.6, steps=steps, cfg=cfg)
        img.save(out / f"{job.id}.full.png")

        export(job.id, img, seed, out, log)
        log(f"{job.id}: finished seed {seed} ({time.time() - t:.0f}s)")


def export(card: str, img: Image.Image, seed: int, out: Path, log=print) -> dict:
    """Cut out, trim, check and save <card>.webp with its <card>.json metadata."""
    rgba = cutout.cut_out(img)
    alpha = rgba.getchannel("A")
    issues = qa.framing_issues(qa.mask_box(np.asarray(alpha, dtype=np.float32) / 255), rgba.size)
    if issues:
        log(f"{card}: warning after cut-out: {', '.join(issues)}")
    trimmed, offset = cutout.trim(rgba)
    faces = detect.faces(img)
    face = max(faces, key=lambda d: d.w * d.h).box if faces else None
    crop_size = trimmed.size
    scale = min(1.0, MAX_HEIGHT / trimmed.height)
    if scale < 1:
        trimmed = trimmed.resize((round(trimmed.width * scale), round(trimmed.height * scale)), Image.LANCZOS)
    trimmed.save(out / f"{card}.webp", quality=92, method=6)
    meta = {
        "seed": seed,
        "w": trimmed.width,
        "h": trimmed.height,
        # Face box as fractions of the portrait; the game frames cards and map tokens on it.
        "face": cutout.normalized(face, offset, crop_size) if face else None,
        "aesthetic": round(detect.aesthetic(trimmed), 3),
    }
    (out / f"{card}.json").write_text(json.dumps(meta))
    return meta


def pack(work: str | Path, dest: str | Path | None = None) -> Path:
    """Zip final/<card>.webp plus portraits.json (card -> metadata)."""
    work = Path(work)
    out = work / "final"
    dest = Path(dest) if dest else work / "portraits.zip"
    meta = {}
    with zipfile.ZipFile(dest, "w") as z:
        for f in sorted(out.glob("*.webp")):
            card = f.stem
            meta[card] = json.loads((out / f"{card}.json").read_text())
            z.write(f, f.name)
        z.writestr("portraits.json", json.dumps(meta, indent=2))
    return dest


# ---- contact sheets for the notebook ----


def candidate_sheet(work: str | Path, card: str, thumb: int = 300) -> Image.Image | None:
    """All candidates of a card, best first, rejected ones dimmed with their reason."""
    work = Path(work)
    cands = candidates(work, card)
    if not cands:
        return None
    tw = int(thumb * WIDTH / HEIGHT)
    sheet = Image.new("RGB", (tw * len(cands), thumb + 44), (24, 28, 40))
    d = ImageDraw.Draw(sheet)
    for i, (seed, r) in enumerate(cands):
        im = Image.open(_cand_dir(work, card) / f"{seed}.png").convert("RGB").resize((tw, thumb))
        if not r["ok"]:
            im = Image.blend(im, Image.new("RGB", im.size, (60, 0, 0)), 0.55)
        sheet.paste(im, (i * tw, 44))
        head = f"{seed}  {r['aesthetic']:.2f}" if r["ok"] else f"{seed}  NG"
        d.text((i * tw + 6, 4), head, fill=(255, 255, 255) if r["ok"] else (255, 120, 120))
        d.text((i * tw + 6, 22), "" if r["ok"] else r["issues"][0][:34], fill=(255, 160, 160))
    return sheet


def final_sheet(work: str | Path, thumb: int = 360, per_row: int = 8) -> Image.Image | None:
    """Finished portraits on the game's dark navy, with their face boxes."""
    out = Path(work) / "final"
    files = sorted(out.glob("*.webp"))
    if not files:
        return None
    tiles = []
    for f in files:
        im = Image.open(f).convert("RGBA")
        im = im.resize((max(1, int(im.width * thumb / im.height)), thumb), Image.LANCZOS)
        tiles.append((f.stem, im, json.loads((out / f"{f.stem}.json").read_text())))
    tw = max(t.width for _, t, _ in tiles) + 8
    rows = (len(tiles) - 1) // per_row + 1
    sheet = Image.new("RGBA", (tw * min(per_row, len(tiles)), (thumb + 24) * rows), (12, 22, 40, 255))
    d = ImageDraw.Draw(sheet)
    for k, (card, im, meta) in enumerate(tiles):
        x, y = (k % per_row) * tw, (k // per_row) * (thumb + 24)
        sheet.alpha_composite(im, (x + (tw - im.width) // 2, y + 20))
        d.text((x + 4, y + 4), card, fill=(220, 230, 255))
        if meta.get("face"):
            fx0, fy0, fx1, fy1 = meta["face"]
            ox = x + (tw - im.width) // 2
            d.rectangle((ox + fx0 * im.width, y + 20 + fy0 * im.height, ox + fx1 * im.width, y + 20 + fy1 * im.height), outline=(255, 80, 80))
    return sheet
