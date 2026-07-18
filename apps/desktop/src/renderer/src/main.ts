import '@vitrum/ui/design'
import { App, type AppHost } from '@vitrum/ui'
import { mount } from 'svelte'

// The preload exposes an object that structurally satisfies `AppHost` (storage, menu,
// dirty reporting, confirm dialogs). Use it when present; otherwise let `App` fall back
// to its browser host (e.g. if the page is opened outside Electron).
const bridge = (globalThis as { vitrum?: AppHost }).vitrum
const props = bridge?.storage ? { host: bridge } : {}

mount(App, { target: document.getElementById('app')!, props })
