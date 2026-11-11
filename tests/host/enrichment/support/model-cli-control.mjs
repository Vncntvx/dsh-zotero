/** Observational IPC ports for the real installer; all locks and disk calls stay real. */
import * as filesystem from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { basename } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

export const fixture = JSON.parse(process.env.WP4_CLI_FIXTURE)
const controlled = fixture.control !== undefined
const pending = new Map()
const occurrences = new Map()
let serial = 0

export function notify(kind, details = {}) {
  const event = { kind, details, id: ++serial, pid: process.pid }
  if (controlled && process.connected) process.send(event)
  return event
}

export async function checkpoint(kind, details = {}, signal) {
  if (!controlled) return
  signal?.throwIfAborted()
  const occurrence = (occurrences.get(kind) ?? 0) + 1
  occurrences.set(kind, occurrence)
  const held = fixture.control.holds.some(
    (hold) => hold.kind === kind && (hold.at ?? 1) === occurrence,
  )
  if (!held) {
    notify(kind, { ...details, occurrence, held: false })
    return
  }
  const slot = Promise.withResolvers()
  const id = serial + 1
  pending.set(id, slot)
  process.channel?.ref()
  const abort = () => slot.reject(signal.reason)
  signal?.addEventListener('abort', abort, { once: true })
  notify(kind, { ...details, occurrence, held: true })
  try {
    await slot.promise
  } finally {
    signal?.removeEventListener('abort', abort)
    pending.delete(id)
    if (pending.size === 0) process.channel?.unref()
  }
}

if (controlled) {
  const emit = process.emit
  process.emit = function (event, ...args) {
    // Observing emit adds no signal listener: the old CLI retains the OS's
    // default termination, while a corrected CLI runs its own signal handler.
    if (event === 'SIGINT' || event === 'SIGTERM') notify('signal-observed', { signal: event })
    return emit.call(this, event, ...args)
  }
  process.on('message', (message) => {
    if (message?.command === 'release') pending.get(message.id)?.resolve()
    if (message?.command === 'release-all') {
      for (const slot of pending.values()) slot.resolve()
    }
  })
  // IPC observes the command without keeping a completed CLI alive. A held
  // checkpoint refs it until explicitly released or its caller signal aborts.
  process.channel?.unref()
}

export const fsPort = {
  ...filesystem,
  async writeFile(path, ...args) {
    const name = basename(String(path))
    if (name.startsWith('manifest.json')) {
      await checkpoint('manifest-write', { path: String(path) })
    }
    return await filesystem.writeFile(path, ...args)
  },
  async rename(from, to) {
    await filesystem.rename(from, to)
    if (basename(String(to)) === 'model_quantized.onnx') {
      // Pause the completion of the actual last asset publication, so signal
      // checks after this await remain the installer's responsibility.
      await checkpoint('last-asset-written', { from: String(from), path: String(to) })
    }
    if (basename(String(to)) === 'manifest.json') {
      notify('manifest-published', { from: String(from), path: String(to) })
    }
  },
}

export const atomicPort = {
  async withFileLock(filename, operation, options) {
    notify('lock-wait', { path: filename, waitMs: options?.waitMs })
    const result = await withFileLock(
      filename,
      async () => {
        await checkpoint('lock-acquired', { path: filename })
        return await operation()
      },
      options,
    )
    notify('lock-released', { path: filename })
    return result
  },
  async writeFileAtomic(filename, content, options) {
    if (basename(filename) === 'manifest.json') {
      await checkpoint('manifest-atomic', { path: filename })
    }
    return await writeFileAtomic(filename, content, options)
  },
}

export class TestProxyAgent {
  constructor() {
    notify('dispatcher-created')
  }
  async close() {
    appendFileSync(fixture.closed, 'closed\n')
    notify('dispatcher-closed')
  }
}

export async function fetchPort(url, init) {
  const path = new URL(url).pathname.split(`/resolve/${fixture.model.revision}/`)[1]
  await checkpoint('http-admission', { path, url }, init?.signal)
  if (fixture.fail) throw new Error('synthetic HTTP boundary failure')
  const text = fixture.bytes[path]
  if (text === undefined) throw new Error(`Unscripted URL: ${url}`)
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  let finished = false
  let streamController
  const abort = () => {
    notify('http-abort', { path })
    if (!finished) streamController?.error(init.signal.reason)
  }
  init?.signal?.addEventListener('abort', abort, { once: true })
  const body = new ReadableStream({
    start(controller) {
      streamController = controller
    },
    async pull(controller) {
      await checkpoint('body-pull', { path, offset }, init?.signal)
      const end = Math.min(bytes.length, offset + Math.ceil(bytes.length / 2))
      controller.enqueue(bytes.slice(offset, end))
      offset = end
      if (offset === bytes.length) {
        finished = true
        controller.close()
        notify('body-finished', { path })
      }
    },
    cancel() {
      finished = true
      notify('body-cancelled', { path })
    },
  })
  return new Response(body, { status: 200 })
}
