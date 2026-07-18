import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  // Keep parity with the desktop renderer: don't esbuild-prebundle lucide-svelte's
  // per-icon .svelte files; the Svelte plugin transforms the imported subpaths.
  optimizeDeps: {
    exclude: ['lucide-svelte'],
  },
  test: {
    name: 'ui',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
