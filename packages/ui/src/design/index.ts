// Vitrum Design System — single import that loads the offline-bundled fonts and
// all design tokens. Import this once at each app entry point (UI dev entry,
// gallery, and the Electron renderer) before mounting any component.
//
// Fonts are self-hosted (F-004 FR-3, no runtime network): `tokens/fonts.css`
// declares the faces directly from the `@fontsource-variable/*` woff2 files
// under the family names the type ramp asks for. The packages' own stylesheets
// are deliberately not imported — they name the families "Onest Variable" /
// "Geist Mono Variable", which `--font-sans` / `--font-mono` never match, so the
// UI silently fell back to the OS sans. See tokens/fonts.css. The bundled
// variable fonts cover every weight the ramp uses: Onest 400–800, Geist Mono
// 400–500.
import './styles.css'
