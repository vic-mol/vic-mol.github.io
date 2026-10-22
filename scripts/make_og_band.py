#!/usr/bin/env python3
"""Write assets/images/og/band.png, the translucent band behind the text of the Open Graph cards.

The band is 1200x290 RGBA, #0E1B2A (Bay Navy, darkened) at 78% opacity, i.e. rgba(14, 27, 42, 199).
partials/og-image.html lays it over the lower part of the 1200x630 card at y = 340.

It is a one-time job: the PNG is committed. Run it again only to change the colour or the size.

    python scripts/make_og_band.py [--out assets/images/og/band.png]

Requires Pillow. The PNG carries no text chunks, EXIF or colour profile.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

WIDTH, HEIGHT = 1200, 290
COLOR = (14, 27, 42)  # #0E1B2A
OPACITY = 0.78  # 78%
ALPHA = round(255 * OPACITY)  # 199

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "assets" / "images" / "og" / "band.png"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"output PNG (default: {DEFAULT_OUT})")
    args = parser.parse_args(argv)

    band = Image.new("RGBA", (WIDTH, HEIGHT), (*COLOR, ALPHA))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    band.save(args.out, format="PNG", optimize=True)

    check = Image.open(args.out)
    if check.size != (WIDTH, HEIGHT) or check.mode != "RGBA" or check.getpixel((0, 0)) != (*COLOR, ALPHA):
        print(f"error: {args.out} does not match the expected band", file=sys.stderr)
        return 1
    if check.getexif():
        print(f"error: {args.out} carries an EXIF block", file=sys.stderr)
        return 1
    print(f"wrote {args.out} ({WIDTH}x{HEIGHT} RGBA, rgba{(*COLOR, ALPHA)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
