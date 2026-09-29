"""Staged illustrations: composition, export and packing, and klein on a tiny model.

The painter runs on a random-weight FLUX.2 [klein] built here with the real
tokenizer (a few MB download on the first run). Its images are noise; the
tests check the wiring and that the figure always comes back untouched.
"""

import json
import zipfile

import numpy as np
import pytest
import torch
from PIL import Image
from scipy import ndimage

from portraitgen import stage
from portraitgen.run import Job

SIZE = (64, 96)


def _cut(w=30, h=60):
    """A red figure with a soft edge on a transparent canvas."""
    a = np.zeros((h + 10, w + 10), dtype=np.uint8)
    a[5 : 5 + h, 5 : 5 + w] = 255
    a[5 : 5 + h, 5] = 128
    rgba = np.dstack([np.full(a.shape, 200, np.uint8), np.zeros(a.shape, np.uint8), np.zeros(a.shape, np.uint8), a])
    return Image.fromarray(rgba, "RGBA")


def test_place_scales_centres_and_grounds_the_figure():
    layer = stage.place(_cut(), SIZE, figure=0.8, floor=0.05)
    assert layer.size == SIZE
    alpha = np.asarray(layer.getchannel("A"))
    ys, xs = np.nonzero(alpha > 128)
    assert abs((ys.max() - ys.min() + 1) - 0.8 * 96 * 60 / 70) <= 2  # the cut-out's figure is 60 of its 70 rows
    assert abs((xs.min() + xs.max()) / 2 - 32) <= 1.5
    assert 96 * 0.95 - 8 <= ys.max() <= 96 * 0.95


def test_place_keeps_a_wide_figure_inside_the_canvas():
    layer = stage.place(_cut(w=300, h=40), SIZE)
    xs = np.nonzero(np.asarray(layer.getchannel("A")).max(axis=0))[0]
    assert xs.min() >= 0 and xs.max() < SIZE[0]


def test_guide_glows_in_the_card_colour_behind_the_upper_body():
    g = np.asarray(stage.guide(SIZE, "#ff0000")).astype(int)
    lit, corner = g[int(96 * 0.38), 32], g[95, 0]
    assert lit[0] > lit[2] + 60 and lit.sum() > corner.sum() + 150


def test_glow_moves_with_the_seed_but_stays_behind_the_upper_body():
    centres = {stage.glow_center(s) for s in range(20)}
    assert len(centres) == 20 and stage.glow_center(3) == stage.glow_center(3)
    assert all(0.3 <= x <= 0.7 and 0.25 <= y <= 0.45 for x, y in centres)


def test_vignette_dims_the_corners_most():
    out = np.asarray(stage.vignette(Image.new("RGB", SIZE, (200, 200, 200)), 0.4)).astype(int)
    assert 165 <= out[43, 32, 0] <= 175
    assert 115 <= out[0, 0, 0] < 135
    assert stage.vignette(Image.new("RGB", SIZE, (200, 200, 200)), 0).getpixel((0, 0)) == (200, 200, 200)


def test_composite_puts_the_figure_back_exactly():
    layer = stage.place(_cut(), SIZE)
    scene = Image.new("RGB", SIZE, (0, 0, 255))
    out = np.asarray(stage.composite(scene, layer))
    alpha = np.asarray(layer.getchannel("A"))
    solid = alpha == 255
    assert (out[solid] == np.asarray(layer.convert("RGB"))[solid]).all()
    assert tuple(out[0, 0]) == (0, 0, 255)


def _job(card, staged=True):
    j = Job(id=card, name=card, seed=10, prompt="1girl", negative="", face_prompt="", hand_prompt="", tile_prompt="", detail_negative="")
    if staged:
        j.color = "#ffcf4a"
        j.stage_instruction = "Add a sunrise behind the girl. Keep the girl exactly as she is."
    return j


def _final(work, card, size=(40, 80), face=(0.25, 0.1, 0.75, 0.3)):
    d = work / "final"
    d.mkdir(parents=True, exist_ok=True)
    _cut(*size).save(d / f"{card}.webp", lossless=True)
    (d / f"{card}.json").write_text(json.dumps({"seed": 1, "w": size[0] + 10, "h": size[1] + 10, "face": list(face)}))


