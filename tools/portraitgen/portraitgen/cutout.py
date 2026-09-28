"""Turn a finished render into the transparent portrait the game uses."""

from __future__ import annotations

import numpy as np
from PIL import Image

from . import detect
from .detect import Box
from .qa import mask_box


def background_color(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Median colour of the clear background along the image border."""
    band = max(4, min(rgb.shape[:2]) // 50)
    edge = np.zeros(alpha.shape, dtype=bool)
    edge[:band] = edge[-band:] = True
    edge[:, :band] = edge[:, -band:] = True
    pick = edge & (alpha < 0.05)
    if pick.sum() < 16:
        pick = edge
    return np.median(rgb[pick], axis=0)


def decontaminate(rgb: np.ndarray, alpha: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """Remove the background colour bled into semi-transparent edges.

    A soft edge pixel is I = a*F + (1-a)*B. With B known (the plain generation
    background) we solve for the true foreground F, so hair tips don't keep a
    white halo when shown over the game's dark UI.
    """
    a = alpha[..., None]
    fg = (rgb - (1 - a) * bg) / np.maximum(a, 1e-3)
    fg = np.clip(fg, 0, 255)
    # Keep the original where the pixel is (nearly) solid or (nearly) empty.
    soft = (alpha > 0.03) & (alpha < 0.97)
    out = rgb.copy()
    out[soft] = fg[soft]
    return out


def cut_out(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    alpha = detect.character_mask(image)
    # Drop the faint haze the segmenter leaves on busy backgrounds.
    alpha = np.where(alpha < 0.04, 0, alpha)
    rgb = decontaminate(rgb, alpha, background_color(rgb, alpha))
    rgba = np.dstack([rgb, alpha * 255]).round().astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def trim(rgba: Image.Image, pad: float = 0.02) -> tuple[Image.Image, tuple[int, int]]:
    """Crop to the character plus pad (fraction of its height); returns the offset."""
    alpha = np.asarray(rgba.getchannel("A"), dtype=np.float32) / 255
    box = mask_box(alpha, threshold=0.1) or (0, 0, rgba.width, rgba.height)
    p = int((box[3] - box[1]) * pad)
    x0, y0 = max(0, int(box[0]) - p), max(0, int(box[1]) - p)
    x1, y1 = min(rgba.width, int(box[2]) + p), min(rgba.height, int(box[3]) + p)
    return rgba.crop((x0, y0, x1, y1)), (x0, y0)


def normalized(box: Box, offset: tuple[int, int], size: tuple[int, int]) -> list[float]:
    """box in trimmed-image fractions, rounded for the manifest."""
    (ox, oy), (w, h) = offset, size
    return [round((box[0] - ox) / w, 4), round((box[1] - oy) / h, 4), round((box[2] - ox) / w, 4), round((box[3] - oy) / h, 4)]
