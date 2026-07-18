// Dev-only entry for the component gallery: `pnpm dev:ui` then open /gallery.html.
import { mount } from 'svelte'

import '../design'
import Gallery from './Gallery.svelte'

mount(Gallery, { target: document.getElementById('gallery')! })
