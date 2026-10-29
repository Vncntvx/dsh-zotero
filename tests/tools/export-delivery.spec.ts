/** Export completion includes file publication, original-turn delivery and spill. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { setupHostLane, expectValue, type HostLane } from '../helpers/lanes/host-lane.ts'
import { TestJobRegistry } from '../helpers/fake-jobs.ts'
import { deferred } from '../helpers/sync.ts'

let lane: HostLane
let directory: string
let base: string
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(process.cwd(), '.zotero-export-')))
  directory = join(base, 'workspace')
  await mkdir(directory)
  await mkdir(join(base, 'outside'))
  lane = await setupHostLane()
})
afterEach(async () => {
  await lane.teardown()
  await rm(base, { recursive: true, force: true })
})

function prepare(
  mode: 'read-only' | 'workspace-write' = 'workspace-write',
  outputFile = 'references.ris',
) {
  const append = vi.fn()
  const session = { header: { id: 'delivery-session', cwd: directory }, append }
  const policy = vi.fn(() => ({ mode, workspaceRoot: directory }))
  // External service stubs model the owning session and its policy; the actual
  // filesystem below performs atomic writes and enforces this policy.
  lane.ctx.provide('sandboxPolicy', { defaultMode: 'workspace-write', resolve: policy } as never)
  new SandboxedFileSystem(lane.ctx, { cwd: directory, diffBasisMaxBytes: 1024 * 1024 })
  lane.ctx.provide('workingDirectory', { ensure: async () => directory } as never)
  lane.ctx.provide('agents', { turnBoundaryOf: () => ({ lastTurn: 4 }) } as never)
  lane.mock.route('GET', '/api/users/0/items', (_req, _res, helpers) =>
    helpers.text('TY  - JOUR\n' + 'x'.repeat(17_000)),
  )
  const saveText = vi.fn(async () => ({
    locator: 'spill://export',
    bytes: 17011,
    retrievalHint: 'read spill',
  }))
  lane.ctx.provide('spillStore', { saveText } as never)
  const invoke = (background: boolean, signal = new AbortController().signal) =>
    lane.ctx.tools.execute({
      calls: [
        {
          type: 'tool-call',
          id: ToolCallId('delivery-call'),
          name: 'zotero_export',
          arguments: JSON.stringify({
            refs: ['zotero://user/0/item/ABCD1234'],
            format: 'ris',
            outputFile,
            run_in_background: background,
          }),
        },
      ],
      signal,
      agent: { session } as never,
    })
  return { append, policy, saveText, session, invoke }
}

it.each([false, true])(
  'writes and delivers exactly once with original turn (background=%s)',
  async (background) => {
    const jobs = new TestJobRegistry(lane.ctx)
    const { append, policy, saveText, session, invoke } = prepare()
    const batch = await invoke(background)
    const result = expectValue(batch.results[0]!.result, 'zotero_export')
    if (background) {
      const job = [...jobs.jobs.values()][0]!
      const outcome = await job.hooks.done
      expect(outcome.status).toBe('completed')
      expect(outcome.result).toContain(join(directory, 'references.ris'))
      expect(outcome.result).toContain('spill://export')
    } else {
      expect(result.value).toMatchObject({
        outputFile: join(directory, 'references.ris'),
        delivered: true,
      })
    }
    expect(await readFile(join(directory, 'references.ris'), 'utf8')).toContain('TY  - JOUR')
    expect(policy).toHaveBeenCalledWith({ session })
    expect(append).toHaveBeenCalledExactlyOnceWith('deliverables/presented', {
      turn: 4,
      callId: 'delivery-call',
      files: [{ path: join(directory, 'references.ris'), description: 'Exported ris' }],
    })
    expect(saveText).toHaveBeenCalledOnce()
  },
)

it('session read-only rejects a deployment-writable filesystem without delivery', async () => {
  const { append, saveText, invoke } = prepare('read-only')
  const batch = await invoke(false)
  expect(batch.results[0]!.result.isError).toBe(true)
  await expect(readFile(join(directory, 'references.ris'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  expect(append).not.toHaveBeenCalled()
  expect(saveText).not.toHaveBeenCalled()
})

it.each([true, false])(
  'waits for file publication and survives caller cancellation (explicit background=%s)',
  async (background) => {
    await lane.teardown()
    lane = await setupHostLane({ foregroundWaitMs: 1 })
    const jobs = new TestJobRegistry(lane.ctx)
    const { append, invoke } = prepare()
    const writing = deferred<void>()
    const release = deferred<void>()
    const fs = lane.ctx.fs
    const write = fs.writeText.bind(fs)
    vi.spyOn(fs, 'writeText').mockImplementation(async (...args) => {
      writing.resolve()
      await release.promise
      return write(...args)
    })
    const caller = new AbortController()
    await invoke(background, caller.signal)
    await writing.promise
    caller.abort()
    const job = [...jobs.jobs.values()][0]!
    expect(job.status).toBe('running')
    expect(append).not.toHaveBeenCalled()
    release.resolve()
    expect((await job.hooks.done).status).toBe('completed')
    expect(append).toHaveBeenCalledOnce()
  },
)

it('reports delivery failure after writing with the actual path', async () => {
  const jobs = new TestJobRegistry(lane.ctx)
  const { append, invoke } = prepare()
  append.mockImplementation(() => {
    throw new Error('publication failed')
  })
  await invoke(true)
  const outcome = await [...jobs.jobs.values()][0]!.hooks.done
  expect(outcome.status).toBe('failed')
  expect(outcome.detail).toContain(join(directory, 'references.ris'))
  expect(await readFile(join(directory, 'references.ris'), 'utf8')).toContain('TY  - JOUR')
})

it.each(['absolute', 'relative', 'symlink'])(
  'refuses %s escape from the session root',
  async (kind) => {
    const outside = join(base, 'outside', 'references.ris')
    await symlink(join(base, 'outside'), join(directory, 'escape'))
    const target =
      kind === 'absolute'
        ? outside
        : kind === 'relative'
          ? '../outside/references.ris'
          : 'escape/references.ris'
    const { invoke, append } = prepare('workspace-write', target)
    const batch = await invoke(false)
    expect(batch.results[0]!.result.isError).toBe(true)
    await expect(readFile(outside)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(append).not.toHaveBeenCalled()
  },
)

it('job cancellation before export settles prevents writing and delivery', async () => {
  const jobs = new TestJobRegistry(lane.ctx)
  const { append, invoke } = prepare()
  const exporting = deferred<void>()
  const release = deferred<void>()
  vi.spyOn(lane.ctx.zotero, 'export').mockImplementation(async (_request, signal) => {
    exporting.resolve()
    await release.promise
    signal?.throwIfAborted()
    return { format: 'bibliography', text: 'cancelled export' }
  })
  const write = vi.spyOn(lane.ctx.fs, 'writeText')
  await invoke(true)
  await exporting.promise
  const job = [...jobs.jobs.values()][0]!
  job.hooks.cancel?.('test cancellation')
  release.resolve()
  expect((await job.hooks.done).status).toBe('killed')
  expect(write).not.toHaveBeenCalled()
  expect(append).not.toHaveBeenCalled()
})

it.each([
  { format: 'citation', outputFile: 'citations.html' },
  { format: 'ris', outputFile: ' ' },
])('rejects invalid outputFile requests before export ($format)', async (args) => {
  const exported = vi.spyOn(lane.ctx.zotero, 'export')
  const result = await lane.runTool('zotero_export', {
    refs: ['zotero://user/0/item/ABCD1234'],
    ...args,
  })
  expect(result.isError).toBe(true)
  expect(exported).not.toHaveBeenCalled()
})
it('refuses outputFile without session services before export', async () => {
  const exported = vi.spyOn(lane.ctx.zotero, 'export')
  const result = await lane.runTool('zotero_export', {
    refs: ['zotero://user/0/item/ABCD1234'],
    format: 'ris',
    outputFile: 'references.ris',
  })
  expect(result.isError).toBe(true)
  expect(exported).not.toHaveBeenCalled()
})
