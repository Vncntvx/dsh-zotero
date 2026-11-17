/** Explicit parses recover stale, exhausted or corrupt durable tasks without masking storage errors. */
import { afterEach, expect, it, vi } from 'vitest'
import { cacheKeyOf, parseOnce, type ParseOnceDeps } from '../../src/enrichment/parse-once.ts'
import { GENERATION, LOCAL, PDF, parseDomain } from './support/enrichment-parse-domain.ts'

const worlds: ReturnType<typeof parseDomain>[] = []
afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.dispose()))
  vi.restoreAllMocks()
})
const input = { identity: LOCAL.key, generation: GENERATION, bytes: PDF, mode: 'free' as const }
const key = cacheKeyOf(input)
function worldOf() {
  const world = parseDomain({ mode: 'free' })
  worlds.push(world)
  const deps: ParseOnceDeps = {
    client: world.deps.client,
    store: world.store,
    flight: world.deps.flight,
    timing: { maxPolls: 1 },
  }
  return { ...world, parse: async () => await parseOnce(input, deps) }
}

it.each([true, false])(
  'replaces a 24-hour-old uploaded=%s task during the explicit parse',
  async (uploaded) => {
    const world = worldOf()
    const task = { taskId: 'stale-task', createdAt: Date.now() - 24 * 60 * 60_000 - 1000 }
    await world.store.putTask(
      key,
      uploaded
        ? { ...task, uploaded: true }
        : { ...task, uploaded: false, uploadUrl: 'https://upload.example/expired' },
    )
    const result = await world.parse()
    expect(result.cached).toBe(false)
    expect(result.artifact.meta.taskId).toBe('task-1')
    expect(world.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(
      world.fetch.mock.calls.some(
        ([url]) => url.includes('stale-task') || url.includes('/expired'),
      ),
    ).toBe(false)
    expect(await world.store.getTask(key)).toBeUndefined()
  },
)

it('removes an exhausted pending task and makes the next explicit attempt submit again', async () => {
  const world = worldOf(),
    original = world.fetch.getMockImplementation()!
  world.fetch.mockImplementation(async (url, init) => {
    if (init?.method !== 'POST' && url.includes('/api/v1/agent/parse/'))
      return new Response(
        JSON.stringify({ code: 0, data: { task_id: 'task-1', state: 'running' } }),
      )
    return await original(url, init)
  })
  await expect(world.parse()).rejects.toMatchObject({
    code: 'ZOTERO_ENRICHMENT_TASK_FAILED',
    message: expect.stringContaining('did not finish within 1 polls'),
  })
  expect(await world.store.getTask(key)).toBeUndefined()
  world.fetch.mockImplementation(original)
  expect((await world.parse()).artifact.markdown).toContain('Parsed document')
  expect(world.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2)
})

it.each(['{bad json', '{"taskId":"old-format"}'])(
  'clears a corrupt task and completes a fresh submission: %s',
  async (bad) => {
    const world = worldOf()
    world.fs.files.set(`/parsed/tasks/${key}.json`, new TextEncoder().encode(bad))
    expect((await world.parse()).artifact.meta.taskId).toBe('task-1')
    expect(world.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(await world.store.getTask(key)).toBeUndefined()
  },
)

it('keeps corruption-cleanup permission failures explicit and does not submit', async () => {
  const world = worldOf()
  world.fs.files.set(`/parsed/tasks/${key}.json`, new TextEncoder().encode('{bad json'))
  const error = Object.assign(new Error('EACCES: cannot remove damaged task'), { code: 'EACCES' })
  vi.mocked(world.fs.deps.rm).mockRejectedValueOnce(error)
  await expect(world.parse()).rejects.toBe(error)
  expect(world.fetch).not.toHaveBeenCalled()
  expect(world.fs.files.has(`/parsed/tasks/${key}.json`)).toBe(true)
})
