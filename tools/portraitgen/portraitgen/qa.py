"""Automatic checks that reject a generation before anyone has to look at it.

A portrait is a character design sheet: one full-body figure on a plain
background, nothing else. Everything here enforces that:

- framing: the character, including hair and weapon, sits entirely inside
  the canvas with a margin, so the art is never cut off at the head or feet
- one face, one person, at full-body scale
- no effects or scenery: the tagger must not see sparkles, fire, moons,
  sky and the like, the background must be a flat colour, and nothing may
  float free of the figure (the segmenter keeps such bits and they end up
  in the cut-out)
- design adherence: the hair colour the character sheet asks for is seen
  (a wrong colour is rejected: the tagger reads hair reliably), and so is
  the item (this only ranks, as the tagger misses small props)

Candidates that pass are ranked by aesthetic score plus adherence, minus a
penalty for crushed shadows (the harsh, high-contrast look).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

from . import detect
from .detect import Box, Detection

# Everything below is a fraction of the image size.
MARGIN = 0.012  # clear space between the character and every edge
MIN_BODY = 0.62  # the character must fill at least this much of the height
FACE_RANGE = (0.045, 0.14)  # face height; outside it the shot is not a full-body one
MIN_SPECK = 0.004  # mask rows/columns thinner than this don't count as the character

# Background: a pixel is clutter when it differs from the background's median
# colour by more than CLUTTER_DIST (0-255 RGB distance); a plain background
# has almost none.
CLUTTER_DIST = 36.0
MAX_CLUTTER = 0.02  # leaves room for a soft floor shadow under the feet
# A mask island at least this big relative to the main figure is a separate
# object (a moon, a floating weapon, a second figure); smaller ones are
# specks the cut-out drops.
DETACHED = 0.015

# Tags that mean the image is not a clean character design. Probability
# thresholds are per tag: "glowing" fires weakly on shiny metal, so it needs
# more evidence than "moon".
FORBIDDEN: dict[str, float] = {
    # effects
    "sparkle": 0.35,
    "light_particles": 0.35,
    "glowing": 0.5,
    "glint": 0.5,
    "lens_flare": 0.35,
    "light_rays": 0.35,
    "magic": 0.35,
    "aura": 0.35,
    "energy": 0.35,
    "fire": 0.35,
    "embers": 0.35,
    "lightning": 0.35,
    "electricity": 0.35,
    "smoke": 0.4,
    "petals": 0.35,
    "falling_petals": 0.35,
    "cherry_blossoms": 0.4,
    "bubble": 0.35,
    "snowflakes": 0.35,
    "butterfly": 0.35,
    "water": 0.4,
    "splashing": 0.35,
    "star_(symbol)": 0.35,
    "speed_lines": 0.35,
    "motion_lines": 0.35,
    # no sheet asks for these; when they appear they are effects
    "wings": 0.4,
    "halo": 0.4,
    # scenery
    "moon": 0.3,
    "crescent_moon": 0.3,
    "full_moon": 0.3,
    "star_(sky)": 0.3,
    "starry_sky": 0.3,
    "starry_background": 0.3,
    "sky": 0.35,
    "cloud": 0.35,
    "night": 0.4,
    "scenery": 0.35,
    "outdoors": 0.4,
    "gradient_background": 0.5,
    # ship rigging, which the model cannot draw coherently
    "rigging": 0.35,
    "turret": 0.35,
    "cannon": 0.35,
    "machinery": 0.35,
    "mecha_musume": 0.4,
    # layout
    "multiple_girls": 0.35,
    "multiple_views": 0.35,
    "reference_sheet": 0.35,
    "speech_bubble": 0.35,
    "signature": 0.5,
    "watermark": 0.5,
    "head_out_of_frame": 0.35,
    "feet_out_of_frame": 0.35,
    "out_of_frame": 0.35,
}
EXPECT_THRESHOLD = 0.35

# Shadows darker than this (0-1 luminance) read as crushed black; up to
# CRUSHED_OK of the figure may be that dark (black clothes) before ranking
# suffers.
CRUSHED_LUMA = 0.07
CRUSHED_OK = 0.15


@dataclass
class Report:
    ok: bool
    issues: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)  # soft problems: ranked, not rejected
    score: float = 0.0
    aesthetic: float = 0.0
    adherence: float = 1.0
    crushed: float = 0.0
    body: Box | None = None  # mask bounding box
    face: Box | None = None
    hands: list[Box] = field(default_factory=list)

    def to_json(self) -> dict:
        return asdict(self)


def mask_box(mask: np.ndarray, threshold: float = 0.5) -> Box | None:
    """Bounding box of the character mask, ignoring faint specks."""
    solid = mask > threshold
    h, w = solid.shape
    rows = np.flatnonzero(solid.sum(axis=1) > w * MIN_SPECK)
    cols = np.flatnonzero(solid.sum(axis=0) > h * MIN_SPECK)
    if not rows.size or not cols.size:
        return None
    return float(cols[0]), float(rows[0]), float(cols[-1] + 1), float(rows[-1] + 1)


def framing_issues(body: Box | None, size: tuple[int, int]) -> list[str]:
    w, h = size
    if body is None:
        return ["no character found"]
    issues = []
    x0, y0, x1, y1 = body
    for name, gap in (("top", y0 / h), ("bottom", (h - y1) / h), ("left", x0 / w), ("right", (w - x1) / w)):
        if gap < MARGIN:
            issues.append(f"cut off at the {name}")
    if (y1 - y0) / h < MIN_BODY:
        issues.append("character too small")
    return issues


def face_issues(faces: list[Detection], body: Box | None, height: int) -> tuple[list[str], Detection | None]:
    if not faces:
        return ["no face found"], None
    main = max(faces, key=lambda d: d.w * d.h)
    issues = []
    if sum(1 for d in faces if d.h > main.h * 0.5) > 1:
        issues.append("more than one face")
    ratio = main.h / height
    if ratio < FACE_RANGE[0]:
        issues.append("face too small")
    elif ratio > FACE_RANGE[1]:
        issues.append("face too large (not a full-body shot)")
    if body is not None:
        cx, cy = main.center
        if not (body[0] <= cx <= body[2] and body[1] <= cy <= body[3]):
            issues.append("face is outside the character")
    return issues, main


def islands(mask: np.ndarray, threshold: float = 0.5) -> list[float]:
    """Sizes of the mask's connected parts relative to the largest, largest first."""
    labels, n = ndimage.label(mask > threshold)
    if n == 0:
        return []
    sizes = np.bincount(labels.ravel())[1:].astype(float)
    return sorted((sizes / sizes.max()).tolist(), reverse=True)


