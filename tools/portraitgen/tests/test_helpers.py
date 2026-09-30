import numpy as np
import pytest
from PIL import Image

from portraitgen import cutout, qa
from portraitgen.sdxl import _chunks, feathered_mask, feathered_rect, grid, square_around


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


def test_grid_covers_the_body_with_overlapping_squares():
    body = (300, 100, 900, 1750)
    tiles = grid(body, (1248, 1824), 512)
    assert len(tiles) == 2 * 4
    for x0, y0, x1, y1 in tiles:
        assert x1 - x0 == y1 - y0 == 512
        assert 0 <= x0 and 0 <= y0 and x1 <= 1248 and y1 <= 1824
    assert min(t[0] for t in tiles) <= body[0] and max(t[2] for t in tiles) >= body[2]
    assert min(t[1] for t in tiles) <= body[1] and max(t[3] for t in tiles) >= body[3]
    ys = sorted({t[1] for t in tiles})
    assert all(b - a < 512 for a, b in zip(ys, ys[1:]))  # neighbours overlap


def test_grid_centres_a_body_smaller_than_a_tile():
    assert grid((400, 400, 500, 600), (1000, 1000), 512) == [(194, 244, 706, 756)]


def test_feathered_rect_fades_at_the_edges():
    m = np.asarray(feathered_rect((200, 200), inset=40, blur=8))
    assert m[100, 100] == 255
    assert m[0, 100] == 0 and m[100, 199] == 0


def _figure_with(extra=None, size=(400, 600)):
    m = _body_mask(size, (150, 50, 250, 550))
    if extra:
        m[extra[1] : extra[3], extra[0] : extra[2]] = 1
    return m


def test_islands_and_drop_islands():
    m = _figure_with((10, 10, 14, 14))  # a 16px sparkle
    assert qa.islands(m)[0] == 1.0 and qa.islands(m)[1] < 0.01
    cleaned = cutout.drop_islands(m)
    assert cleaned[12, 12] == 0 and cleaned[300, 200] == 1
    big = _figure_with((10, 10, 110, 110))  # a moon: kept by the cut-out, rejected by QA
    assert cutout.drop_islands(big)[50, 50] == 1
    assert qa.islands(big)[1] >= qa.DETACHED


def test_background_clutter():
    mask = _figure_with()
    rgb = np.full(mask.shape + (3,), 240.0)
    rgb[mask > 0] = [30, 30, 120]
    assert qa.background_clutter(rgb, mask) == 0
    rgb[20:120, 20:120] = [250, 220, 60]  # a painted moon outside the figure
    assert qa.background_clutter(rgb, mask) > qa.MAX_CLUTTER


def test_cleanliness_catches_tags_clutter_and_detached_objects():
    mask = _figure_with((10, 10, 110, 110))
    rgb = np.full(mask.shape + (3,), 240, dtype=np.uint8)
    issues = qa.cleanliness_issues(Image.fromarray(rgb), mask, {"sparkle": 0.8, "glowing": 0.4, "1girl": 0.99})
    assert any("sparkle" in i for i in issues)
    assert not any("glowing" in i for i in issues)  # under its own, higher threshold
    assert any("detached" in i for i in issues)


def test_adherence_and_rank():
    tags = {"blue_hair": 0.9, "sword": 0.2}
    assert qa.adherence(tags, ["blue_hair", "sword"]) == (0.5, ["sword"])
    assert qa.adherence(tags, []) == (1.0, [])
    # crushed shadows up to CRUSHED_OK are free; beyond, they cost score
    assert qa.rank(0.8, 1.0, qa.CRUSHED_OK) == qa.rank(0.8, 1.0, 0.0)
    assert qa.rank(0.8, 1.0, 0.4) < qa.rank(0.8, 1.0, 0.1)
    assert qa.rank(0.8, 1.0, 0.1) > qa.rank(0.8, 0.0, 0.1)


def test_crushed_shadows_counts_the_figure_only():
    mask = _figure_with()
    rgb = np.zeros(mask.shape + (3,))  # black background does not count
    rgb[mask > 0] = 200
    rgb[50:150, 150:250] = 5
    assert qa.crushed_shadows(rgb, mask) == pytest.approx(0.2)


def test_require_accepts_any_alternative():
    tags = {"black_hair": 0.95, "grey_hair": 0.5}
    assert qa.require_issues(tags, ["white_hair", "grey_hair"]) == []
    assert qa.require_issues(tags, ["white_hair"]) == ["not white hair"]
    assert qa.require_issues(tags, []) == []
