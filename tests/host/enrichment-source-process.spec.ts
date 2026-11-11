/** Separate processes serialize real source-index read/modify/rename publication. */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { afterEach, expect, it } from 'vitest'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import { deferred, progress } from '../helpers/sync.ts'
import { SOURCE_KEY, SOURCE_RECORD } from './support/enrichment-artifacts.ts'

const dirs: string[] = []
const children: ReturnType<typeof writer>[] = []
afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => await child.dispose()))
  await Promise.all(
    dirs.splice(0).map(async (path) => await rm(path, { recursive: true, force: true })),
  )
})
async function directory(prefix: string) {
  const value = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(value)
  return value
}
function writer(script: string, root: string, key: string, hold: boolean) {
  const child = spawn(
    process.execPath,
    [script, root, key, JSON.stringify(SOURCE_RECORD), hold ? 'hold' : 'run'],
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  )
  const changed = progress()
  const events: string[] = []
  const ended = deferred<{ code: number | null; stderr: string }>()
  let stderr = ''
  let closed = false
  let failure: Error | undefined
  if (child.stderr === null) throw new Error('Source writer stderr pipe is missing')
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  child.on('message', (message: unknown) => {
    if (typeof message === 'string') {
      events.push(message)
      changed.notify()
    }
  })
  child.once('error', (error) => {
    failure = error
    changed.notify()
  })
  const watchdog = setTimeout(() => {
    child.kill('SIGKILL')
  }, 8000)
  child.once('close', (code) => {
    clearTimeout(watchdog)
    closed = true
    ended.resolve({ code, stderr })
    changed.notify()
  })
  return {
    events,
    done: ended.promise,
    until: async (event: string) => {
      await changed.when(() => events.includes(event) || closed || failure !== undefined)
      if (failure !== undefined) throw failure
      if (!events.includes(event))
        throw new Error(`Source writer closed before ${event}: ${stderr}`)
    },
    release: () => {
      if (child.connected) child.send('release', () => {})
    },
    dispose: async () => {
      if (!closed) child.kill('SIGKILL')
      await ended.promise
    },
  }
}

it('rereads the committed snapshot under the same public file lock in separate writer processes', async () => {
  const scripts = await directory('zotero-source-writer-code-')
  const root = await directory('zotero-source-writer-data-')
  const built = await build({
    entryPoints: [fileURLToPath(new URL('./support/enrichment-source-writer.ts', import.meta.url))],
    bundle: true,
    packages: 'external',
    plugins: [
      {
        name: 'resolve-installed-dependencies',
        setup(builder) {
          builder.onResolve({ filter: /^(?:@deepseek-ai\/|zod$)/ }, async (args) => ({
            path: fileURLToPath(import.meta.resolve(args.path)),
            external: true,
          }))
        },
      },
    ],
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  })
  const script = join(scripts, 'writer.mjs')
  await writeFile(script, built.outputFiles[0]!.contents)
  const alias = sourceKeyOf('https://example.org/process-two.pdf')
  const first = writer(script, root, SOURCE_KEY, true)
  children.push(first)
  await first.until('acquired')
  const second = writer(script, root, alias, false)
  children.push(second)
  await second.until('requesting')
  expect(second.events).not.toContain('acquired')
  expect(await new ParsedArtifactStore(root).sourceRecord(SOURCE_KEY)).toBeUndefined()
  first.release()
  expect(await first.done).toEqual({ code: 0, stderr: '' })
  expect(await second.done).toEqual({ code: 0, stderr: '' })
  const restarted = new ParsedArtifactStore(root)
  expect(await restarted.sourceRecord(SOURCE_KEY)).toEqual(SOURCE_RECORD)
  expect(await restarted.sourceRecord(alias)).toEqual(SOURCE_RECORD)
}, 15_000)
