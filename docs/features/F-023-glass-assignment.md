# F-023: Glass assignment & panel rendering

|                |                          |
| -------------- | ------------------------ |
| **Phase**      | 2 — Stained glass domain |
| **Status**     | draft                    |
| **Depends on** | F-020, F-022             |
| **Complexity** | M                        |

## Summary

Painting the window: assign glasses from the catalog to detected pieces and render
the panel in color — the moment the app starts feeling like stained glass design
rather than line drawing. Ends Phase 2 (milestone M2).

## Scope

- **Paint tool**: pick a glass in the palette (F-022), click pieces to assign;
  drag-paint across pieces; Alt-click to eyedrop a piece's glass; paint-all-unassigned.
- Assignments stored as `pieceId → glassId` on the document (commands, undoable);
  pieces with no assignment render as "unassigned" hatching.
- **Piece selection as a first-class mode**: click a piece (not its lines) to select
  it; inspector shows its glass, area, perimeter, piece number placeholder; multi-select
  pieces → bulk assign.
- Rendering: fill each piece with its glass base color modulated by transparency
  class (simple alpha/whiteness model in v1) and texture tag (procedural hatch or the
  swatch image as a fill pattern, clipped to the piece); lead/foil lines render on top
  per F-021. This is the "flat" render — physically-plausible light comes in F-053.
- Because piece IDs are stable (F-020 FR-3), assignments survive edits; when a piece
  is split, both fragments inherit the parent's glass.
- Assignment integrity report: count of unassigned pieces surfaced in the status bar
  (input to F-030's ERC).

### Non-goals

- Realistic refraction/transmission rendering (F-053); print/export appearance (F-041/43);
  per-piece texture rotation/offset (Glass Eye Pro Plus feature — backlog, note in F-053).

## Design

This feature completes the Editor screen of `ui_kits/studio` (F-004): canvas +
glass palette + panes (pieces) list + inspector. The pieces list and piece
inspector follow that screen; unassigned-piece hatching and counts use semantic
status tokens, not ad-hoc colors.

## Functional requirements

- FR-1: Assign, bulk-assign, eyedrop, and unassign all work and are each one undo step.
- FR-2: Editing geometry never silently drops assignments except when a piece truly
  disappears; split/merge inheritance per F-020 FR-3.
- FR-3: Unassigned pieces are visually unmistakable and counted in the status bar.
- FR-4: Rendering with 200 colored pieces incl. texture fills maintains F-003's
  interaction budget.
- FR-5: Colors are identical on screen and in the serialized file after reload.

## Acceptance criteria

- Manual: fully color the acceptance panel in under a couple of minutes using
  drag-paint and bulk assign; reload → identical; heavy geometry rework → assignments
  survive sensibly.
- Tests: assignment commands, split/merge inheritance (drives F-020's matcher through
  its API), unassigned counting.

## Open questions

1. Should glass assignment live on the piece (current design) or as a "region paint"
   that reattaches by point-in-piece lookup? Current design depends on F-020's ID
   stability — if that proves flaky in practice, this is the fallback; flag early.