def test_only_cards_with_a_stage_are_painted():
    assert [j.id for j in stage.staged([_job("a"), _job("b", staged=False)])] == ["a"]


def test_job_load_reads_the_stage(tmp_path):
    job = {k: "x" for k in ("id", "name", "prompt", "negative", "face_prompt", "hand_prompt", "tile_prompt", "detail_negative")}
    job |= {"seed": 1, "color": "#fff", "stage_instruction": "Add a sun."}
    (tmp_path / "jobs.json").write_text(json.dumps({"jobs": [job]}))
    (loaded,) = Job.load(tmp_path / "jobs.json")
    assert (loaded.color, loaded.stage_instruction) == ("#fff", "Add a sun.")


def _figure_kept(out: Image.Image, work, card, tolerance=0) -> bool:
    layer = stage.place(stage.portrait(work, card), out.size)
    solid = ndimage.binary_erosion(np.asarray(layer.getchannel("A")) == 255, iterations=2 if tolerance else 0)
    diff = np.abs(np.asarray(out).astype(int)[solid] - np.asarray(layer.convert("RGB")).astype(int)[solid])
    return diff.mean() <= tolerance


def _scenes(work, card, scores):
    d = work / "stage" / card
    d.mkdir(parents=True)
    for seed, score in scores.items():
        Image.new("RGB", SIZE, (0, 0, seed * 20)).save(d / f"{seed}.png")
        (d / f"{seed}.json").write_text(json.dumps({"aesthetic": score}))


def test_export_lays_the_portrait_over_the_best_scene(tmp_path):
    _final(tmp_path, "bb_amaterasu")
    _scenes(tmp_path, "bb_amaterasu", {10: 0.5, 11: 0.8, 12: 0.6})
    (tmp_path / "stage" / "bb_amaterasu" / "klein-10.png").write_bytes(b"left over from the experiment")
    assert [s for s, _ in stage.candidates(tmp_path, "bb_amaterasu")] == [11, 12, 10]
    big = (SIZE[0] * 2, SIZE[1] * 2)
    stage.export([_job("bb_amaterasu"), _job("bb_kurogane", staged=False)], tmp_path, size=big, dim=0, log=lambda *_: None)
    out = tmp_path / "final" / "staged"
    assert sorted(f.name for f in out.iterdir()) == ["bb_amaterasu.json", "bb_amaterasu.webp"]
    img = Image.open(out / "bb_amaterasu.webp").convert("RGB")
    assert img.size == big
    assert abs(img.getpixel((0, 0))[2] - 220) <= 6  # seed 11's scene
    meta = json.loads((out / "bb_amaterasu.json").read_text())
    assert (meta["seed"], meta["w"], meta["h"]) == (11, *big)
    # the face box follows the figure onto the canvas
    x, y, fw, fh = stage.placement((50, 90), big)
    assert meta["face"] == pytest.approx([(x + 0.25 * fw) / big[0], (y + 0.1 * fh) / big[1], (x + 0.75 * fw) / big[0], (y + 0.3 * fh) / big[1]], abs=1e-3)
    assert stage.sheet(tmp_path, "bb_amaterasu") is not None


def test_export_follows_the_pick_and_redoes_only_on_change(tmp_path):
    _final(tmp_path, "bb_susanoo")
    _scenes(tmp_path, "bb_susanoo", {10: 0.5, 11: 0.8})
    calls = []

    def up(img, size):
        calls.append(size)
        return img.resize(size)

    f = tmp_path / "final" / "staged" / "bb_susanoo.webp"
    stage.export([_job("bb_susanoo")], tmp_path, picks={"bb_susanoo": 10}, upscaler=up, size=SIZE, log=lambda *_: None)
    assert calls == [SIZE] and json.loads(f.with_suffix(".json").read_text())["seed"] == 10
    stage.export([_job("bb_susanoo")], tmp_path, picks={"bb_susanoo": 10}, upscaler=up, size=SIZE, log=lambda *_: None)
    assert len(calls) == 1  # same pick and settings: skipped
    stage.export([_job("bb_susanoo")], tmp_path, picks={"bb_susanoo": 10}, upscaler=up, dim=0.5, size=SIZE, log=lambda *_: None)
    assert len(calls) == 2


