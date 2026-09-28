"""Anime-specific vision models used to inspect and post-process generations.

All of them are small ONNX models from Hugging Face run with onnxruntime on
the CPU, so they add no GPU memory pressure next to SDXL and install without
touching Colab's numpy/torch:

- face / hand / person detectors: deepghs YOLOv8 models trained on anime art
- segmentation: skytnt/anime-seg (ISNet), the character mask for the cut-out
- aesthetics: deepghs/anime_aesthetic, a danbooru-score classifier used to
  rank candidates
"""

from __future__ import annotations

import ast
import json
from dataclasses import dataclass
from functools import cache

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from PIL import Image

Box = tuple[float, float, float, float]  # x0, y0, x1, y1 in pixels


@dataclass(frozen=True)
class Detection:
    box: Box
    score: float

    @property
    def w(self) -> float:
        return self.box[2] - self.box[0]

    @property
    def h(self) -> float:
        return self.box[3] - self.box[1]

    @property
    def center(self) -> tuple[float, float]:
        return (self.box[0] + self.box[2]) / 2, (self.box[1] + self.box[3]) / 2


def _session(path: str) -> ort.InferenceSession:
    return ort.InferenceSession(path, providers=["CPUExecutionProvider"])


class YOLO:
    """A deepghs YOLOv8 detector (one class)."""

    def __init__(self, repo: str, name: str):
        self.model = _session(hf_hub_download(repo, f"{name}/model.onnx"))
        meta = self.model.get_modelmeta().custom_metadata_map
        size = json.loads(meta["imgsz"]) if "imgsz" in meta else [640, 640]
        self.size = (int(size[1]), int(size[0]))  # PIL order: w, h
        self.labels = ast.literal_eval(meta["names"]) if "names" in meta else {0: "object"}
        with open(hf_hub_download(repo, f"{name}/threshold.json")) as f:
            self.threshold = float(json.load(f)["threshold"])

    def __call__(self, image: Image.Image, threshold: float | None = None, iou: float = 0.7) -> list[Detection]:
        threshold = self.threshold if threshold is None else threshold
        rgb = image.convert("RGB")
        x = np.asarray(rgb.resize(self.size, Image.BILINEAR), dtype=np.float32) / 255
        (out,) = self.model.run(["output0"], {"images": x.transpose(2, 0, 1)[None]})
        out = out[0]  # (4 + classes, anchors)
        scores = out[4:].max(axis=0)
        keep = scores > threshold
        if not keep.any():
            return []
        cx, cy, w, h = out[:4, keep]
        boxes = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)
        scores = scores[keep]
        sx, sy = rgb.width / self.size[0], rgb.height / self.size[1]
        dets = []
        for i in _nms(boxes, scores, iou):
            x0, y0, x1, y1 = boxes[i]
            box = (
                float(np.clip(x0 * sx, 0, rgb.width)),
                float(np.clip(y0 * sy, 0, rgb.height)),
                float(np.clip(x1 * sx, 0, rgb.width)),
                float(np.clip(y1 * sy, 0, rgb.height)),
            )
            dets.append(Detection(box, float(scores[i])))
        return dets


def _nms(boxes: np.ndarray, scores: np.ndarray, iou: float) -> list[int]:
    order = scores.argsort()[::-1]
    area = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    keep = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        xx0 = np.maximum(boxes[i, 0], boxes[order[1:], 0])
        yy0 = np.maximum(boxes[i, 1], boxes[order[1:], 1])
        xx1 = np.minimum(boxes[i, 2], boxes[order[1:], 2])
        yy1 = np.minimum(boxes[i, 3], boxes[order[1:], 3])
        inter = np.clip(xx1 - xx0, 0, None) * np.clip(yy1 - yy0, 0, None)
        overlap = inter / (area[i] + area[order[1:]] - inter + 1e-9)
        order = order[1:][overlap <= iou]
    return keep


@cache
def face_detector() -> YOLO:
    return YOLO("deepghs/anime_face_detection", "face_detect_v1.4_s")


