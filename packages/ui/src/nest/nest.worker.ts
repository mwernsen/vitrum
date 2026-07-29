/// <reference lib="webworker" />
import { nestSheets, type NestInput, type NestProgress, type NestResult } from '@vitrum/nest'

/**
 * The nesting worker (F-057): receives a plain {@link NestInput}, runs the pure engine off the draw
 * thread, and posts progress as it goes plus the final {@link NestResult}, both tagged with the
 * request id. All state lives in the message — the worker holds nothing between runs — so a superseded
 * run is simply ignored by the controller. Cancellation is handled main-side by terminating the
 * worker (a single `nestSheets` call is synchronous and can't check an in-flight cancel message).
 *
 * A **classic** (IIFE) worker, not a module worker: Vite inlines its imports into one self-contained
 * script that loads under `file://` in the packaged desktop app where `{ type: 'module' }` is blocked
 * (the F-030 lesson).
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (event: MessageEvent<{ id: number; input: NestInput }>) => {
  const { id, input } = event.data
  const result: NestResult = nestSheets(input, (p: NestProgress) =>
    ctx.postMessage({ id, type: 'progress', progress: p }),
  )
  ctx.postMessage({ id, type: 'done', result })
}
