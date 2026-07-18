# F-054: Sunlight simulation

|                |                                      |
| -------------- | ------------------------------------ |
| **Phase**      | 5 — Power features                   |
| **Status**     | draft (expand before implementation) |
| **Depends on** | F-053                                |
| **Complexity** | XL                                   |

## Summary

Diafane's showpiece, matched: place the panel in a 3D scene, compute the real sun
position from location (GPS/address), facade orientation and date/time, and watch the
window live through a day and through the seasons — including colored light cast into
the room.

## Scope

- Installation setup: location (map picker or lat/long), facade compass orientation,
  tilt (vertical window vs skylight), simple room proxy (floor/wall distances) for
  light-patch casting.
- Solar position from standard astronomical algorithms (e.g. NOAA/PSA); time-of-day
  and day-of-year sliders with animation playback; solstice/equinox presets.
- Render: F-053's pipeline with directional sun + sky model (intensity/color by solar
  elevation; simple overcast toggle); projected colored light patch on the room proxy
  floor/wall — the emotionally resonant part.
- "Photo capture" of any moment (Diafane parity), plus a day-lapse GIF/video export.

### Non-goals

- Physically accurate spectral rendering, caustics, neighboring-building shadowing
  (a horizon-obstruction slider is a cheap approximation — consider at expansion).

## Functional requirements (sketch — refine at expansion)

- FR-1: Sun azimuth/elevation match a reference calculator within 0.5° for test
  locations/dates (unit-testable core, pure functions).
- FR-2: A south-facing window in Amsterdam in December visibly differs from June
  (elevation, warmth, patch length) in the expected directions.
- FR-3: Animation playback ≥30 fps on the reference panel.

## Open questions

1. Room proxy fidelity: flat floor only vs configurable simple room box? Decide at
   expansion with visual prototypes.
