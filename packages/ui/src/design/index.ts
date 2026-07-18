// Vitrum Design System — single import that loads the offline-bundled fonts and
// all design tokens. Import this once at each app entry point (UI dev entry,
// gallery, and the Electron renderer) before mounting any component.
//
// Fonts are self-hosted (F-004 FR-3, no runtime network). The variable-font
// packages cover every weight the type ramp uses: Onest 400–800, Geist Mono
// 400–500.
import '@fontsource-variable/onest'
import '@fontsource-variable/geist-mono'

import './styles.css'
