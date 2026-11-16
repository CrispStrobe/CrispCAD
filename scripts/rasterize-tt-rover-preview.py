#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Depth-buffered CPU preview. Run after npm run build:packages:

node scripts/render-tt-rover-preview.mjs | python scripts/rasterize-tt-rover-preview.py

NumPy/Pillow are optional developer preview tools, not app dependencies.
"""
from pathlib import Path
import json
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

scene = json.load(sys.stdin)
scale = 2
width, height = scene['width'], scene['height']
canvas = Image.new('RGB', (width * scale, height * scale), scene['background'])
draw = ImageDraw.Draw(canvas)
for panel in scene['panels']:
    x, y, w, h = [panel[k] for k in ('x', 'y', 'width', 'height')]
    draw.rounded_rectangle(tuple(v * scale for v in (x, y, x + w, y + h)), radius=24 * scale, fill='white')
pixels = np.array(canvas)
depth = np.full((height * scale, width * scale), -np.inf)
for triangle in scene['triangles']:
    p = np.array(triangle['points'], dtype=float)
    p[:, :2] *= scale
    lo = np.maximum(np.floor(p[:, :2].min(axis=0)).astype(int), [0, 0])
    hi = np.minimum(np.ceil(p[:, :2].max(axis=0)).astype(int), [width * scale - 1, height * scale - 1])
    if np.any(lo > hi):
        continue
    x0, y0, x1, y1 = lo[0], lo[1], hi[0], hi[1]
    x, y = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
    denominator = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
    if abs(denominator) < 1e-12:
        continue
    a = ((p[1, 1] - p[2, 1]) * (x - p[2, 0]) + (p[2, 0] - p[1, 0]) * (y - p[2, 1])) / denominator
    b = ((p[2, 1] - p[0, 1]) * (x - p[2, 0]) + (p[0, 0] - p[2, 0]) * (y - p[2, 1])) / denominator
    c = 1 - a - b
    z = a * p[0, 2] + b * p[1, 2] + c * p[2, 2]
    current = depth[y0:y1 + 1, x0:x1 + 1]
    visible = (a >= -1e-9) & (b >= -1e-9) & (c >= -1e-9) & (z > current)
    current[visible] = z[visible]
    color = [int(triangle['color'][i:i + 2], 16) for i in (0, 2, 4)]
    pixels[y0:y1 + 1, x0:x1 + 1][visible] = color
canvas = Image.fromarray(pixels)
draw = ImageDraw.Draw(canvas)
fonts = {}
for label in scene['texts']:
    key = (label['size'] * scale, label['weight'] == 700)
    if key not in fonts:
        fonts[key] = ImageFont.truetype('DejaVuSans-Bold.ttf' if key[1] else 'DejaVuSans.ttf', key[0])
    draw.text((label['x'] * scale, label['y'] * scale), label['content'], fill=label['color'], font=fonts[key], anchor='ls')
output = Path(__file__).resolve().parent.parent / 'docs/images/scout-tt-electronics-carrier.png'
output.parent.mkdir(parents=True, exist_ok=True)
canvas.resize((width, height), Image.Resampling.LANCZOS).save(output, optimize=True)
print(output)
print('Evaluated CAD source SHA256:', scene['sourceHash'])
