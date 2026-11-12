import { sandboxFixture } from '../helpers/sandbox-paths.ts'
import { tmpdir } from 'node:os'
/** Export completion includes file publication and spill. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { setupHostLane, expectValue, type HostLane } from '../helpers/lanes/host-lane.ts'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { composeRealJobs, type RealJobs } from '../helpers/real-jobs.ts'
import { resultStorage } from '../helpers/result-storage.ts'
import { deferred } from '../helpers/sync.ts'

let lane: HostLane
let directory: string
let base: string
beforeEach(async () => {
  base = await sandboxFixture('.zotero-export-')
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
  lane.mock.route('GET', '/api/users/0/items', (_req, _res, helpers) =>
    helpers.text('TY  - JOUR\n' + 'x'.repeat(17_000)),
  )
  if (!lane.ctx.get('attachments')) resultStorage(lane.ctx)
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

/** The job id one background (or promoted) call answered with. */
function jobIdOf(batch: { readonly results: ReadonlyArray<{ readonly result: unknown }> }): string {
  const outcome = batch.results[0]?.result as
    { readonly isError?: boolean; readonly value?: { readonly jobId?: string } } | undefined
  const jobId = outcome?.isError === false ? outcome.value?.jobId : undefined
  if (jobId === undefined) throw new Error('the call did not start a job')
  return jobId
}

/** The owner session every lane call carries. */
const caller = SessionId('test-session')

it.each([false, true])(
  'writes exactly once and leaves delivery to the present tool (background=%s)',
  async (background) => {
    const storage = resultStorage(lane.ctx)
    const jobs: RealJobs = await composeRealJobs(lane.ctx)
    jobs.agentOf('test-session')
    const { append, policy, saveText, session, invoke } = prepare()
    const batch = await invoke(background)
    const result = expectValue(batch.results[0]!.result, 'zotero_export')
    if (background) {
      const jobId = jobIdOf(batch)
      const outcome = await jobs.settled(JobId(jobId), caller)
      expect(outcome.status).toBe('completed')
      expect(jobs.registry.read(JobId(jobId), caller).result).toContain('full result persisted')
    } else {
      expect(result.value).toMatchObject({
        delivery: 'file',
      })
    }
    expect(await readFile(join(directory, 'references.ris'), 'utf8')).toContain('TY  - JOUR')
    expect(policy).toHaveBeenCalledWith({ session })
    // The harness present tool is the only producer of deliverables/presented.
    expect(append).not.toHaveBeenCalled()
    expect(saveText).not.toHaveBeenCalled()
    expect(storage.save).toHaveBeenCalledTimes(1)
    const persisted = JSON.parse(new TextDecoder().decode([...storage.files.values()][0])) as {
      data: { outputFile?: string; delivered?: boolean }
    }
    expect(persisted.data).toMatchObject({
      outputFile: join(directory, 'references.ris'),
    })
    expect(persisted.data).not.toHaveProperty('delivered')
  },
)

it('keeps a published export completed when result persistence fails', async () => {
  const storage = resultStorage(lane.ctx)
  storage.save.mockRejectedValueOnce(new Error('store unavailable'))
  const jobs: RealJobs = await composeRealJobs(lane.ctx)
  jobs.agentOf('test-session')
  const { append, invoke } = prepare()
  const batch = await invoke(true)
  expectValue(batch.results[0]!.result, 'zotero_export')

  const jobId = jobIdOf(batch)
  const outcome = await jobs.settled(JobId(jobId), caller)
  expect(outcome.status).toBe('completed')
  expect(jobs.registry.read(JobId(jobId), caller).result).toContain('TY  - JOUR')
  expect(append).not.toHaveBeenCalled()
  expect(
    lane.ctx.zotero.diagnostics
      .snapshot(50)
      .entries.some((entry) => entry.event === 'job.delivery'),
  ).toBe(true)
})

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
    const jobs: RealJobs = await composeRealJobs(lane.ctx)
    jobs.agentOf('test-session')
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
    const cancellation = new AbortController()
    const batch = await invoke(background, cancellation.signal)
    await writing.promise
    cancellation.abort()
    const jobId = jobIdOf(batch)
    expect(jobs.registry.get(JobId(jobId), caller).status).toBe('running')
    expect(append).not.toHaveBeenCalled()
    release.resolve()
    expect((await jobs.settled(JobId(jobId), caller)).status).toBe('completed')
    expect(append).not.toHaveBeenCalled()
  },
)

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
  const jobs: RealJobs = await composeRealJobs(lane.ctx)
  jobs.agentOf('test-session')
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
  const batch = await invoke(true)
  await exporting.promise
  const jobId = JobId(jobIdOf(batch))
  expect(jobs.registry.kill(jobId, caller, 'test cancellation')).toBe('requested')
  release.resolve()
  expect((await jobs.settled(jobId, caller)).status).toBe('killed')
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

it('permits an explicitly authorized platform temporary directory', async () => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'zotero-authorized-')))
  try {
    const target = join(temporary, 'references.ris')
    const { invoke } = prepare('workspace-write', target)
    const batch = await invoke(false)
    expect(batch.results[0]!.result.isError).toBe(false)
    expect(await readFile(target, 'utf8')).toContain('TY  - JOUR')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
