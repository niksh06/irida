#!/usr/bin/env python3
"""
Synthesize looping animated WebPs for the non-chase pet states from the static
transparent sprites (I-97 desktop overlay).

We only have one hand-drawn GIF (the chase = working). To make every state feel
alive "like the gif", this bakes procedural, foot-anchored motion into real
frames per state:

  idle   gentle breathing + tiny bob
  happy  springy double bounce with squash & stretch
  sad    slow, low droop
  sleep  slow breathing + rising "zZz"

Source: deploy/assets/pet/dist/<theme>/<state>.png  (RGBA, white already keyed)
Output: deploy/assets/pet/dist/<theme>/<state>.webp

Usage: python3 deploy/scripts/build-dog-states.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PET_DIR = Path(__file__).resolve().parents[2] / "deploy" / "assets" / "pet"
PAD_TOP, PAD_X, PAD_BOTTOM = 40, 18, 2

# (frames, duration_ms) per state
TIMING = {
    "idle": (24, 70),
    "happy": (20, 55),
    "sad": (24, 120),
    "sleep": (28, 120),
}

ZZZ_COLOR = {"light": (100, 149, 237), "dark": (125, 211, 252)}


def _load_font(size: int) -> ImageFont.ImageFont:
    for path in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _place(canvas: Image.Image, sprite: Image.Image, sx: float, sy: float, lift: float) -> None:
    """Scale `sprite` by (sx, sy) and paste foot-anchored (bottom-center), lifted by `lift`px."""
    w, h = sprite.size
    sw, sh = max(1, round(w * sx)), max(1, round(h * sy))
    scaled = sprite.resize((sw, sh), Image.LANCZOS)
    cw, ch = canvas.size
    x = (cw - sw) // 2
    y = (ch - PAD_BOTTOM) - sh - round(lift)
    canvas.alpha_composite(scaled, (x, y))


def _frame(sprite: Image.Image, cw: int, ch: int) -> Image.Image:
    return Image.new("RGBA", (cw, ch), (0, 0, 0, 0))


def synth(state: str, sprite: Image.Image, theme: str) -> tuple[list[Image.Image], list[int]]:
    n, dur = TIMING[state]
    w, h = sprite.size
    cw, ch = w + 2 * PAD_X, h + PAD_TOP + PAD_BOTTOM
    frames: list[Image.Image] = []
    font = _load_font(22)
    font_sm = _load_font(15)

    for t in range(n):
        p = t / n
        cv = _frame(sprite, cw, ch)
        if state == "idle":
            f = math.sin(p * 2 * math.pi)
            _place(cv, sprite, 1.0 - 0.008 * f, 1.0 + 0.015 * f, 1.2 * (0.5 - 0.5 * math.cos(p * 2 * math.pi)))
        elif state == "happy":
            bp = (p * 2.0) % 1.0
            f = math.sin(bp * math.pi)  # 0 at contact, 1 at apex
            _place(cv, sprite, 1.08 - 0.12 * f, 0.90 + 0.16 * f, 14 * f)
        elif state == "sad":
            d = 0.5 - 0.5 * math.cos(p * 2 * math.pi)  # 0..1..0, slow
            _place(cv, sprite, 1.0 + 0.012 * d, 1.0 - 0.02 * d, -2.0 * d)
        elif state == "sleep":
            br = math.sin(p * 2 * math.pi)
            _place(cv, sprite, 1.0 - 0.006 * br, 1.0 + 0.012 * br, 0)
            draw = ImageDraw.Draw(cv)
            r, g, b = ZZZ_COLOR[theme]
            for k, (ch_, fnt) in enumerate(((("z"), font_sm), (("Z"), font))):
                ph = (p + k * 0.5) % 1.0
                zx = int(cw * 0.60 + k * 10)
                zy = int((PAD_TOP - 4) - ph * (PAD_TOP - 12))
                a = int(255 * max(0.0, 1.0 - ph) * min(1.0, ph * 8))
                draw.text((zx, zy), ch_, font=fnt, fill=(r, g, b, a))
        frames.append(cv)
    return frames, [dur] * n


def build_state(theme: str, state: str) -> bool:
    src = PET_DIR / "dist" / theme / f"{state}.png"
    if not src.exists():
        return False
    sprite = Image.open(src).convert("RGBA")
    frames, durations = synth(state, sprite, theme)
    out = PET_DIR / "dist" / theme / f"{state}.webp"
    frames[0].save(
        out,
        format="WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        quality=90,
        method=6,
    )
    print(f"  {theme}/{state}: {len(frames)} frames -> {out.name} ({out.stat().st_size // 1024} KB)")
    return True


def main() -> None:
    built = 0
    for theme in ("light", "dark"):
        for state in ("idle", "happy", "sad", "sleep"):
            if build_state(theme, state):
                built += 1
    print(f"built {built} synthesized state webp(s)")


if __name__ == "__main__":
    main()
