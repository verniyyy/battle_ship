import numpy as np
import pytest
from PIL import Image

from portraitgen import cutout, qa
from portraitgen.sdxl import _chunks, feathered_mask, square_around


class WordTokenizer:
    """One token per word, enough to test chunk packing without CLIP."""

    def __call__(self, text, add_special_tokens=True):
        class Out:
            input_ids = text.split()

        return Out()


def test_chunks_keep_tags_whole_and_under_limit():
    prompt = ", ".join(f"tag{i} with four words" for i in range(40))
    chunks = _chunks(WordTokenizer(), prompt, limit=75)
    assert [t for c in chunks for t in c] == [f"tag{i} with four words" for i in range(40)]
    for c in chunks:
        assert sum(len(t.split()) + 1 for t in c) <= 75
    assert len(chunks) == 3  # 40 tags * 5 tokens = 200 tokens -> 15 tags per chunk


def test_chunks_of_empty_prompt():
    assert _chunks(WordTokenizer(), "") == [[]]


@pytest.mark.parametrize("box", [(10, 10, 50, 60), (780, 1150, 830, 1210), (400, 600, 420, 610)])
def test_square_around_stays_inside(box):
    x0, y0, x1, y1 = square_around(box, 2.2, (832, 1216))
    assert x1 - x0 == y1 - y0
    assert 0 <= x0 and 0 <= y0 and x1 <= 832 and y1 <= 1216
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    # centred on the box unless pushed back inside the image
    assert x0 <= cx <= x1 and y0 <= cy <= y1


def test_feathered_mask_covers_box_centre_not_corners():
    m = np.asarray(feathered_mask((200, 200), (60, 60, 140, 140), blur=4))
    assert m[100, 100] == 255
    assert m[0, 0] == 0


def _body_mask(size, box):
    m = np.zeros((size[1], size[0]), dtype=np.float32)
    m[box[1] : box[3], box[0] : box[2]] = 1
    return m


def test_framing_accepts_centred_full_body():
    size = (832, 1216)
    body = qa.mask_box(_body_mask(size, (300, 60, 540, 1170)))
    assert body == (300, 60, 540, 1170)
    assert qa.framing_issues(body, size) == []


def test_framing_rejects_cut_feet_and_small_figures():
    size = (832, 1216)
    assert qa.framing_issues(qa.mask_box(_body_mask(size, (300, 60, 540, 1216))), size) == ["cut off at the bottom"]
    assert "cut off at the left" in qa.framing_issues(qa.mask_box(_body_mask(size, (0, 60, 540, 1170))), size)
    assert qa.framing_issues(qa.mask_box(_body_mask(size, (300, 500, 540, 1170))), size) == ["character too small"]
    assert qa.framing_issues(None, size) == ["no character found"]


def test_mask_box_ignores_specks():
    m = _body_mask((832, 1216), (300, 60, 540, 1170))
    m[0, 0] = m[1215, 831] = 1  # stray pixels in the corners
    assert qa.mask_box(m) == (300, 60, 540, 1170)


def test_decontaminate_recovers_foreground_colour():
    bg, fg = np.array([255.0, 255, 255]), np.array([200.0, 40, 40])
    alpha = np.full((4, 4), 0.4, dtype=np.float32)
    rgb = np.broadcast_to(alpha[..., None] * fg + (1 - alpha[..., None]) * bg, (4, 4, 3)).copy()
    out = cutout.decontaminate(rgb, alpha, bg)
    assert np.allclose(out, fg, atol=0.5)


def test_background_color_reads_border():
    rgb = np.full((100, 80, 3), 230.0)
    rgb[20:80, 20:60] = [10, 10, 10]
    alpha = _body_mask((80, 100), (20, 20, 60, 80))
    assert np.allclose(cutout.background_color(rgb, alpha), [230, 230, 230])


def test_trim_and_normalize():
    a = np.zeros((200, 100), dtype=np.uint8)
    a[50:150, 30:70] = 255
    img = Image.fromarray(np.dstack([np.zeros((200, 100, 3), np.uint8), a]), "RGBA")
    trimmed, (ox, oy) = cutout.trim(img, pad=0.1)
    assert (ox, oy) == (20, 40)
    assert trimmed.size == (60, 120)
    assert cutout.normalized((30, 50, 70, 70), (ox, oy), trimmed.size) == [round(10 / 60, 4), round(10 / 120, 4), round(50 / 60, 4), round(30 / 120, 4)]
