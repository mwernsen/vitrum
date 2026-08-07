# F-059: Raster autotrace — scanned cartoons to lead lines

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | agreed             |
| **Depends on** | F-050, F-051       |
| **Complexity** | L                  |

## Summary

Scan a hand-drawn cartoon and get an editable lead-line network. Designers sketch on
paper; today the only route in is tracing over an F-051 underlay by hand. Autotrace does
that pass automatically: binarise the scan, reduce each drawn stroke to a **centreline**,
fit curves, heal the result, and merge it as one undoable edit. Glass Eye Pro Plus has
this; Diafane does not.

## User story

As a designer, I want to scan the cartoon I drew at the bench and have Vitrum turn it
into lead lines I can edit, so I don't redraw by hand what I already drew on paper.

## Scope

- **Input**: a raster already placed as an F-051 reference layer — so the image arrives
  perspective-corrected and **scale-calibrated**, and the trace lands at true mm. Trace
  the active layer; no separate file picker.
- **Preprocess**: greyscale, contrast, then binarise. Adaptive (local) thresholding, not
  a single global cut — scans of pencil on paper have uneven exposure across the sheet.
  Despeckle below a minimum blob size.
- **Centreline extraction**: skeletonise the binarised strokes (Zhang–Suen thinning or a
  medial-axis equivalent) so a 2 mm pencil stroke yields **one** line, not two edges.
  This is the core requirement and the reason outline tracers (potrace) are the wrong
  tool here — see Technical guidance.
- **Vectorise**: walk the skeleton into polylines, detecting junctions (T, X, Y) and
  endpoints so branches break at junctions rather than running through them. Simplify
  (Douglas–Peucker), then fit cubic béziers to the smooth runs with a tolerance control,
  keeping straight runs as lines.
- **Heal**: hand the traced network straight to F-050's `healNetwork` — near-miss
  junctions, crossings, degenerate and duplicate segments are exactly what a traced
  scan produces. Do not write a second healing implementation.
- **Merge**: one `patchNetwork` compound command into the active project, exactly as
  F-050 does — one undo step, redo reproduces it.
- **Dialog** with live preview and controls: threshold, despeckle size, simplification
  tolerance, curve-fit tolerance, heal tolerance, and a **resulting piece count** so the
  designer tunes against the outcome that matters (the F-050 slider idiom). Plus an
  option to treat the outermost closed contour as the panel border (`role: 'border'`)
  rather than a lead line.

### Non-goals

- **Colour → glass suggestion.** Autotrace produces geometry; glass is assigned with the
  existing F-023 tools. Colour-to-catalogue matching needs a perceptual distance metric
  over the F-022 catalogue and is its own feature.
- **Tracing photographs of existing windows.** Lead has specular highlights, glass has
  texture and painted detail, and lighting varies across a panel — reliably beating a
  manual trace over an F-051 underlay is a research problem, not this ticket.
- **Colour-region tracing of arbitrary artwork** (posterise + boundary trace). A
  different algorithm, and it tends to emit hundreds of pieces that fail F-031/F-032.
- Handwriting/label recognition; tracing to anything but the active document.

## Design

No design exists in the Claude Design project. F-050's `ImportDialog.svelte` already
solves the same shape of problem — a preview, a tolerance slider, and a live piece count
— so **reuse it rather than inventing a second dialog language**: same layout, same
`Slider` primitive, same live-count affordance. Tokens only, `components/core`
primitives, sentence case, numbers in mono. The preview overlay (what was traced, what
was healed) uses design tokens; the traced document content is data-driven and exempt.
Note the dialog as a net-new screen for back-port, as F-050 did.

## Functional requirements

- FR-1 — **Centreline, not outline.** A stroke of non-trivial width yields exactly one
  segment along its centre. Verified on a synthetic fixture: a 6 px-wide straight stroke
  traces to one segment, not two, and its endpoints sit on the stroke's centre axis.
- FR-2 — **Junctions survive.** A drawn T and a drawn X each become welded junctions
  (branches meeting at one shared point), not overlapping run-through lines. After heal,
  F-020 reports no near-miss or dangling diagnostics on the clean fixtures.
- FR-3 — **True scale.** Tracing a calibrated F-051 layer produces geometry whose
  measured dimensions match the calibration within 1%. An uncalibrated layer is refused
  with a message pointing at F-051's calibration, rather than silently guessing a DPI.
- FR-4 — **Regions come out.** On the committed cartoon fixtures, piece detection finds
  the visually apparent regions (exact counts asserted per fixture).
- FR-5 — **One undo step.** A completed trace is a single history entry; undo removes all
  traced geometry and restores the prior document; redo reproduces it identically.
- FR-6 — **Deterministic.** Same image + same settings → identical output, so redo and
  the tests are stable.
- FR-7 — **Responsive tuning.** The live preview stays usable on a 2000×1500 scan:
  debounce recomputation on slider drag and keep the pipeline off the interaction path
  if a pass blocks (the F-050 lesson).

## Technical guidance

- **Buy vs build.** `potrace` is the obvious library and is the **wrong** one: it traces
  the _outline_ of a bitmap region, so a pencil line becomes a closed loop around the
  stroke. `autotrace` has a centreline mode but is an unmaintained C codebase. Expect to
  implement thinning + skeleton-walking ourselves (both are well-documented and modest);
  spike briefly and record the decision rather than forcing a library to fit.
- Keep the whole pipeline **pure and DOM-free** in `@vitrum/core` (alongside `svg/`, e.g.
  `trace/`) so it is unit-testable in Node and worker-safe: take pixel data in, return
  geometry. Rasterising the F-051 layer to pixels is the UI's job.
- Reuse: F-010 for curve fitting, F-050's `healNetwork` for healing, F-050's
  `patchNetwork` merge for FR-5. The pipeline is preprocess → skeletonise → walk →
  simplify → fit → **heal**, with healing owned by F-050.
- Commit fixtures as small PNGs: a synthetic thick-stroke line (FR-1), a synthetic T and
  X (FR-2), and at least one real scanned cartoon (FR-4) — ideally one of Mathieu's, so
  the fixture reflects real pencil, real paper and a real scanner.

## Acceptance criteria

- Unit (core): thinning on synthetic bitmaps; skeleton-walk junction/endpoint detection;
  curve fitting within tolerance; the full pipeline on each committed fixture with
  asserted segment and piece counts; determinism (FR-6).
- Component: the dialog's controls update the previewed piece count; an uncalibrated
  layer shows the calibration message (FR-3).
- E2E (Playwright): place a reference image, run autotrace, confirm pieces are detected,
  then undo restores the prior document in one step (FR-5).
- Manual (Mathieu): trace a real cartoon of his and judge whether the result is worth
  editing versus redrawing — the only test that decides if this feature earns its place.

## Open questions

_None blocking. Two calls are delegated to the implementer — make them, and record the
reasoning in Implementation notes:_

1. Thinning algorithm and whether any library survives the spike above.
2. Whether the outermost-contour-as-border option defaults on or off (it is convenient
   and easy to undo, but it guesses at intent).
