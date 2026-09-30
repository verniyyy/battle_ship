"""Exercise every SDXL pass on a tiny random-weight pipeline on the CPU.

The images are noise; this checks that the passes are wired correctly
(long-prompt embeddings, sizes, pasting) without a GPU or the real model.
Downloads ~10MB on the first run.
"""

import pytest
import torch
from PIL import Image

from portraitgen.sdxl import Generator

TINY = "hf-internal-testing/tiny-stable-diffusion-xl-pipe"


@pytest.fixture(scope="module")
def gen():
    return Generator(TINY, vae_id=None, device="cpu", dtype=torch.float32, upscaler=False)


def test_weights_stay_in_the_requested_dtype():
    # diffusers' from_pipe defaults to float32 and casts the shared modules
    # in place; in fp16 that doubled SDXL's VRAM and ran a T4 out of memory.
    g = Generator(TINY, vae_id=None, device="cpu", dtype=torch.float16, upscaler=False)
    for pipe in (g.txt2img, g.img2img, g.inpaint):
        for name in ("unet", "vae", "text_encoder", "text_encoder_2"):
            assert getattr(pipe, name).dtype == torch.float16, name


LONG = ", ".join(["1girl", "solo", "full body"] + [f"very detailed ornament number {i}" for i in range(40)])


def test_long_prompt_is_chunked_and_padded(gen):
    e = gen.embed(LONG, "lowres, bad anatomy")
    assert e.prompt.shape == e.negative.shape
    assert e.prompt.shape[1] % 77 == 0 and e.prompt.shape[1] > 77
    assert e.pooled.shape == e.negative_pooled.shape
    assert gen.embed(LONG, "lowres, bad anatomy") is e  # cached


def test_passes_keep_expected_sizes(gen):
    e = gen.embed(LONG, "lowres")
    base = gen.render(e, seed=1, width=64, height=96, steps=2)
    assert base.size == (64, 96)
    big = gen.refine(base, e, seed=1, scale=1.5, strength=0.5, steps=2)
    assert big.size == (96, 144)
    out = gen.detail(big, [(30, 20, 60, 50)], e, seed=1, strength=0.5, size=64, steps=2)
    assert out.size == big.size
    # outside the detailed region the image is untouched
    assert out.getpixel((2, 140)) == big.getpixel((2, 140))
    tiled = gen.tiles(big, [(0, 0, 64, 64), (32, 48, 96, 112)], e, seed=1, strength=0.5, size=64, steps=2)
    assert tiled.size == big.size
    assert tiled.getpixel((2, 140)) == big.getpixel((2, 140))
    assert tiled.getpixel((64, 80)) != big.getpixel((64, 80))


def test_render_is_deterministic_per_seed(gen):
    e = gen.embed("1girl", "lowres")
    a = gen.render(e, seed=5, width=64, height=64, steps=2)
    b = gen.render(e, seed=5, width=64, height=64, steps=2)
    assert a.tobytes() == b.tobytes()
    assert isinstance(a, Image.Image)
