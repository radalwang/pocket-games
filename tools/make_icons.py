#!/usr/bin/env python3
"""生成主屏幕图标（PNG），不依赖第三方库。

用法：python3 tools/make_icons.py
图案：和 2048 封面同色系的渐变，上面四个白色圆角方块。
"""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
SIZES = [180, 192, 512]

# 渐变色标：(位置, RGB)，从左上到右下
STOPS = [(0.0, (0xFF, 0xB5, 0x47)), (0.55, (0xFF, 0x6A, 0x3D)), (1.0, (0xFF, 0x2D, 0x6F))]
# 2×2 方块：(行, 列, 不透明度)
TILES = [(0, 0, 1.0), (0, 1, 0.55), (1, 0, 0.72), (1, 1, 0.9)]


def gradient(t):
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            k = (t - t0) / (t1 - t0)
            return [a + (b - a) * k for a, b in zip(c0, c1)]
    return list(STOPS[-1][1])


def rounded_square_distance(x, y, cx, cy, half, radius):
    """点到圆角正方形边缘的有符号距离，里面为负。"""
    qx = abs(x - cx) - (half - radius)
    qy = abs(y - cy) - (half - radius)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - radius


def render(size):
    scale = size / 512
    half = 75 * scale
    gap = 28 * scale
    radius = 34 * scale
    origin = (size - (4 * half + gap)) / 2
    tiles = [
        (origin + half + c * (2 * half + gap), origin + half + r * (2 * half + gap), alpha)
        for r, c, alpha in TILES
    ]
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            color = gradient((px + py) / (2 * size))
            for cx, cy, alpha in tiles:
                if abs(px - cx) > half + 1 or abs(py - cy) > half + 1:
                    continue
                coverage = min(max(0.5 - rounded_square_distance(px, py, cx, cy, half, radius), 0.0), 1.0) * alpha
                color = [ch + (255 - ch) * coverage for ch in color]
            row.extend(int(round(ch)) for ch in color)
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    raw = b''.join(b'\x00' + row for row in rows)
    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )
    with open(path, 'wb') as f:
        f.write(png)


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f'icon-{size}.png')
        write_png(path, size, render(size))
        print('已生成', os.path.relpath(path))
