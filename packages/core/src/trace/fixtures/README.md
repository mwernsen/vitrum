# Autotrace fixtures (F-059)

## `cartoon-photo-workbench.jpg`

Mathieu's own cartoon, photographed on his bench 2026-08-07 and supplied as the reference
fixture for F-059. A square panel: orange sky, a sun, roof tiles, grass. 1500 × 2000,
downscaled from a 5712 × 4284 phone photo and rotated upright. **These are the bytes he
supplied; do not re-encode them.** Anything the pipeline needs in another form is derived
under its own name (see `cartoon-rectified.png` below).

**This is deliberately a photo, not a flat scan**, because that is what a designer will
actually have. Everything awkward about it is the point:

- **Perspective and background.** The paper sits at a slight angle on a cluttered bench,
  with a tool and the photographer's leg in frame. The trace must run on an F-051 layer
  whose four-corner correction has already rectified and cropped to the paper — which is
  why F-059 depends on F-051 rather than taking a file of its own.
- **Hand annotations that must not become lead lines.** The drawing carries pencil piece
  numbers (1, 2, 3, 5, 6, 7, 10, 11 …) and Dutch colour notes — "Oranje lucht" (orange
  sky), "dakpannen" (roof tiles), "gras" (grass). These are marks on the artwork, not
  geometry.
- **Luminance, not size, is what separates them.** A "10" is about as large as a short
  lead segment, so a minimum-blob or minimum-length filter alone would either keep the
  numbers or delete real geometry. The marker is near-black and the pencil is mid-grey:
  the threshold between them is the mechanism that works. This cartoon is close to the
  ideal case for it — a fainter pen would be harder.
- **Graphite dust, smudges and stray construction lines.** The sheet has been used at the
  bench: long faint diagonals cross the design, and the area around the sun is heavily
  smudged. Global thresholding will not cope; adaptive (local) thresholding is not
  optional.
- **A stale EXIF orientation.** The pixels are upright, and the file _still_ carries
  `orientation = 6` ("rotate 90° clockwise") — `sips` rotated the pixels on the downscale
  and left the tag behind. So a decoder that honours EXIF turns this already-upright photo
  on its side, and one that ignores it does not. That disagreement is the trap, and it is
  why `exif.ts` reads the tag itself instead of trusting a decoder default: what the app
  has to guarantee is that the trace sees the **same** orientation the F-051 underlay
  displays, because the user places the calibration and the four rectification corners on
  what they can see. `exif.test.ts` asserts the tag as it is; the fixture is a specimen,
  not a mistake to patch out.

**The fixture carries its own expected answer — and the answer is smaller than the
numbering.** Mathieu numbered the pieces by hand before Vitrum existed to do it (which is
also the point of F-040), and the numbering runs to at least 11. The trace closes **6**.
That gap is documented and tested in `fixtures.test.ts`; in short, most of the missing
regions are never closed _on the sheet_ (their outer edge is the panel border, and the
panel border is not drawn), and the sun is closed on the sheet but not in the photograph —
the paper is folded and the circle's right-hand arc survives only as a faint grey imprint,
at exactly the luminance of the pencil annotations. Needs Mathieu's sign-off.

## `cartoon-rectified.png`

The photo after F-051's four-corner perspective correction and crop: 980 × 980, 8-bit
greyscale, non-interlaced. This is what the pipeline actually takes — F-059 traces a
reference layer, not a file, so rectification has already happened by the time it runs.

Derived, not supplied: `rectify.py` in this directory regenerates it byte-for-byte from the
photo (numpy + pillow, dev-only, not part of the build). It records the sheet's four corner
pixels and pushes them 6 px outward, so the sheet's own dark cut edge stays inside the crop
— the trace legitimately picks that edge up, and three of the six detected regions close
against it.

**980 px is the sheet's own resolution**, not a downscale: the paper's edges measure
968–1029 px in the photo. That matters more than it sounds, because stroke width in pixels
is what FR-1 (centreline, not outline) is about, and it also decides whether the fixture
still proves what it exists to prove:

| rectified size | marker stroke | what the fixture demonstrates                                                                                                                     |
| -------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 760 px         | 4.8 px        | thins fine, but a pencil digit falls below the despeckle floor — so **size**, not luminance, ends up excluding the annotations (FR-8 by accident) |
| 980 px         | 6.2 px        | annotations sit well above the despeckle floor, so the threshold is demonstrably what excludes them; matches FR-1's 6 px synthetic stroke         |

## Synthetic fixtures

The thick straight stroke (FR-1), the drawn T and X (FR-2), the drawn circle and the
mid-grey pencil annotation are all generated in code in `synthetic.test.ts`, so the intent
is legible from the test rather than hidden in a blob.
