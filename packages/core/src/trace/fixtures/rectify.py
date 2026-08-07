#!/usr/bin/env python3
"""Derive `cartoon-rectified.png` from `cartoon-photo-workbench.jpg` (F-059).

The autotrace pipeline takes an already-rectified raster, because F-051 owns the
four-corner perspective correction (see this directory's README). This script performs
that one correction on the committed photo so the derived fixture is reproducible rather
than a mystery blob: run it and it rewrites `cartoon-rectified.png` byte-for-byte.

    python3 rectify.py            # needs numpy + pillow, dev-only

It is deliberately *not* part of the build or the test run: the output is committed, and
`@vitrum/core` has no image decoder (and must not grow one — it is a pure domain package).
"""

from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).parent
SRC = HERE / "cartoon-photo-workbench.jpg"
OUT = HERE / "cartoon-rectified.png"

# The sheet's four corners in the photo (TL, TR, BR, BL), found with a bright/low-saturation
# paper mask and checked by eye. Pushed 6 px *outward* so the sheet's own cut edge — a dark
# line the camera sees, and a line the trace legitimately picks up — stays inside the crop.
CORNERS = [(204, 398), (1189, 392), (1214, 1359), (194, 1358)]
OUTSET = 6

# 980 px square. The sheet's edges measure 968–1029 px in the photo, so this is the paper's
# own resolution: rectification resamples without throwing linework away, and the marker
# stroke lands at ~6 px wide — which is what FR-1 (centreline, not outline) is about.
SIZE = 980


def outset(quad, d):
    """Push each corner `d` px away from the quad's centre."""
    cx = sum(p[0] for p in quad) / 4
    cy = sum(p[1] for p in quad) / 4
    out = []
    for x, y in quad:
        vx, vy = x - cx, y - cy
        n = (vx * vx + vy * vy) ** 0.5
        out.append((x + vx / n * d, y + vy / n * d))
    return out


def homography(src, dst):
    """Solve the 3x3 H mapping dst -> src, for inverse (destination-driven) sampling."""
    a, b = [], []
    for (dx, dy), (sx, sy) in zip(dst, src):
        a.append([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx])
        b.append(sx)
        a.append([0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy])
        b.append(sy)
    h = np.linalg.solve(np.array(a, dtype=np.float64), np.array(b, dtype=np.float64))
    return np.append(h, 1.0).reshape(3, 3)


def main():
    grey = np.asarray(Image.open(SRC).convert("L")).astype(np.float32)
    sh, sw = grey.shape

    mat = homography(outset(CORNERS, OUTSET), [(0, 0), (SIZE, 0), (SIZE, SIZE), (0, SIZE)])
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    px, py = xx + 0.5, yy + 0.5  # pixel centres, as `sampleGrid` does
    den = mat[2, 0] * px + mat[2, 1] * py + mat[2, 2]
    sx = (mat[0, 0] * px + mat[0, 1] * py + mat[0, 2]) / den
    sy = (mat[1, 0] * px + mat[1, 1] * py + mat[1, 2]) / den

    # Bilinear, matching `sampleGrid`'s reconstruction.
    x0 = np.clip(np.floor(sx).astype(int), 0, sw - 2)
    y0 = np.clip(np.floor(sy).astype(int), 0, sh - 2)
    fx, fy = sx - x0, sy - y0
    out = (
        grey[y0, x0] * (1 - fx) * (1 - fy)
        + grey[y0, x0 + 1] * fx * (1 - fy)
        + grey[y0 + 1, x0] * (1 - fx) * fy
        + grey[y0 + 1, x0 + 1] * fx * fy
    )
    # 8-bit greyscale, non-interlaced — the one shape `fixtures/png.ts` decodes.
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), mode="L").save(OUT, optimize=True)
    print(f"wrote {OUT.name} at {SIZE}x{SIZE}")


if __name__ == "__main__":
    main()
