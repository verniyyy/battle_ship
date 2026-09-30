"""Load the real Real-ESRGAN anime weights (18MB, downloaded once) on the CPU."""

import numpy as np
import torch
from PIL import Image, ImageDraw

from portraitgen.upscale import Upscaler


def test_upscaler_loads_weights_and_stitches_tiles_exactly():
    up = Upscaler(device="cpu", dtype=torch.float32)
    rng = np.random.default_rng(0)
    img = Image.fromarray(rng.integers(0, 255, (40, 56, 3), dtype=np.uint8))
    whole = up(img, (224, 160), tile=1024)
    assert whole.size == (224, 160)
    # With padding wider than the image every tile sees all of it, so the
    # stitched result must equal the whole-image one: the tile maths is right.
    tiled = up(img, (224, 160), tile=24, pad=64)
    diff = np.abs(np.asarray(whole, dtype=int) - np.asarray(tiled, dtype=int))
    assert diff.max() <= 1


def test_upscaler_sharpens_line_art():
    up = Upscaler(device="cpu", dtype=torch.float32)
    small = Image.new("RGB", (48, 48), "white")
    ImageDraw.Draw(small).line((4, 40, 44, 8), fill="black", width=2)
    big = np.asarray(up(small, (192, 192)).convert("L"), dtype=float)
    soft = np.asarray(small.resize((192, 192), Image.BICUBIC).convert("L"), dtype=float)
    # Crisper edges: fewer in-between grey pixels than a bicubic blow-up.
    grey = lambda a: ((a > 40) & (a < 215)).mean()  # noqa: E731
    assert grey(big) < grey(soft)
