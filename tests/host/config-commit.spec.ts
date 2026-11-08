/**
 * The real settings-commit seam: a live `Entry.update` through the Cordis
 * Loader routes every config-only change into `_commitVolatile` —
 * `fiber.resolveConfig` runs the plugin's `internal/config` veto, so a
 * violating candidate is warned and dropped with the references untouched,
 * and a valid candidate lands in the volatile refs and emits
 * `loader/volatile-update` to the plugin's rebuild handler. The host-lane
 * `commitLive` helper writes refs directly and cannot exercise this path;
 * only a real Loader composition can.
 *
 * Instance identity rides the diagnostics recorder: the context proxy wraps
 * each `get('zotero')` resolution, so the recorder is the stable instance
 * marker (the same one the settings specs use); a remount would construct a
 * fresh service with a fresh recorder.
 * @module tests/host/config-commit
 */

import { afterEach, describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ZoteroService from '../../src/index.js'
import { ZOTERO_WRITE_TOOL_NAMES } from '../helpers/tool-names.js'
import { expectValue } from '../helpers/lanes/host-lane.js'
import { setupCompositionLane, type CompositionLane } from '../helpers/lanes/composition-lane.js'

let lane: CompositionLane | undefined

afterEach(async () => {
  await lane?.dispose()
  lane = undefined
})

/** The plugin service of the booted composition. */
function zotero(): ZoteroService {
  return lane!.context.get('zotero') as ZoteroService
}

/** The loader entry that owns the plugin row. */
function zoteroEntry() {
  const entry = [...lane!.context.loader.entries()].find((row) => row.options.id === 'zotero')
  if (!entry) throw new Error('the zotero row has no loader entry')
  return entry
}

/** The registered write tools of the current composition. */
function registeredWriteTools(): string[] {
  return lane!
    .registeredToolNames()
    .filter((name) => (ZOTERO_WRITE_TOOL_NAMES as readonly string[]).includes(name))
}

/** One read tool call through the assembled registry, asserting the service is healthy. */
async function expectReadToolWorks(): Promise<void> {
  lane!.mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
    helpers.json(
      [
        {
          key: 'ABCD1234',
          version: 3,
          links: {},
          meta: { creatorSummary: 'Dao, Tri', parsedDate: '2023-07-28' },
          data: { key: 'ABCD1234', itemType: 'conferencePaper', title: 'FlashAttention-2' },
        },
      ],
      { 'Total-Results': '1' },
    ),
  )
  const batch = await lane!.context.tools.execute({
    calls: [
      {
        type: 'tool-call',
        id: ToolCallId('config-commit-read'),
        name: 'zotero_search',
        arguments: JSON.stringify({ query: 'flash', limit: 5 }),
      },
    ],
    signal: new AbortController().signal,
  })
  const call = batch.results[0]
  if (call === undefined) throw new Error('Tool execution produced no result')
  const result = expectValue(call.result, 'zotero_search')
  expect(result.value).toMatchObject({ total: 1, returned: 1 })
}

describe('a live config commit through the real loader entry', () => {
  it('vetoing a violating commit leaves the references and the service untouched', async () => {
    lane = await setupCompositionLane()
    const recorder = zotero().diagnostics
    const before = zotero().config.baseUrl

    await expect(
      zoteroEntry().update({ config: { baseUrl: 'http://example.com/api' } }),
    ).resolves.toBeUndefined()
    // The loader warned and dropped the candidate: the live references still
    // hold the composed values, the same service instance absorbed the commit,
    // and the plugin never saw a rebuild.
    expect(zotero().config.baseUrl).toBe(before)
    expect(zotero().diagnostics).toBe(recorder)
    await expectReadToolWorks()
    // The veto is recorded on the plugin's own ring, not silently swallowed.
    expect(recorder.snapshot().entries.some((entry) => entry.event === 'config.rejected')).toBe(
      true,
    )
  })

  it('lands a valid candidate after a vetoed one without a remount', async () => {
    lane = await setupCompositionLane()
    const recorder = zotero().diagnostics

    await expect(
      zoteroEntry().update({ config: { baseUrl: 'http://example.com/api' } }),
    ).resolves.toBeUndefined()
    // `Entry.update` replaces the whole config object, exactly as the
    // settings controller submits the full form in production, so the
    // recovery commit carries the composed baseUrl alongside the edit.
    await expect(
      zoteroEntry().update({ config: { baseUrl: lane!.mock.baseUrl, timeoutMs: 7000 } }),
    ).resolves.toBeUndefined()
    // The vetoed attempt must not wedge the seam: the next commit applies, on
    // the same service instance — no replacement, no remount.
    expect(zotero().diagnostics).toBe(recorder)
    const timeoutMs = zotero().config.timeoutMs
    expect(timeoutMs).toBe(7000)
  })

  it('re-registers the write tools when writeEnabled flips through the real commit', async () => {
    lane = await setupCompositionLane()
    expect(registeredWriteTools()).toHaveLength(0)

    await expect(zoteroEntry().update({ config: { writeEnabled: true } })).resolves.toBeUndefined()
    expect(registeredWriteTools().sort()).toEqual([...ZOTERO_WRITE_TOOL_NAMES].sort())

    await expect(zoteroEntry().update({ config: { writeEnabled: false } })).resolves.toBeUndefined()
    expect(registeredWriteTools()).toHaveLength(0)
  })
})
