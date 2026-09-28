"""Automatic checks that reject a generation before anyone has to look at it.

The one that matters most is framing: the character, including hair, rigging
and weapons, must sit entirely inside the canvas with a margin, so the
full-body art is never cut off at the head, feet or sides.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
from PIL import Image

from . import detect
from .detect import Box, Detection

# Everything below is a fraction of the image size.
MARGIN = 0.012  # clear space between the character and every edge
MIN_BODY = 0.62  # the character must fill at least this much of the height
FACE_RANGE = (0.045, 0.14)  # face height; outside it the shot is not a full-body one
MIN_SPECK = 0.004  # mask rows/columns thinner than this don't count as the character


@dataclass
class Report:
    ok: bool
    issues: list[str] = field(default_factory=list)
    aesthetic: float = 0.0
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


def inspect(image: Image.Image) -> Report:
    mask = detect.character_mask(image)
    body = mask_box(mask)
    issues = framing_issues(body, image.size)
    f_issues, face = face_issues(detect.faces(image), body, image.height)
    issues += f_issues
    people = [p for p in detect.persons(image) if p.h > image.height * 0.3]
    if len(people) > 1:
        issues.append("more than one character")
    return Report(
        ok=not issues,
        issues=issues,
        aesthetic=detect.aesthetic(image),
        body=body,
        face=face.box if face else None,
        hands=[d.box for d in detect.hands(image)],
    )
