// Dev-only entry for the geometry-kernel debug page (F-010 acceptance criterion):
// `pnpm dev:ui` then open /geometry.html. Renders random intersection and offset cases
// so robustness can be eyeballed during review.
import { mount } from 'svelte'

import '../design'
import GeometryDebug from './GeometryDebug.svelte'

mount(GeometryDebug, { target: document.getElementById('geometry-debug')! })
