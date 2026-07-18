export { default as App } from './App.svelte'
export { default as AppShell } from './shell/AppShell.svelte'
export { default as PieceSummary } from './PieceSummary.svelte'
export * from './components'

// Document model wiring (F-002)
export { DocumentController } from './document/controller.svelte'
export { createBrowserHost } from './document/browserHost'
export type { AppHost, MenuAction } from './document/host'
