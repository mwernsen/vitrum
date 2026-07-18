// Standalone browser entry so the UI can be developed without Electron:
// `pnpm dev:ui` from the repo root.
import { mount } from 'svelte'

import App from './App.svelte'

mount(App, { target: document.getElementById('app')! })
