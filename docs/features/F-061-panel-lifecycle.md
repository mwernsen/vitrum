# F-061: Panel lifecycle & workshop status

|                |                                      |
| -------------- | ------------------------------------ |
| **Phase**      | 5 — Power features                   |
| **Status**     | draft (expand before implementation) |
| **Depends on** | F-058                                |
| **Complexity** | M                                    |

## Summary

Track where a panel is in the workshop, not just in the design: is it still being
drawn, waiting on glass, fired, broken, or done and archived. Design panel `#2a`
already shows this — Active / Fired / Archived filters over the library, and per-panel
badges "Fired", "Awaiting glass", "Breakage" — and F-058 deliberately shipped the
library without it, because a persisted status is a domain concept rather than layout.

This is the first feature in Vitrum about the **job** rather than the **drawing**, so
it is worth designing deliberately: get the vocabulary right with Mathieu before any
code.

## Why it was split out of F-058

F-058's spec was drafted before its design panel was read, and under-scoped it. When
`#2a` was finally read (2026-08-06) it turned out to carry three new domain concepts;
two were folded into F-058, and this one was not, because it raises questions the
launch-screen ticket had no business answering (see Open questions).

## Scope (sketch — expand before implementation)

- A persisted per-panel **status**, stored where the library can read it without
  opening the document (F-058's save-time index is the natural home; a status the user
  sets while the panel is closed argues for the library entry instead — decide at
  expansion).
- Library filters per `#2a`: Active / Fired / Archived on a `--paper-100` segmented
  track, plus the per-card badge (`--emerald-100` Fired, `--amber-100` Awaiting glass,
  `--ruby-100` Breakage). Design already exists — build to it, do not redesign.
- Somewhere to change the status: a control on the library card and/or in the editor.
- Archived panels drop out of the default library view without being deleted.

### Non-goals

- Client/commission tracking, deadlines, invoicing (F-056 covers quoting).
- Multi-user assignment or a workshop-wide job board.
- Automatic status inference from DRC or glass state — see Open question 1; if any
  status is derived, it should be a suggestion, never a silent overwrite of the
  user's own bookkeeping.

## Open questions

1. **Manual or derived?** Is "Fired" something the user marks, or inferred from the
   design's state? Mixed models get confusing fast. Recommendation: fully manual, with
   the readiness pills (F-058) already covering the derived story.
2. **What is the real status list?** `#2a` shows Active / Fired / Archived as filters
   but Fired / Awaiting glass / Breakage as badges — those two sets do not line up.
   Mathieu's bench vocabulary settles this; the design's sample data may be
   illustrative rather than exhaustive.
3. **Does a status gate anything?** E.g. should an archived panel be read-only, or a
   "Breakage" panel resurface its affected pieces? Recommendation: no gating in v1 —
   status is bookkeeping, not enforcement.
4. Does "Breakage" want to reference _which_ pieces broke (a link into the cutting
   list, F-042) so a recut list can be produced? That would make it genuinely useful
   rather than a label, but it is a bigger feature.
