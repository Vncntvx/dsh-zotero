/** Terminal values survive cleanup races and missing producer values fail explicitly. */
import { expect, it, vi } from 'vitest'
import { ZoteroJobRunner, isJobArm } from '../../src/job-runner.js'
import { fakeExec, OWNER, registryOf } from '../helpers/job-runner-fixtures.js'

it('returns the completed value when owner cleanup already removed the registry record', async () => {
  const jobs = await registryOf()
  jobs.agentOf(OWNER)
  const remove = jobs.registry.remove.bind(jobs.registry)
  vi.spyOn(jobs.registry, 'remove').mockImplementation((id, caller) => {
    remove(id, caller)
    // The same public removal races the runner after the owner disposed it.
    remove(id, caller)
  })
  const sink = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const runner = new ZoteroJobRunner(jobs.registry, sink)
  await expect(
    runner.waitOrPromote(
      { label: 'settled export', exec: fakeExec(), run: async () => ({ count: 3 }) },
      1000,
    ),
  ).resolves.toEqual({ kind: 'foreground', value: { count: 3 } })
  expect(sink.warn).toHaveBeenCalledWith('job.remove', expect.any(String), {
    jobId: expect.any(String),
  })
})

it('refuses a completed producer with no value at the job boundary', async () => {
  const jobs = await registryOf()
  jobs.agentOf(OWNER)
  const runner = new ZoteroJobRunner(jobs.registry)
  await expect(
    runner.waitOrPromote(
      { label: 'invalid export', exec: fakeExec(), run: async () => undefined },
      1000,
    ),
  ).rejects.toMatchObject({
    code: 'ZOTERO_UNEXPECTED',
    message: 'The completed Zotero job produced no value.',
  })
})

it('fails a job exceeding its delivery budget instead of truncating its complete result', async () => {
  const jobs = await registryOf()
  jobs.agentOf(OWNER)
  const runner = new ZoteroJobRunner(jobs.registry)
  const job = runner.start({
    label: 'large result',
    exec: fakeExec(),
    run: async () => '字'.repeat(100),
    outputLimitBytes: 200,
    renderResult: (value) => value,
  })
  expect(await job.done).toMatchObject({
    status: 'failed',
    error: { code: 'ZOTERO_OUTPUT_TOO_LARGE' },
  })
  expect(jobs.registry.read(job.id, fakeExec().agent!.id).result).toBeUndefined()
})

it.each([null, undefined, 'background', 1])(
  'does not mistake a non-object result for a job arm',
  (value) => {
    expect(isJobArm(value)).toBe(false)
  },
)
