// Vite `?raw` imports resolve to the file's text content. Used by the SVG fixture tests
// to exercise the committed reference files without pulling node:fs types into pure `core`.
declare module '*.svg?raw' {
  const content: string
  export default content
}
