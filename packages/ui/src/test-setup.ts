import '@testing-library/jest-dom/vitest'

// jsdom does not implement the Pointer Capture API. Components that capture a pointer for the
// duration of a drag (the reference overlay, the canvas, the calibration dialog, the sun dome)
// only need it to be a no-op under test, so stub the three members rather than guard each call.
const proto = Element.prototype as unknown as Record<string, unknown>
proto.setPointerCapture ??= () => {}
proto.releasePointerCapture ??= () => {}
proto.hasPointerCapture ??= () => false