@cache
def hand_detector() -> YOLO:
    return YOLO("deepghs/anime_hand_detection", "hand_detect_v1.0_s")


@cache
def person_detector() -> YOLO:
    return YOLO("deepghs/anime_person_detection", "person_detect_v1.3_s")


def faces(image: Image.Image) -> list[Detection]:
    return face_detector()(image)


def hands(image: Image.Image) -> list[Detection]:
    return hand_detector()(image)


def persons(image: Image.Image) -> list[Detection]:
    return person_detector()(image)


# ---- segmentation ----


@cache
def _segmenter() -> ort.InferenceSession:
    return _session(hf_hub_download("skytnt/anime-seg", "isnetis.onnx"))


def character_mask(image: Image.Image) -> np.ndarray:
    """Soft foreground mask (H, W) in [0, 1] for the character in image.

    Same preprocessing as skytnt/anime-seg's reference code: letterbox the
    image into the model's fixed 1024×1024 input, run ISNet, crop and resize back.
    """
    size = 1024
    rgb = image.convert("RGB")
    w0, h0 = rgb.size
    if h0 > w0:
        h, w = size, int(size * w0 / h0)
    else:
        h, w = int(size * h0 / w0), size
    ph, pw = (size - h) // 2, (size - w) // 2
    x = np.zeros((size, size, 3), dtype=np.float32)
    x[ph : ph + h, pw : pw + w] = np.asarray(rgb.resize((w, h), Image.BILINEAR), dtype=np.float32) / 255
    (out,) = _segmenter().run(None, {"img": x.transpose(2, 0, 1)[None]})
    mask = out[0, 0, ph : ph + h, pw : pw + w]
    mask = Image.fromarray(np.clip(mask * 255, 0, 255).astype(np.uint8)).resize((w0, h0), Image.BICUBIC)
    return np.asarray(mask, dtype=np.float32) / 255


# ---- aesthetics ----

_AESTHETIC_REPO, _AESTHETIC_MODEL = "deepghs/anime_aesthetic", "swinv2pv3_v0_448_ls0.2_x"
_AESTHETIC_LABELS = ["worst", "low", "normal", "good", "great", "best", "masterpiece"]


@cache
def _aesthetic() -> tuple[ort.InferenceSession, list[str], np.ndarray, np.ndarray]:
    model = _session(hf_hub_download(_AESTHETIC_REPO, f"{_AESTHETIC_MODEL}/model.onnx"))
    with open(hf_hub_download(_AESTHETIC_REPO, f"{_AESTHETIC_MODEL}/meta.json")) as f:
        labels = json.load(f)["labels"]
    samples = np.load(hf_hub_download(_AESTHETIC_REPO, f"{_AESTHETIC_MODEL}/samples.npz"))["arr_0"]
    return model, labels, samples[0], samples[1]


def aesthetic(image: Image.Image) -> float:
    """Percentile (0-1) of the image's aesthetic score among danbooru images.

    Roughly: >0.95 masterpiece, >0.85 best, >0.75 great, >0.5 good.
    """
    model, labels, xs, ys = _aesthetic()
    rgba = image.convert("RGBA")
    flat = Image.new("RGBA", rgba.size, "white")
    flat.alpha_composite(rgba)
    _, _, h, w = model.get_inputs()[0].shape
    x = np.asarray(flat.convert("RGB").resize((w, h), Image.BILINEAR), dtype=np.float32) / 255
    x = (x - 0.5) / 0.5
    outs = model.run(None, {"input": x.transpose(2, 0, 1)[None].astype(np.float32)})
    probs = _softmax_if_needed(outs[0][0])
    score = sum(float(probs[labels.index(name)]) * i for i, name in enumerate(_AESTHETIC_LABELS))
    return float(np.interp(score, xs, ys))


def _softmax_if_needed(v: np.ndarray) -> np.ndarray:
    if v.min() >= 0 and abs(v.sum() - 1) < 1e-3:
        return v
    e = np.exp(v - v.max())
    return e / e.sum()
