#!/usr/bin/env python3
"""Build csagent pet still assets (I-97): resize, matte key, light/dark variants.

Requires: pip install Pillow

Usage:
  python3 deploy/scripts/build-pet-assets.py
  python3 deploy/scripts/build-pet-assets.py --width 192 --pet-dir deploy/assets/pet

Input:  deploy/assets/pet/source/{idle,happy,sad,sleep}.png
Output: deploy/assets/pet/dist/light|dark/{state}.png

Optional: set TPARSER_ROOT to symlink working GIF into dist/ (not copied by default).
After Aseprite polish, overwrite source/*.png and re-run.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image, ImageEnhance
except ImportError:
    print("build-pet-assets: install Pillow — pip install Pillow", file=sys.stderr)
    sys.exit(70)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PET_DIR = REPO_ROOT / "deploy" / "assets" / "pet"

DOG_BLUE = (100, 149, 237)  # #6495ED
ACCENT_CORE = (56, 189, 248)  # #38bdf8
ACCENT_SOFT = (125, 211, 252)  # #7dd3fc
MATTE_TOL = 28
STATIC_STATES = ("idle", "happy", "sad", "sleep")
TERMINAL_WIDTH = 22
TERMINAL_PALETTE = {
    "dog": DOG_BLUE,
    "outline": (0, 0, 0),
    "butterfly": ACCENT_SOFT,
}
WORKING_GIF_FRAMES = 4


def _lum(r: int, g: int, b: int) -> float:
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def key_white_matte(rgba: Image.Image, tol: int = MATTE_TOL) -> Image.Image:
    """Transparent matte from corner reference (white/light bg)."""
    w, h = rgba.size
    inset = 2
    corners = [
        rgba.getpixel((inset, inset)),
        rgba.getpixel((w - 1 - inset, inset)),
        rgba.getpixel((inset, h - 1 - inset)),
        rgba.getpixel((w - 1 - inset, h - 1 - inset)),
    ]
    ref_r = sum(p[0] for p in corners) // 4
    ref_g = sum(p[1] for p in corners) // 4
    ref_b = sum(p[2] for p in corners) // 4

    out = Image.new("RGBA", rgba.size)
    od = out.load()
    rd = rgba.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = rd[x, y]
            if a < 16:
                od[x, y] = (0, 0, 0, 0)
                continue
            if (
                abs(r - ref_r) <= tol
                and abs(g - ref_g) <= tol
                and abs(b - ref_b) <= tol
            ):
                od[x, y] = (0, 0, 0, 0)
            else:
                od[x, y] = (r, g, b, a)
    return out


def snap_dog_fill(rgba: Image.Image) -> Image.Image:
    """Nudge saturated blue fills toward TParser dog blue."""
    out = rgba.copy()
    od = out.load()
    dr, dg, db = DOG_BLUE
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = od[x, y]
            if a < 200:
                continue
            if b > r + 20 and b > g and _lum(r, g, b) > 80:
                od[x, y] = (dr, dg, db, a)
    return out


def recolor_butterfly_outlines(rgba: Image.Image, dark: bool) -> Image.Image:
    """Tint light cyan outline pixels (butterfly / dashed trails)."""
    out = rgba.copy()
    od = out.load()
    w, h = out.size
    core = ACCENT_CORE if dark else ACCENT_SOFT
    hr, hg, hb = ACCENT_SOFT if dark else (180, 220, 255)
    for y in range(h):
        for x in range(w):
            r, g, b, a = od[x, y]
            if a < 180:
                continue
            if b > 160 and g > 140 and r < 120 and _lum(r, g, b) > 140:
                t = min(1.0, (b - 140) / 80.0)
                nr = int(r * (1 - t) + core[0] * t)
                ng = int(g * (1 - t) + core[1] * t)
                nb = int(b * (1 - t) + core[2] * t)
                od[x, y] = (nr, ng, nb, a)
            elif b > 200 and g > 200 and r > 200 and a < 255:
                od[x, y] = (hr, hg, hb, min(255, a + 40))
    return out


def tune_dark(rgba: Image.Image) -> Image.Image:
    f = ImageEnhance.Brightness(rgba).enhance(0.94)
    f = ImageEnhance.Color(f).enhance(0.84)
    f = ImageEnhance.Contrast(f).enhance(0.98)
    return f


def resize_width(img: Image.Image, width: int) -> Image.Image:
    if img.width == width:
        return img
    ratio = width / img.width
    height = max(1, int(img.height * ratio))
    return img.resize((width, height), Image.Resampling.LANCZOS)


def process_still(src: Path, width: int) -> tuple[Image.Image, Image.Image]:
    raw = Image.open(src).convert("RGBA")
    sized = resize_width(raw, width)
    keyed = key_white_matte(sized)
    snapped = snap_dog_fill(keyed)
    light = recolor_butterfly_outlines(snapped, dark=False)
    dark = recolor_butterfly_outlines(tune_dark(snapped.copy()), dark=True)
    return light, dark


def _classify_pixel(r: int, g: int, b: int, a: int) -> str | None:
    if a < 40:
        return None
    lum = _lum(r, g, b)
    if lum < 45:
        return "outline"
    if b > r + 12 and b > g + 5 and lum > 65:
        return "dog"
    if b > 150 and g > 130 and r < 130:
        return "butterfly"
    if lum > 240:
        return None
    if b > r and g > r:
        return "butterfly"
    return "outline"


def _color_for_label(label: str | None) -> tuple[int, int, int] | None:
    if label is None:
        return None
    return TERMINAL_PALETTE.get(label, TERMINAL_PALETTE["outline"])


def _hex_rgb(t: tuple[int, int, int]) -> str:
    return f"#{t[0]:02x}{t[1]:02x}{t[2]:02x}"


def _crop_opaque(img: Image.Image) -> Image.Image:
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def png_to_terminal_frame(img: Image.Image, tw: int = TERMINAL_WIDTH) -> list[list[dict]]:
    """Half-block (▀▄) terminal art with dog palette — 2px vertical per row."""
    cropped = _crop_opaque(img)
    w, h = cropped.size
    th = max(1, round(h * tw / w / 2))
    small = cropped.resize((tw, th * 2), Image.Resampling.LANCZOS)
    px = small.load()
    grid: list[list[tuple[str, tuple[int, int, int] | None, tuple[int, int, int] | None]]] = []
    for row in range(th):
        row_cells: list[tuple[str, tuple[int, int, int] | None, tuple[int, int, int] | None]] = []
        for x in range(tw):
            t = px[x, row * 2]
            b = px[x, row * 2 + 1]
            tc = _color_for_label(_classify_pixel(*t))
            bc = _color_for_label(_classify_pixel(*b))
            if tc is None and bc is None:
                row_cells.append((" ", None, None))
            elif tc is None:
                row_cells.append(("▄", bc, None))
            elif bc is None:
                row_cells.append(("▀", tc, None))
            else:
                row_cells.append(("▀", tc, bc))
        grid.append(row_cells)

    left = tw
    right = -1
    for row in grid:
        for x, (ch, _, _) in enumerate(row):
            if ch != " ":
                left = min(left, x)
                right = max(right, x)
    if right < left:
        return []

    lines: list[list[dict]] = []
    for row in grid:
        segs: list[dict] = []
        cur_key = None
        buf = ""
        for x in range(left, right + 1):
            ch, fg, bg = row[x]
            key = (ch, fg, bg)
            if key != cur_key:
                if buf and cur_key is not None:
                    cf, cb = cur_key[1], cur_key[2]
                    segs.append(
                        {
                            "t": buf,
                            "f": _hex_rgb(cf) if cf else None,
                            "b": _hex_rgb(cb) if cb else None,
                        }
                    )
                buf = ch
                cur_key = key
            else:
                buf += ch
        if buf and cur_key is not None:
            cf, cb = cur_key[1], cur_key[2]
            segs.append(
                {
                    "t": buf,
                    "f": _hex_rgb(cf) if cf else None,
                    "b": _hex_rgb(cb) if cb else None,
                }
            )
        if segs:
            lines.append(segs)
    return lines


def build_terminal_art(pet_dir: Path, manifest: dict) -> int:
    """Emit deploy/assets/pet/terminal/{theme}/{state}.json for Ink TUI."""
    built = 0
    states = manifest.get("states") or {}
    for theme in ("light", "dark"):
        out_theme = pet_dir / "terminal" / theme
        out_theme.mkdir(parents=True, exist_ok=True)
        for name in STATIC_STATES:
            dist_png = pet_dir / "dist" / theme / f"{name}.png"
            if not dist_png.is_file():
                continue
            frame = png_to_terminal_frame(Image.open(dist_png).convert("RGBA"))
            payload = {"version": 1, "width": TERMINAL_WIDTH, "frames": [{"lines": frame}]}
            (out_theme / f"{name}.json").write_text(
                json.dumps(payload, separators=(",", ":")), encoding="utf-8"
            )
            built += 1

        working_path = pet_dir / "dist" / theme / "working.gif"
        if working_path.is_file():
            gif = Image.open(working_path)
            n = getattr(gif, "n_frames", 1)
            step = max(1, n // WORKING_GIF_FRAMES)
            frames: list[dict] = []
            for i in range(0, n, step):
                if len(frames) >= WORKING_GIF_FRAMES:
                    break
                gif.seek(i)
                frame_rgba = gif.convert("RGBA")
                keyed = key_white_matte(frame_rgba)
                snapped = snap_dog_fill(keyed)
                colored = recolor_butterfly_outlines(
                    tune_dark(snapped.copy()) if theme == "dark" else snapped,
                    dark=(theme == "dark"),
                )
                lines = png_to_terminal_frame(colored)
                if lines:
                    frames.append({"lines": lines})
            if frames:
                payload = {"version": 1, "width": TERMINAL_WIDTH, "frames": frames}
                (out_theme / "working.json").write_text(
                    json.dumps(payload, separators=(",", ":")), encoding="utf-8"
                )
                built += 1
                print(f"ok    terminal/{theme}/working.json ({len(frames)} frames)")
        else:
            # Fallback: duplicate idle animation hint from reference stills
            idle_json = out_theme / "idle.json"
            if idle_json.is_file():
                shutil.copy2(idle_json, out_theme / "working.json")
                built += 1

        for name in STATIC_STATES:
            j = out_theme / f"{name}.json"
            if j.is_file():
                print(f"ok    terminal/{theme}/{name}.json")

    return built


def link_working_gif(pet_dir: Path, manifest: dict) -> None:
    spec = manifest.get("workingGif") or {}
    root = os.environ.get(spec.get("env", "TPARSER_ROOT"), "")
    if not root:
        print("build-pet-assets: skip working GIF (set TPARSER_ROOT)")
        return
    base = Path(root)
    rel = spec.get("relative")
    rel_dark = spec.get("darkRelative")
    if not rel:
        return
    src = base / rel
    if not src.is_file():
        print(f"build-pet-assets: working GIF missing: {src}")
        return
    for theme, path in (("light", rel), ("dark", rel_dark or rel)):
        dst_dir = pet_dir / "dist" / theme
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst = dst_dir / "working.gif"
        src_path = base / path
        if src_path.is_file():
            if dst.exists() or dst.is_symlink():
                dst.unlink()
            dst.symlink_to(src_path.resolve())
            print(f"ok    {theme}/working.gif -> {src_path}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Build pet still assets for csagent overlay (I-97)")
    ap.add_argument("--pet-dir", type=Path, default=DEFAULT_PET_DIR)
    ap.add_argument("--width", type=int, default=0, help="override manifest targetWidth")
    args = ap.parse_args()

    pet_dir: Path = args.pet_dir.resolve()
    manifest_path = pet_dir / "manifest.json"
    if not manifest_path.is_file():
        print(f"build-pet-assets: missing {manifest_path}", file=sys.stderr)
        return 78

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    width = args.width or int(manifest.get("targetWidth", 192))
    states = manifest.get("states") or {}

    ok = 0
    for name in STATIC_STATES:
        spec = states.get(name) or {}
        rel = spec.get("source")
        if not rel:
            print(f"skip  {name}: no source in manifest")
            continue
        src = pet_dir / rel
        if not src.is_file():
            print(f"FAIL  {name}: missing {src}", file=sys.stderr)
            return 70
        light, dark = process_still(src, width)
        for theme, img in (("light", light), ("dark", dark)):
            out_dir = pet_dir / "dist" / theme
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / f"{name}.png"
            img.save(out_path, optimize=True)
        print(f"ok    {name}.png -> dist/light|dark ({width}px wide)")
        ok += 1

    link_working_gif(pet_dir, manifest)
    term = build_terminal_art(pet_dir, manifest)
    print(f"build-pet-assets: {ok} stills built, {term} terminal arts")
    return 0 if ok else 70


if __name__ == "__main__":
    raise SystemExit(main())
