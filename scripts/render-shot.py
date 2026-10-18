#!/usr/bin/env python3
"""Render real terminal output as a screenshot-style PNG.

Takes captured stdout from an actual command run and renders it in a dark
terminal frame. Nothing is invented: the text comes from the command output
passed on stdin, so the image is evidence, not decoration.
"""
import io
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

BG = (13, 17, 23)
CHROME = (22, 27, 34)
BORDER = (48, 54, 61)
FG = (201, 209, 217)
GREEN = (63, 185, 80)
CYAN = (88, 166, 255)
DIM = (139, 148, 158)
YELLOW = (210, 168, 61)
RED = (248, 81, 73)


def font(size, bold=False):
    names = (
        ["C:/Windows/Fonts/consolab.ttf", "C:/Windows/Fonts/Consolas.ttf"]
        if bold
        else ["C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/Consolas.ttf"]
    )
    for n in names:
        if os.path.exists(n):
            return ImageFont.truetype(n, size)
    return ImageFont.load_default()


def color_for(line):
    low = line.lower()
    if "passed" in low or "✓" in line or "ok " in low:
        return GREEN
    if "failed" in low or "error" in low or "✗" in line:
        return RED
    if line.strip().startswith("$") or line.strip().startswith(">"):
        return CYAN
    if "warn" in low or "skip" in low or "pending" in low:
        return YELLOW
    if not line.strip():
        return FG
    return FG


def render(text, title="Terminal", width=1180, out="shot.png",
           font_size=15, line_h=None, pad=26, max_lines=200):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    lines = [ln.rstrip() for ln in lines]
    if len(lines) > max_lines:
        lines = lines[:max_lines]

    f = font(font_size)
    fb = font(font_size, bold=True)
    line_h = line_h or int(font_size * 1.55)

    chrome_h = 42
    height = chrome_h + pad * 2 + line_h * max(len(lines), 1)
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)

    # window chrome
    d.rectangle([0, 0, width, chrome_h], fill=CHROME)
    d.line([(0, chrome_h), (width, chrome_h)], fill=BORDER, width=1)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        cx = 18 + i * 20
        d.ellipse([cx, chrome_h // 2 - 6, cx + 12, chrome_h // 2 + 6], fill=c)
    d.text((92, chrome_h // 2 - font_size // 2 - 1), title, font=fb, fill=DIM)

    # body
    y = chrome_h + pad
    for ln in lines:
        d.text((pad, y), ln, font=f, fill=color_for(ln))
        y += line_h

    img.save(out)
    print(f"saved {out}  ({img.width}x{img.height})")
    return out


if __name__ == "__main__":
    text = sys.stdin.read()
    title = sys.argv[1] if len(sys.argv) > 1 else "Terminal"
    out = sys.argv[2] if len(sys.argv) > 2 else "shot.png"
    render(text, title=title, out=out)
