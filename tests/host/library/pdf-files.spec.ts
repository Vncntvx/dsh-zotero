/**
 * Reading files have private permissions, an explicit lifetime, and a bound.
 * The store also reclaims what its own exited processes left behind, and it
 * must not touch anything else: the directory it lives in is shared with every
 * other process on the machine, so a reap that trusted the name pattern alone
 * would delete a live reader's document.
 * @module tests/host/library/pdf-files
 */

import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PdfReadingFiles } from '../../../src/library/pdf-files.js'

const roots: string[] = []
const stores: PdfReadingFiles[] = []

/** One private root per test, so a reap cannot observe another test's state. */
async function rootOf(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pdf-files-spec-'))
  roots.push(root)
  return root
}

function storeAt(root: string): PdfReadingFiles {
  const store = new PdfReadingFiles(root)
  stores.push(store)
  return store
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const bytes = new TextEncoder().encode('%PDF-1.7\nbody')

/** A pid that has provably exited: a child this process spawned and reaped. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' })
  if (child.pid === undefined) throw new Error('the probe child never started')
  return child.pid
}

it('keeps complete private bytes until their lease is released', async () => {
  const store = storeAt(await rootOf())
  const file = await store.stage(bytes, new AbortController().signal)
  expect(await readFile(file.path, 'utf8')).toBe('%PDF-1.7\nbody')
  expect((await stat(file.path)).mode & 0o777).toBe(0o600)
  await store.release(file.lease)
  await expect(stat(file.path)).rejects.toMatchObject({ code: 'ENOENT' })
  // A repeated release is a no-op, not an error.
  await store.release(file.lease)
})

it('removes every reading file on plugin disposal', async () => {
  const store = storeAt(await rootOf())
  const file = await store.stage(new Uint8Array([1]), new AbortController().signal)
  await store.dispose()
  await expect(stat(file.path)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(store.stage(new Uint8Array(), new AbortController().signal)).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_BUSY',
  })
})

it('refuses an aborted request before allocating a file', async () => {
  const root = await rootOf()
  const store = storeAt(root)
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(store.stage(new Uint8Array(), controller.signal)).rejects.toThrow('cancelled')
  // Nothing was allocated for the refused request.
  expect(await readdir(root)).toEqual([])
})

it('reclaims only directories whose owning process is gone', async () => {
  const root = await rootOf()
  const abandoned = join(root, `dsh-zotero-pdf-${deadPid()}-AbC123`)
  const live = join(root, `dsh-zotero-pdf-${process.pid}-Live42`)
  await mkdir(abandoned)
  await mkdir(live)
  const store = storeAt(root)
  await store.stage(bytes, new AbortController().signal)
  const names = await readdir(root)
  expect(names).not.toContain(basename(abandoned))
  expect(names).toContain(basename(live))
})

it('retries the reap after a failed pass instead of latching the failure', async () => {
  // The reap is memoized so a stream of opens scans once. A failure must not
  // keep that memo: the next open has to try again rather than fail forever.
  const root = join(await rootOf(), 'not-yet-created')
  const store = storeAt(root)
  await expect(store.stage(bytes, new AbortController().signal)).rejects.toMatchObject({
    code: 'ENOENT',
  })
  await mkdir(root)
  const abandoned = join(root, `dsh-zotero-pdf-${deadPid()}-AbC123`)
  await mkdir(abandoned)
  await store.stage(bytes, new AbortController().signal)
  expect(await readdir(root)).not.toContain(basename(abandoned))
})

it('refuses a seventeenth reading file while sixteen are held', async () => {
  const store = storeAt(await rootOf())
  const held = []
  for (let index = 0; index < 16; index += 1) {
    held.push(await store.stage(bytes, new AbortController().signal))
  }
  await expect(store.stage(bytes, new AbortController().signal)).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_BUSY',
  })
  // Releasing one lease frees the slot; the cap is on open files, not on the
  // store's lifetime.
  await store.release(held[0]!.lease)
  const next = await store.stage(bytes, new AbortController().signal)
  expect(held[0]!.lease).not.toBe(next.lease)
})

it('closes on disposal and leaves no directory behind for an in-flight stage', async () => {
  const root = await rootOf()
  const store = storeAt(root)
  const controller = new AbortController()
  const inFlight = store.stage(bytes, controller.signal)
  const disposing = store.dispose()
  // Whichever side wins the race, the store must settle both and leave no
  // partial directory: the abort makes creation clean up after itself, and the
  // dispose path releases anything that was already registered.
  controller.abort(new Error('caller cancelled'))
  await Promise.allSettled([inFlight])
  await disposing
  expect(await readdir(root)).toEqual([])
  await expect(store.stage(bytes, new AbortController().signal)).rejects.toMatchObject({
    code: 'ZOTERO_URL_PDF_BUSY',
  })
})
