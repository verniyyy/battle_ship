"""Staged illustrations: composition helpers, and both painters on tiny models.

The inpaint painter runs on the tiny SDXL test pipe; the klein painter on a
random-weight FLUX.2 [klein] built here with the real tokenizer (a few MB
download on the first run). The images are noise; the tests check the
wiring and that the figure always comes back untouched.
"""

import json
import zipfile

import numpy as np
import pytest
import torch
from PIL import Image

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


def test_paint_mask_leaves_the_figure_core_alone():
    layer = stage.place(_cut(), SIZE)
    m = np.asarray(stage.paint_mask(layer, inset=2, feather=0))
    alpha = np.asarray(layer.getchannel("A"))
    ys, xs = np.nonzero(alpha > 128)
    cy, cx = int(ys.mean()), int(xs.mean())
    assert m[cy, cx] == 0 and m[0, 0] == 255
    # the band just inside the edge is painted too
    assert m[cy, xs.max()] == 255


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
        j.stage_prompt = "1girl, solo, sun, light rays"
        j.stage_negative = "lowres"
        j.stage_instruction = "Add a sunrise behind the girl. Keep the girl exactly as she is."
    return j


def _final(work, card, size=(40, 80)):
    d = work / "final"
    d.mkdir(parents=True, exist_ok=True)
    _cut(*size).save(d / f"{card}.webp", lossless=True)


def test_only_cards_with_a_stage_are_painted():
    assert [j.id for j in stage.staged([_job("a"), _job("b", staged=False)])] == ["a"]


def test_job_load_reads_the_stage(tmp_path):
    job = {k: "x" for k in ("id", "name", "prompt", "negative", "face_prompt", "hand_prompt", "tile_prompt", "detail_negative")}
    job |= {"seed": 1, "color": "#fff", "stage_prompt": "sun", "stage_negative": "lowres", "stage_instruction": "Add a sun."}
    (tmp_path / "jobs.json").write_text(json.dumps({"jobs": [job]}))
    (loaded,) = Job.load(tmp_path / "jobs.json")
    assert (loaded.color, loaded.stage_prompt, loaded.stage_instruction) == ("#fff", "sun", "Add a sun.")


# ---- painters on tiny models ----


def _figure_kept(out: Image.Image, work, card) -> bool:
    layer = stage.place(stage.portrait(work, card), out.size)
    solid = np.asarray(layer.getchannel("A")) == 255
    return (np.asarray(out)[solid] == np.asarray(layer.convert("RGB"))[solid]).all()


def test_inpaint_painter_keeps_the_figure_and_resumes(tmp_path):
    from portraitgen.sdxl import Generator

    gen = Generator("hf-internal-testing/tiny-stable-diffusion-xl-pipe", vae_id=None, device="cpu", dtype=torch.float32, upscaler=False)
    _final(tmp_path, "bb_amaterasu")
    jobs = [_job("bb_amaterasu"), _job("bb_kurogane", staged=False)]
    stage.paint_inpaint(gen, jobs, tmp_path, seeds=2, steps=2, size=SIZE, log=lambda *_: None)
    files = stage.results(tmp_path, "bb_amaterasu")
    assert [f.name for f in files] == ["inpaint-10.png", "inpaint-11.png"]
    out = Image.open(files[0]).convert("RGB")
    assert out.size == SIZE
    assert _figure_kept(out, tmp_path, "bb_amaterasu")
    assert not (tmp_path / "stage" / "bb_kurogane").exists()
    before = files[0].stat().st_mtime_ns
    stage.paint_inpaint(gen, jobs, tmp_path, seeds=2, steps=2, size=SIZE, log=lambda *_: None)
    assert files[0].stat().st_mtime_ns == before  # already painted: skipped


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


def test_klein_painter_keeps_the_figure_and_the_raw_edit(tmp_path, tiny_klein):
    from portraitgen.klein import Klein

    klein = Klein(tiny_klein, device="cpu", dtype=torch.float32)
    _final(tmp_path, "bb_susanoo")
    stage.paint_klein(klein, [_job("bb_susanoo")], tmp_path, seeds=2, steps=2, size=SIZE, log=lambda *_: None)
    names = [f.name for f in stage.results(tmp_path, "bb_susanoo")]
    assert names == ["klein-10.png", "klein-10.raw.png", "klein-11.png", "klein-11.raw.png"]
    out = Image.open(tmp_path / "stage" / "bb_susanoo" / "klein-10.png").convert("RGB")
    raw = Image.open(tmp_path / "stage" / "bb_susanoo" / "klein-10.raw.png").convert("RGB")
    assert out.size == raw.size == SIZE
    assert _figure_kept(out, tmp_path, "bb_susanoo")
    assert stage.sheet(tmp_path, "bb_susanoo") is not None
    assert "bb_susanoo/klein-10.png" in zipfile.ZipFile(stage.pack(tmp_path, tmp_path / "s.zip")).namelist()
