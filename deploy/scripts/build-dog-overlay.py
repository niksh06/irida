#!/usr/bin/env python3
"""
Build a transparent, animated WebP of the blue dog chasing the butterfly for
the desktop overlay (I-97).

The source chase loop is a GIF with a solid white background (no alpha), so it
can't float on a transparent overlay window. This keys out the white (with a
soft edge), crops to the moving content, downscales, and writes an animated
WebP that Chromium/Electron renders with transparency.

Source GIFs are resolved from the pet manifest's workingGif (TPARSER_ROOT) or
the dist/<theme>/working.gif symlink. Output: dist/<theme>/working.webp.

Usage: python3 deploy/scripts/build-dog-overlay.py
"""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

PET_DIR = Path(__file__).resolve().parents[2] / "deploy" / "assets" / "pet"
STATES = ("idle", "working", "happy", "sad", "sleep")
TARGET_WIDTH = 440          # display-ish width; bigger than the 192px terminal art
WHITE_HI = 250              # min channel >= this -> fully transparent
WHITE_LO = 234              # min channel <= this -> fully opaque (soft edge between)
FLOOR_REGION = 0.30         # scan the bottom 30% of the frame for the ground line
FLOOR_DARK_MAX = 95         # a pixel is "dark" when its brightest channel < this
FLOOR_FILL = 0.42           # a row that is >= this fraction dark is the floor -> erase


def key_white(frame: Image.Image) -> Image.Image:
    """Make near-white pixels transparent with a soft edge to keep outlines crisp."""
    rgba = frame.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    span = WHITE_HI - WHITE_LO
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            m = min(r, g, b)
            if m >= WHITE_HI:
                px[x, y] = (r, g, b, 0)
            elif m > WHITE_LO:
                px[x, y] = (r, g, b, int(a * (WHITE_HI - m) / span))
            # else: leave fully opaque
    return rgba


def remove_floor(frame: Image.Image) -> None:
    """Erase the wide near-black ground line the GIF draws under the dog.

    A floor row is almost entirely dark across the width; the dog's own rows are
    mostly blue fill with only a thin dark outline, so they never qualify.
    """
    px = frame.load()
    w, h = frame.size
    start = int(h * (1 - FLOOR_REGION))
    for y in range(start, h):
        dark = 0
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 0 and max(r, g, b) < FLOOR_DARK_MAX:
                dark += 1
        if dark >= w * FLOOR_FILL:
            for x in range(w):
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)


def load_frames(gif_path: Path) -> tuple[list[Image.Image], list[int]]:
    gif = Image.open(gif_path)
    frames: list[Image.Image] = []
    durations: list[int] = []
    for i in range(gif.n_frames):
        gif.seek(i)
        f = key_white(gif)
        remove_floor(f)
        frames.append(f)
        durations.append(gif.info.get("duration", 80) or 80)
    return frames, durations


def union_bbox(frames: list[Image.Image]) -> tuple[int, int, int, int]:
    box = None
    for f in frames:
        b = f.getbbox()  # bbox of non-zero (non-transparent) region
        if b is None:
            continue
        if box is None:
            box = list(b)
        else:
            box[0] = min(box[0], b[0])
            box[1] = min(box[1], b[1])
            box[2] = max(box[2], b[2])
            box[3] = max(box[3], b[3])
    return tuple(box) if box else (0, 0, frames[0].width, frames[0].height)


def build(gif_path: Path, out_path: Path) -> None:
    frames, durations = load_frames(gif_path)
    box = union_bbox(frames)
    cropped = [f.crop(box) for f in frames]
    cw, ch = cropped[0].size
    scale = TARGET_WIDTH / cw
    size = (TARGET_WIDTH, max(1, round(ch * scale)))
    resized = [f.resize(size, Image.LANCZOS) for f in cropped]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    resized[0].save(
        out_path,
        format="WEBP",
        save_all=True,
        append_images=resized[1:],
        duration=durations,
        loop=0,
        disposal=2,
        quality=82,
        method=6,
        allow_mixed=True,
    )
    print(f"  {out_path.relative_to(PET_DIR.parents[2])}  "
          f"({len(resized)} frames, crop {box} -> {size}, {out_path.stat().st_size // 1024} KB)")


def resolve_gif(theme: str, state: str) -> Path | None:
    # dist/<theme>/<state>.gif (working.gif is a symlink to the TParser source).
    # Drop a pes_<state>.gif here and it becomes an animated state automatically.
    link = PET_DIR / "dist" / theme / f"{state}.gif"
    if link.exists():
        return link.resolve()
    return None


def main() -> None:
    built = 0
    for theme in ("light", "dark"):
        for state in STATES:
            gif = resolve_gif(theme, state)
            if not gif or not gif.exists():
                continue
            out = PET_DIR / "dist" / theme / f"{state}.webp"
            print(f"{theme}/{state}: {gif}")
            build(gif, out)
            built += 1
    if built == 0:
        print("no <state>.gif sources found under dist/<theme>/ (need TParser symlinks)")
    else:
        print(f"built {built} animated webp(s)")


if __name__ == "__main__":
    main()
