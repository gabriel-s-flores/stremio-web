#!/usr/bin/env python3
# Writes a raw PGS (HDMV Presentation Graphic Stream, .sup) subtitle file: a red box with a white
# border shown for one second out of every two, for `seconds` seconds. ffmpeg cannot turn text into
# bitmap subtitles, so this is how the F5.5 test media gets a bitmap track (muxed by make-media.sh).
#   make-pgs.py <out.sup> [seconds]
import struct
import sys

WIDTH, HEIGHT = 1280, 720
BOX_W, BOX_H = 360, 60
BOX_X, BOX_Y = (WIDTH - BOX_W) // 2, 80


def segment(pts, kind, payload):
    return b'PG' + struct.pack('>IIBH', pts, 0, kind, len(payload)) + payload


def rle_line(pixels):
    out = bytearray()
    i = 0
    while i < len(pixels):
        color = pixels[i]
        run = 1
        while i + run < len(pixels) and pixels[i + run] == color and run < 16383:
            run += 1
        if color == 0:
            out += bytes([0, run]) if run < 64 else bytes([0, 0x40 | (run >> 8), run & 0xFF])
        elif run < 3:
            out += bytes([color]) * run
        else:
            out += bytes([0, 0x80 | run, color]) if run < 64 else bytes([0, 0xC0 | (run >> 8), run & 0xFF, color])
        i += run
    return bytes(out + b'\x00\x00')


def bitmap():
    rows = []
    for y in range(BOX_H):
        border = y < 4 or y >= BOX_H - 4
        rows.append(rle_line([2] * BOX_W if border else [2] * 4 + [1] * (BOX_W - 8) + [2] * 4))
    return b''.join(rows)


def display_set(pts, number):
    pcs = struct.pack('>HHBHBBBB', WIDTH, HEIGHT, 0x10, number, 0x80, 0, 0, 1) + struct.pack('>HBBHH', 0, 0, 0, BOX_X, BOX_Y)
    wds = struct.pack('>BBHHHH', 1, 0, BOX_X, BOX_Y, BOX_W, BOX_H)
    # Palette: 1 = red, 2 = white (Y, Cr, Cb, alpha).
    pds = struct.pack('>BB', 0, 0) + bytes([1, 63, 240, 102, 255, 2, 235, 128, 128, 255])
    data = bitmap()
    ods = struct.pack('>HBB', 0, 0, 0xC0) + (len(data) + 4).to_bytes(3, 'big') + struct.pack('>HH', BOX_W, BOX_H) + data
    return (segment(pts, 0x16, pcs) + segment(pts, 0x17, wds) + segment(pts, 0x14, pds) +
            segment(pts, 0x15, ods) + segment(pts, 0x80, b''))


def clear_set(pts, number):
    pcs = struct.pack('>HHBHBBBB', WIDTH, HEIGHT, 0x10, number, 0x00, 0, 0, 0)
    wds = struct.pack('>BBHHHH', 1, 0, BOX_X, BOX_Y, BOX_W, BOX_H)
    return segment(pts, 0x16, pcs) + segment(pts, 0x17, wds) + segment(pts, 0x80, b'')


def main():
    out = sys.argv[1]
    seconds = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    data = bytearray()
    number = 0
    for second in range(0, seconds, 2):
        data += display_set(second * 90000, number)
        data += clear_set((second + 1) * 90000, number + 1)
        number += 2
    with open(out, 'wb') as f:
        f.write(data)


main()
