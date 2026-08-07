# F-060: Pattern templates

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | agreed             |
| **Depends on** | F-058              |
| **Complexity** | M                  |

## Summary

Start from something instead of an empty panel. Templates are **parametric generators**
rather than shipped drawings: a rose window with N-fold symmetry, a staggered brick
layout, a gothic lancet head, an art-deco fan. They regenerate at the panel's real
dimensions, so lead spacing stays sane at any size. Users can also capture their own
panel as a reusable template — the repeat-commission case. Completes the "template" path
that F-058 left as a placeholder in `#2a`'s "blank, template or photo" card.

## User story

As a designer starting a new panel, I want a sound layout to build on — sized to my
actual panel — so I'm not drawing the same rose window skeleton from scratch again.

## Why generators, not files

Decided with Mathieu 2026-08-07. Shipped `.vitrum` drawings would mean either Mathieu's
bench time or curating historical designs (where the original may be public domain while
a specific modern reproduction or photograph is not). Generators avoid the licensing
question entirely, cost no drawing time, adapt to any panel instead of scaling awkwardly,
fit Vitrum's parametric-CAD ethos, and exercise F-052's symmetry machinery.

## Scope

- **Two template kinds**, one model, settled up front because retrofitting a second kind
  is the mistake F-057 (grain) and F-058 (lifecycle) each had to work around:
  - `generator` — id, label, parameter schema, and a pure function
    `(panelSize, technique, params) → segment network`. Ships with the app.
  - `captured` — a network captured from a real panel, stored at its authored size.
- **Generator set for v1** (five, each with a small parameter set):
  - **Rose window** — N-fold radial (folds, inner medallion radius, ring count).
  - **Staggered brick** — rows/columns with a stagger offset. Note: a plain unstaggered
    grid is a **hinge-line violation** (F-032) — staggering is exactly the craft answer,
    so it must default to staggered, not be an option that quietly ships a bad panel.
  - **Gothic lancet head** — arch spring height plus simple tracery.
  - **Art-deco fan** — corner sunburst with ray count and ray depth.
  - **Border frame** — an inset border band with configurable width and corner treatment;
    composable under the others.
- **Insertion**: a template becomes geometry in the active (empty) document as **one**
  `patchNetwork` command — one undo step, redo reproduces it. Generators emit welded
  networks (coincident endpoints, not near-misses) so F-020 detects regions immediately.
- **Size adaptivity**: generators receive the panel size and regenerate; they never
  uniformly scale. Captured templates insert at their authored size, with an explicit
  scale-to-fit option and a warning that scaling changes piece sizes relative to the came
  width (DRC will then have opinions).
- **Save as template**: capture the current document's network under a name into a user
  template store — a `TemplatePort` on `AppHost` following the F-022 / F-055 / F-058
  pattern (`userData`-backed, `VITRUM_TEMPLATES_PATH` for E2E, stubbed in `browserHost`).
- **Picker**: reached from F-058's "Start a panel → template" and from the new-panel
  dialog. Live thumbnails via the shared `renderThumbnail`, generator parameters editable
  with the preview updating, then "Use template".

### Non-goals

- Template sharing, packs, or a marketplace; importing someone else's template file.
- Curated historical or hand-authored artwork (see Why generators, above).
- Painted detail, glass pre-assignment, or came overrides baked into a template —
  templates deliver **geometry only**; glass is the designer's choice (F-023).
- Composing multiple generators in one operation beyond the border frame.

## Design

F-058's `#2a` "Start a panel" card is the entry point and already exists. The **picker
dialog** has no design in the Claude Design project — build it from `components/core`
(`Dialog`, `Card` for the thumbnail grid, `Input`/`Select` for parameters, `Button`),
tokens only, sentence-case copy, numbers in mono. Thumbnails are rendered document
content and therefore token-exempt; the surrounding chrome is not. Note it as a net-new
screen for back-port. When this lands, F-058's "Start a panel" copy becomes the design's
full "blank, template or photo".

## Functional requirements

- FR-1 — **Generators are pure and deterministic.** Same panel size + technique + params
  → identical network. Unit-tested per generator.
- FR-2 — **Welded output.** Every generator emits coincident endpoints where lines meet;
  F-020 finds the expected region count per generator at default parameters (asserted),
  with no near-miss or dangling diagnostics.
- FR-3 — **DRC-clean at defaults.** Each shipped generator, at default parameters on a
  representative panel size, produces **zero DRC errors** (F-031 cuttability, F-032
  structural) — including no hinge line. A generator that cannot meet this at some
  parameter extreme must clamp its parameters rather than emit an unbuildable panel.
- FR-4 — **Size adaptivity.** The same generator on a 300 × 400 mm and a 900 × 1200 mm
  panel yields comparable lead spacing (not a scaled-up copy): piece count grows with
  area rather than staying constant.
- FR-5 — **One undo step.** Applying a template is a single history entry; undo restores
  the empty document.
- FR-6 — **Capture round-trips.** Save the current panel as a template, start a new
  panel from it, and the network matches the captured one exactly (at authored size).
- FR-7 — **Templates never overwrite work.** Applying a template to a document that
  already has geometry either merges explicitly or is refused with a clear message —
  never silently replaces the user's drawing.

## Technical guidance

- Generators live in a pure module in `@vitrum/core` (e.g. `templates/`), DOM- and
  model-free, returning `SegmentDraft[]` so the existing merge path applies (mirroring
  F-050's `toDrafts` → `patchNetwork`). No ids in generator output; the document assigns
  them — the F-050 offcut-id lesson.
- The rose window and fan are natural users of F-052's symmetry maths; prefer reusing it
  over duplicating rotation code, and consider whether a generated panel should arrive
  with F-052 symmetry **active** (attractive, but it makes the template's output
  non-editable in the usual way — implementer's call, record it).
- FR-3 is best enforced as a test that runs the real DRC engine over each generator's
  default output, so a future rule change surfaces a bad template rather than shipping it.

## Acceptance criteria

- Unit (core): per-generator determinism (FR-1), weld/region counts (FR-2), adaptivity
  (FR-4), and a DRC pass over every generator's defaults (FR-3).
- Unit (model/ui): `TemplatePort` capture → list → apply round-trip (FR-6); the
  already-has-geometry guard (FR-7).
- Component: picker renders thumbnails for all five generators; editing a parameter
  updates the preview.
- E2E (Playwright): from the launch screen, start a panel from a template, confirm pieces
  are detected, undo returns to the empty panel.
- Manual (Mathieu): judge whether each generator produces a layout a glass artist would
  actually build on, or whether it reads as programmer geometry — that verdict decides
  which of the five survive.

## Open questions

_None blocking. Two calls are delegated to the implementer — make them and record the
reasoning:_

1. Whether a generated panel arrives with F-052 symmetry active or baked flat.
2. Whether captured templates store a full `Project` (technique, glasses) or the network
   alone. Recommendation: network alone, since technique and glass are the new panel's
   choice — but if capture is meant to reproduce a whole commission, the fuller object is
   defensible.
