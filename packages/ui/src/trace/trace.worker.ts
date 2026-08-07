/// <reference lib="webworker" />
import { traceBitmap, type TraceResult } from '@vitrum/core'

import type { TraceRequest } from './runner'

/**
 * The autotrace worker (F-059 FR-7): receives a greyscale grid plus the dialog's settings, runs the
 * pure pipeline off the draw thread, and posts the result tagged with the request id. It holds nothing
 * between runs — all state is in the message — so a superseded request is simply ignored main-side.
 *
 * A **classic** (IIFE) worker, not a module worker: Vite inlines its imports into one self-contained
 * script that loads under `file://` in the packaged desktop app where `{ type: 'module' }` is blocked
 * (the F-030 lesson — only the real `file://` E2E catches that one).
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (event: MessageEvent<{ id: number; request: TraceRequest }>) => {
  const { id, request } = event.data
  const result: TraceResult = traceBitmap(request.image, request.grid, request.options)
  ctx.postMessage({ id, result })
}
