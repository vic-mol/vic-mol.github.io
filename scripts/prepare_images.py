#!/usr/bin/env python3
"""Turn an original photo into a web master for assets/images/<role>/<name>.jpg (PLAN section 7.1).

    python scripts/prepare_images.py --src <original> --out assets/images/<role>/<name>.jpg
                                     [--crop l,t,r,b] [--max 2000]

What it does, in order:
  1. opens the original and applies its EXIF orientation (a Kodak file with no tag is left as it is);
  2. crops to the box l,t,r,b, given in pixels of the already-oriented picture (optional);
  3. shrinks it so the long edge is at most --max pixels (never enlarges). Default: 2560 when the
     output sits in a "backgrounds" folder, 2000 for everything else;
  4. saves a progressive JPEG, quality 86, WITHOUT any metadata (no EXIF, no GPS, no XMP, no ICC);
  5. re-reads the file it wrote and FAILS (exit 1, output deleted) if it still has an EXIF block.

Originals stay out of git (/_photos-src/ is ignored). Names are lowercase kebab-case ASCII that
describe the content, e.g. sf-cable-car-powell-mason.jpg.

Exit codes: 0 ok, 1 the result still had metadata or could not be written, 2 bad arguments or input.
Requires Pillow.
"""
from __future__ import annotations

import argparse
import os
import re
import struct
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

QUALITY = 86
DEFAULT_MAX = 2000
BACKGROUND_MAX = 2560
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*\.jpg$")


def jpeg_segments(data: bytes):
    """Yield (marker, payload) for every marker segment before the start of the image data."""
    if data[:2] != b"\xff\xd8":
        raise ValueError("not a JPEG file")
    pos = 2
    while pos + 4 <= len(data):
        if data[pos] != 0xFF:
            return
        marker = data[pos + 1]
        if marker == 0xFF:  # fill byte
            pos += 1
            continue
        if marker == 0xDA or marker == 0xD9:  # start of scan / end of image: metadata is over
            return
        (length,) = struct.unpack(">H", data[pos + 2 : pos + 4])
        yield marker, data[pos + 4 : pos + 2 + length]
        pos += 2 + length


def leftover_metadata(path: Path) -> list[str]:
    """Names of metadata blocks still present in the JPEG at `path` (empty list = clean)."""
    found: list[str] = []
    data = path.read_bytes()
    for marker, payload in jpeg_segments(data):
        if marker == 0xE1 and payload.startswith(b"Exif\x00"):
            found.append("EXIF (APP1)")
        elif marker == 0xE1 and payload.startswith(b"http://ns.adobe.com/xap/"):
            found.append("XMP (APP1)")
        elif marker == 0xE2 and payload.startswith(b"ICC_PROFILE"):
            found.append("ICC profile (APP2)")
        elif marker == 0xED:
            found.append("Photoshop/IPTC (APP13)")
        elif marker == 0xFE:
            found.append("comment (COM)")
    with Image.open(path) as im:
        if im.getexif() and "EXIF (APP1)" not in found:
            found.append("EXIF (Pillow)")
    return found


def parse_crop(text: str, size: tuple[int, int]) -> tuple[int, int, int, int]:
    """Parse "l,t,r,b" and check it lies inside `size`; raise ValueError with a readable message if not."""
    try:
        left, top, right, bottom = (int(v) for v in text.split(","))
    except ValueError:
        raise ValueError(f"--crop must be four integers l,t,r,b, got {text!r}") from None
    width, height = size
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        raise ValueError(
            f"--crop {text} does not fit inside the oriented picture ({width}x{height}); "
            "it must satisfy 0 <= l < r <= width and 0 <= t < b <= height"
        )
    return left, top, right, bottom


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--src", required=True, type=Path, help="original photo (any format Pillow reads)")
    parser.add_argument("--out", required=True, type=Path, help="destination, e.g. assets/images/gallery/sf-marina-sunrise.jpg")
    parser.add_argument("--crop", help="crop box l,t,r,b in pixels of the oriented picture")
    parser.add_argument(
        "--max",
        type=int,
        default=None,
        help=f"longest edge in pixels (default {BACKGROUND_MAX} for a backgrounds/ output, {DEFAULT_MAX} otherwise)",
    )
    args = parser.parse_args(argv)

    if not args.src.is_file():
        print(f"error: source not found: {args.src}", file=sys.stderr)
        return 2
    if args.out.suffix.lower() != ".jpg":
        print(f"error: --out must end in .jpg, got {args.out.name}", file=sys.stderr)
        return 2
    if not NAME_RE.match(args.out.name):
        print(f"error: --out name {args.out.name!r} must be lowercase kebab-case ASCII (a-z, 0-9, '-') and describe the picture", file=sys.stderr)
        return 2
    if args.out.exists() and args.src.resolve() == args.out.resolve():
        print("error: --src and --out are the same file", file=sys.stderr)
        return 2
    limit = args.max if args.max is not None else (BACKGROUND_MAX if args.out.parent.name == "backgrounds" else DEFAULT_MAX)
    if limit < 16:
        print(f"error: --max {limit} is too small", file=sys.stderr)
        return 2

    try:
        with Image.open(args.src) as original:
            image = ImageOps.exif_transpose(original)  # a copy, rotated per the EXIF orientation tag
            image = image.convert("RGB")
    except Exception as exc:  # noqa: BLE001 - report any decoder problem plainly
        print(f"error: cannot read {args.src}: {exc}", file=sys.stderr)
        return 2
    oriented_size = image.size

    if args.crop:
        try:
            image = image.crop(parse_crop(args.crop, image.size))
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
    longest = max(image.size)
    if longest > limit:
        scale = limit / longest
        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".prepare-", suffix=".jpg", dir=args.out.parent)
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        # No exif=, icc_profile= or similar keyword: Pillow then writes no metadata at all.
        image.save(tmp, format="JPEG", quality=QUALITY, progressive=True, optimize=True)
        leftovers = leftover_metadata(tmp)
        if leftovers:
            print(f"error: the output still carries metadata ({', '.join(leftovers)}); nothing was written", file=sys.stderr)
            return 1
        os.replace(tmp, args.out)
    except Exception as exc:  # noqa: BLE001
        print(f"error: could not write {args.out}: {exc}", file=sys.stderr)
        return 1
    finally:
        if tmp.exists():
            tmp.unlink()

    # Final check on the file that is really at --out; delete it if it is not clean.
    leftovers = leftover_metadata(args.out)
    if leftovers:
        args.out.unlink()
        print(f"error: {args.out} still carries metadata ({', '.join(leftovers)}); deleted", file=sys.stderr)
        return 1

    size_kb = args.out.stat().st_size / 1024
    print(
        f"wrote {args.out}: {image.width}x{image.height} px (original, oriented: {oriented_size[0]}x{oriented_size[1]}), "
        f"{size_kb:.0f} KB, progressive JPEG q{QUALITY}, no metadata"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
