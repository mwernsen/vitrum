import { line, vec2 } from '@vitrum/geometry'
import { beforeEach, describe, expect, it } from 'vitest'

import { Autosaver, type Scheduler } from './autosave'
import { addSegment } from './commands'
import { createSegment } from './factory'
import { deserialize, serialize } from './serialize'
import { DocumentStore } from './store'

// Model the snapshot payload as bytes, mirroring the real zip container. A minimal UTF-8
// round-trip (not Latin-1) keeps the pure model package free of a TextEncoder/DOM/node lib
// dependency while still surviving multibyte characters like the default currency symbol (€).
function utf8Encode(text: string): Uint8Array {
  const out: number[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f))
      out.push(0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    }
  }
  return Uint8Array.from(out)
}
function utf8Decode(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i]!
    if (b0 < 0x80) {
      text += String.fromCodePoint(b0)
      i += 1
    } else if (b0 < 0xe0) {
      text += String.fromCodePoint(((b0 & 0x1f) << 6) | (bytes[i + 1]! & 0x3f))
      i += 2
    } else if (b0 < 0xf0) {
      text += String.fromCodePoint(
        ((b0 & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f),
      )
      i += 3
    } else {
      text += String.fromCodePoint(
        ((b0 & 0x07) << 18) |
          ((bytes[i + 1]! & 0x3f) << 12) |
          ((bytes[i + 2]! & 0x3f) << 6) |
          (bytes[i + 3]! & 0x3f),
      )
      i += 4
    }
  }
  return text
}
const snapshot = (doc: Parameters<typeof serialize>[0]): Uint8Array => utf8Encode(serialize(doc))
const readSnapshot = (bytes: Uint8Array) => deserialize(utf8Decode(bytes))

/** A controllable clock: timers fire only when the test calls `tick`. */
class FakeScheduler implements Scheduler {
  #next = 1
  readonly pending = new Map<number, { fn: () => void; ms: number }>()

  setTimer(fn: () => void, ms: number): number {
    const id = this.#next++
    this.pending.set(id, { fn, ms })
    return id
  }

  clearTimer(handle: unknown): void {
    this.pending.delete(handle as number)
  }

  /** Fire every currently-pending timer once. */
  tick(): void {
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const { fn } of entries) fn()
  }

  get count(): number {
    return this.pending.size
  }
}

describe('Autosaver (FR-5)', () => {
  let store: DocumentStore
  let scheduler: FakeScheduler
  let writes: Uint8Array[]
  let autosaver: Autosaver

  beforeEach(() => {
    store = new DocumentStore()
    scheduler = new FakeScheduler()
    writes = []
    autosaver = new Autosaver({
      store,
      scheduler,
      serialize: snapshot,
      write: (contents) => {
        writes.push(contents)
      },
      intervalMs: 5000,
    })
    autosaver.start()
  })

  it('schedules a snapshot at most once per interval and writes on fire', () => {
    store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(1, 0)))))
    const first = [...scheduler.pending.values()][0]
    expect(first?.ms).toBe(5000)

    scheduler.tick()
    expect(writes).toHaveLength(1)
    expect(readSnapshot(writes[0]!)).toEqual(store.document)
  })

  it('collapses a burst of edits within one interval into a single snapshot', () => {
    store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(1, 0)))))
    store.execute(addSegment(createSegment(line(vec2(1, 0), vec2(2, 0)))))
    store.execute(addSegment(createSegment(line(vec2(2, 0), vec2(3, 0)))))
    expect(scheduler.count).toBe(1)

    scheduler.tick()
    expect(writes).toHaveLength(1)
    // The single snapshot reflects the latest state (all three segments).
    expect(Object.keys(readSnapshot(writes[0]!).segments)).toHaveLength(3)
  })

  it('schedules again after a snapshot when new edits arrive', () => {
    store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(1, 0)))))
    scheduler.tick()
    expect(writes).toHaveLength(1)

    store.execute(addSegment(createSegment(line(vec2(1, 0), vec2(2, 0)))))
    expect(scheduler.count).toBe(1)
    scheduler.tick()
    expect(writes).toHaveLength(2)
  })

  it('does not write when the document was saved before the timer fires', () => {
    store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(1, 0)))))
    store.markSaved()
    scheduler.tick()
    expect(writes).toHaveLength(0)
  })

  it('flush writes immediately when dirty and is a no-op when clean', () => {
    autosaver.flush()
    expect(writes).toHaveLength(0)

    store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(1, 0)))))
    autosaver.flush()
    expect(writes).toHaveLength(1)
  })

  it('stop cancels the pending snapshot and unsubscribes', () => {
    store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(1, 0)))))
    expect(scheduler.count).toBe(1)
    autosaver.stop()
    expect(scheduler.count).toBe(0)
    store.execute(addSegment(createSegment(line(vec2(1, 0), vec2(2, 0)))))
    expect(scheduler.count).toBe(0)
  })
})
