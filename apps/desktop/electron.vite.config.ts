import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [svelte()],
    // lucide-svelte ships per-icon .svelte files; esbuild (dev dep pre-bundler)
    // has no .svelte loader, so exclude it and let the Svelte plugin transform
    // the handful of icons we import by subpath. Dev-only; production build
    // goes through Rollup + the Svelte plugin and is unaffected.
    optimizeDeps: {
      exclude: ['lucide-svelte'],
    },
  },
})
