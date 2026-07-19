/// <reference lib="webworker" />
import { runChecks, type DrcInput, type RunResult } from '@vitrum/drc'

/**
 * The DRC worker (F-030 FR-1): receives a plain {@link DrcInput}, runs the pure engine, and posts
 * back the {@link RunResult} tagged with the request id. All state lives in the message — the worker
 * holds nothing between runs — so it is safe to supersede an in-flight run.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (event: MessageEvent<{ id: number; input: DrcInput }>) => {
  const { id, input } = event.data
  const result: RunResult = runChecks(input)
  ctx.postMessage({ id, result })
}