def test_pack_ships_the_staged_illustration_with_the_portrait(tmp_path):
    from portraitgen import run

    _final(tmp_path, "bb_susanoo")
    _final(tmp_path, "bb_kurogane")
    _scenes(tmp_path, "bb_susanoo", {10: 0.5})
    stage.export([_job("bb_susanoo")], tmp_path, size=SIZE, log=lambda *_: None)
    z = zipfile.ZipFile(run.pack(tmp_path, tmp_path / "p.zip"))
    assert sorted(z.namelist()) == ["bb_kurogane.webp", "bb_susanoo.webp", "portraits.json", "staged/bb_susanoo.webp"]
    meta = json.loads(z.read("portraits.json"))
    assert meta["bb_susanoo"]["staged"]["w"] == SIZE[0] and "staged" not in meta["bb_kurogane"]


# ---- klein on a tiny model ----


@pytest.fixture(scope="module")
def tiny_klein(tmp_path_factory):
    """A random-weight FLUX.2 [klein] with the real tokenizer, saved like the hub repo."""
    from diffusers import AutoencoderKLFlux2, FlowMatchEulerDiscreteScheduler, Flux2KleinPipeline, Flux2Transformer2DModel
    from transformers import AutoTokenizer, Qwen3Config, Qwen3ForCausalLM

    from portraitgen.klein import KLEIN

    torch.manual_seed(0)
    tokenizer = AutoTokenizer.from_pretrained(KLEIN, subfolder="tokenizer")
    # The pipeline reads hidden layers 9, 18 and 27, so the encoder needs 28.
    hidden = 16
    text_encoder = Qwen3ForCausalLM(
        Qwen3Config(vocab_size=len(tokenizer), hidden_size=hidden, intermediate_size=32, num_hidden_layers=28, num_attention_heads=2, num_key_value_heads=1, head_dim=8)
    )
    transformer = Flux2Transformer2DModel(
        in_channels=16, num_layers=1, num_single_layers=1, attention_head_dim=16, num_attention_heads=2, joint_attention_dim=3 * hidden, timestep_guidance_channels=32, axes_dims_rope=(4, 4, 4, 4), guidance_embeds=False
    )
    vae = AutoencoderKLFlux2(block_out_channels=(8, 16), down_block_types=("DownEncoderBlock2D",) * 2, up_block_types=("UpDecoderBlock2D",) * 2, layers_per_block=1, latent_channels=4, norm_num_groups=4)
    pipe = Flux2KleinPipeline(scheduler=FlowMatchEulerDiscreteScheduler(), vae=vae, text_encoder=text_encoder, tokenizer=tokenizer, transformer=transformer, is_distilled=True)
    path = tmp_path_factory.mktemp("klein")
    pipe.save_pretrained(path)
    return str(path)


def test_paint_keeps_the_figure_and_resumes(tmp_path, tiny_klein, monkeypatch):
    from portraitgen.klein import Klein

    monkeypatch.setattr(stage.detect, "aesthetic", lambda img: 0.5)
    klein = Klein(tiny_klein, device="cpu", dtype=torch.float32)
    _final(tmp_path, "bb_susanoo")
    jobs = [_job("bb_susanoo"), _job("bb_kurogane", staged=False)]
    stage.paint(klein, jobs, tmp_path, seeds=2, seed_offset=5, steps=2, size=SIZE, log=lambda *_: None)
    assert sorted(s for s, _ in stage.candidates(tmp_path, "bb_susanoo")) == [15, 16]
    assert not (tmp_path / "stage" / "bb_kurogane").exists()
    scene = tmp_path / "stage" / "bb_susanoo" / "15.png"
    assert Image.open(scene).size == SIZE
    before = scene.stat().st_mtime_ns
    stage.paint(klein, jobs, tmp_path, seeds=2, seed_offset=5, steps=2, size=SIZE, log=lambda *_: None)
    assert scene.stat().st_mtime_ns == before  # already painted: skipped
    stage.export(jobs, tmp_path, size=SIZE, log=lambda *_: None)
    out = Image.open(tmp_path / "final" / "staged" / "bb_susanoo.webp").convert("RGB")
    assert _figure_kept(out, tmp_path, "bb_susanoo", tolerance=8)  # lossy webp
