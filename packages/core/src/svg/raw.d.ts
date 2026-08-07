// Vite `?raw` imports resolve to the file's text content. Used by the SVG fixture tests
// to exercise the committed reference files without pulling node:fs types into pure `core`.
declare module '*.svg?raw' {
  const content: string
  export default content
}

// Vite `?inline` imports resolve to a base64 data URL. Used by the autotrace fixture tests (F-059)
// to load the committed photo and rectified raster without `node:fs` — see `trace/fixtures/dataUrl.ts`.
declare module '*.jpg?inline' {
  const url: string
  export default url
}

declare module '*.png?inline' {
  const url: string
  export default url
}
