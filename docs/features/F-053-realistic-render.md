# F-053: Realistic glass rendering

|                |                                      |
| -------------- | ------------------------------------ |
| **Phase**      | 5 — Power features                   |
| **Status**     | draft (expand before implementation) |
| **Depends on** | F-023                                |
| **Complexity** | L                                    |

## Summary

Upgrade from flat fills to a presentation-quality render: light transmitted through
textured, varyingly-transparent glass, dimensional lead/solder lines with rounded
profiles, subtle irregularity that makes glass read as glass. Used for client
presentations and as the base layer for F-054's sun simulation.

## Scope

- A WebGL render mode (behind the F-001 renderer interface) alongside the editing
  view: per-glass shading from transparency class + texture (procedural normal-map
  style textures per tag: hammered, seedy, streaky…; optional swatch-photo modulation).
- Backlight model: uniform daylight backlight with adjustable intensity/warmth
  (F-054 replaces the light source with the real sun).
- Came/solder rendering: rounded profile with specular hint; solder finish (silver/
  copper/black from F-021) affects color; foil seams render as beaded solder lines.
- Per-piece texture rotation/offset control (Glass Eye Pro Plus parity — noted in
  F-023's non-goals; do it here where the texture pipeline lives).
- Export snapshot at chosen resolution (PNG) for portfolio/client use.

## Functional requirements (sketch — refine at expansion)

- FR-1: Render mode switch is instant (<1 s) on the reference panel; interaction
  (pan/zoom) stays smooth in render mode.
- FR-2: Transparency classes are visually distinct and believable side by side.
- FR-3: Editing while in render mode updates live (it's a view, not an export).

## Open questions

1. Art direction pass needed: what does "believable" mean concretely? Collect
   reference photos per texture tag with Mathieu before implementation.
