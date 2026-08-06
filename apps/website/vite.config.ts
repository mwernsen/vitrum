import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte()],
  // Keep parity with the other Vite entries: the Svelte plugin transforms
  // lucide-svelte's per-icon .svelte subpaths; esbuild prebundling must not.
  optimizeDeps: {
    exclude: ['lucide-svelte'],
  },
})