def background_clutter(rgb: np.ndarray, mask: np.ndarray) -> float:
    """Fraction of the background (well away from the figure) that is not the flat background colour."""
    near = Image.fromarray((mask > 0.02).astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(15))
    bg = np.asarray(near) == 0
    if bg.sum() < 0.05 * bg.size:
        return 1.0  # the figure (or its haze) covers everything
    colours = rgb[bg]
    dist = np.linalg.norm(colours - np.median(colours, axis=0), axis=1)
    return float((dist > CLUTTER_DIST).mean())


def crushed_shadows(rgb: np.ndarray, mask: np.ndarray) -> float:
    """Fraction of the figure darker than CRUSHED_LUMA."""
    fig = mask > 0.5
    if not fig.any():
        return 0.0
    luma = (rgb[fig] @ np.array([0.2126, 0.7152, 0.0722])) / 255
    return float((luma < CRUSHED_LUMA).mean())


def tag_issues(tags: dict[str, float]) -> list[str]:
    return [f"{t.replace('_', ' ')} ({tags[t]:.2f})" for t, th in FORBIDDEN.items() if tags.get(t, 0) >= th]


def adherence(tags: dict[str, float], expect: list[str]) -> tuple[float, list[str]]:
    """Share of the expected tags that were seen, and the missing ones."""
    if not expect:
        return 1.0, []
    missing = [t for t in expect if tags.get(t, 0) < EXPECT_THRESHOLD]
    return 1 - len(missing) / len(expect), missing


def rank(aesthetic: float, adherence: float, crushed: float) -> float:
    return aesthetic + 0.3 * adherence - 2.0 * max(0.0, crushed - CRUSHED_OK)


def cleanliness_issues(image: Image.Image, mask: np.ndarray, tags: dict[str, float]) -> list[str]:
    """Effects, scenery and detached objects: everything that is not the character."""
    issues = [f"effect/scenery: {t}" for t in tag_issues(tags)]
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    clutter = background_clutter(rgb, mask)
    if clutter > MAX_CLUTTER:
        issues.append(f"background not plain ({clutter:.1%})")
    detached = [s for s in islands(mask)[1:] if s >= DETACHED]
    if detached:
        issues.append(f"{len(detached)} object(s) detached from the figure")
    return issues


def require_issues(tags: dict[str, float], require: list[str]) -> list[str]:
    """require holds alternatives (a hair colour and its near names); one must be seen."""
    if not require or max(tags.get(t, 0) for t in require) >= EXPECT_THRESHOLD:
        return []
    return [f"not {require[0].replace('_', ' ')}"]


def inspect(image: Image.Image, expect: list[str] | None = None, require: list[str] | None = None) -> Report:
    mask = detect.character_mask(image)
    body = mask_box(mask)
    issues = framing_issues(body, image.size)
    f_issues, face = face_issues(detect.faces(image), body, image.height)
    issues += f_issues
    people = [p for p in detect.persons(image) if p.h > image.height * 0.3]
    if len(people) > 1:
        issues.append("more than one character")
    tags = detect.tags(image)
    issues += cleanliness_issues(image, mask, tags)
    issues += require_issues(tags, require or [])

    adh, missing = adherence(tags, expect or [])
    crushed = crushed_shadows(np.asarray(image.convert("RGB"), dtype=np.float32), mask)
    notes = [f"not seen: {t.replace('_', ' ')}" for t in missing]
    if crushed > CRUSHED_OK:
        notes.append(f"harsh shadows ({crushed:.0%})")
    aes = detect.aesthetic(image)
    return Report(
        ok=not issues,
        issues=issues,
        notes=notes,
        score=rank(aes, adh, crushed),
        aesthetic=aes,
        adherence=adh,
        crushed=crushed,
        body=body,
        face=face.box if face else None,
        hands=[d.box for d in detect.hands(image)],
    )
