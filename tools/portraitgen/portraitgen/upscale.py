"""Real-ESRGAN (anime 6B) upscaling ahead of the hires pass.

img2img redraws detail at the resolution it is given, but it only sharpens
what is already there: from a Lanczos-enlarged base the lines stay soft and
low-strength refining leaves smeared trim and blurry buckles. Enlarging with
an anime super-resolution model first gives the refine pass crisp line art
to work from, so it can stay at a low strength and keep the composition.

The network (RRDBNet, as in xinntao/Real-ESRGAN) is small enough to define
here instead of pulling in a model-zoo dependency.
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from torch import nn

WEIGHTS = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"


class _DenseBlock(nn.Module):
    def __init__(self, feat: int = 64, grow: int = 32):
        super().__init__()
        self.conv1 = nn.Conv2d(feat, grow, 3, 1, 1)
        self.conv2 = nn.Conv2d(feat + grow, grow, 3, 1, 1)
        self.conv3 = nn.Conv2d(feat + 2 * grow, grow, 3, 1, 1)
        self.conv4 = nn.Conv2d(feat + 3 * grow, grow, 3, 1, 1)
        self.conv5 = nn.Conv2d(feat + 4 * grow, feat, 3, 1, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        act = lambda t: F.leaky_relu(t, 0.2)  # noqa: E731
        x1 = act(self.conv1(x))
        x2 = act(self.conv2(torch.cat((x, x1), 1)))
        x3 = act(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = act(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        return self.conv5(torch.cat((x, x1, x2, x3, x4), 1)) * 0.2 + x


class _RRDB(nn.Module):
    def __init__(self, feat: int = 64):
        super().__init__()
        self.rdb1, self.rdb2, self.rdb3 = _DenseBlock(feat), _DenseBlock(feat), _DenseBlock(feat)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.rdb3(self.rdb2(self.rdb1(x))) * 0.2 + x


class RRDBNet(nn.Module):
    """4x RRDBNet; parameter names match the released checkpoints."""

    def __init__(self, blocks: int = 6, feat: int = 64):
        super().__init__()
        self.conv_first = nn.Conv2d(3, feat, 3, 1, 1)
        self.body = nn.Sequential(*[_RRDB(feat) for _ in range(blocks)])
        self.conv_body = nn.Conv2d(feat, feat, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(feat, feat, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(feat, feat, 3, 1, 1)
        self.conv_hr = nn.Conv2d(feat, feat, 3, 1, 1)
        self.conv_last = nn.Conv2d(feat, 3, 3, 1, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        act = lambda t: F.leaky_relu(t, 0.2)  # noqa: E731
        feat = self.conv_first(x)
        feat = feat + self.conv_body(self.body(feat))
        feat = act(self.conv_up1(F.interpolate(feat, scale_factor=2, mode="nearest")))
        feat = act(self.conv_up2(F.interpolate(feat, scale_factor=2, mode="nearest")))
        return self.conv_last(act(self.conv_hr(feat)))


class Upscaler:
    scale = 4

    def __init__(self, device: str = "cuda", dtype: torch.dtype = torch.float16, weights: str = WEIGHTS):
        state = torch.hub.load_state_dict_from_url(weights, map_location="cpu", progress=False, weights_only=True)
        state = state.get("params_ema", state)
        self.net = RRDBNet()
        self.net.load_state_dict(state)
        self.net.eval().to(device=device, dtype=dtype)
        self.device, self.dtype = device, dtype

    @torch.no_grad()
    def __call__(self, image: Image.Image, size: tuple[int, int], tile: int = 256, pad: int = 32) -> Image.Image:
        """Upscale 4x in tiles (bounded memory next to SDXL), then resize to size."""
        x = torch.from_numpy(np.asarray(image.convert("RGB"), dtype=np.float32) / 255).permute(2, 0, 1)[None]
        _, _, h, w = x.shape
        out = torch.zeros((1, 3, h * self.scale, w * self.scale))
        s = self.scale
        for y0 in range(0, h, tile):
            for x0 in range(0, w, tile):
                y1, x1 = min(y0 + tile, h), min(x0 + tile, w)
                # Pad each tile with its neighbours' pixels so the seams match.
                py0, px0, py1, px1 = max(y0 - pad, 0), max(x0 - pad, 0), min(y1 + pad, h), min(x1 + pad, w)
                part = self.net(x[:, :, py0:py1, px0:px1].to(self.device, self.dtype)).float().cpu()
                out[:, :, y0 * s : y1 * s, x0 * s : x1 * s] = part[:, :, (y0 - py0) * s : (y1 - py0) * s, (x0 - px0) * s : (x1 - px0) * s]
        arr = (out[0].clamp(0, 1).permute(1, 2, 0).numpy() * 255).round().astype(np.uint8)
        return Image.fromarray(arr).resize(size, Image.LANCZOS)
