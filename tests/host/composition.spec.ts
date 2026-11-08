/**
 * Loader composition test: boots the REAL bundle patch (`cordis.patch.yml`)
 * through the Cordis Loader, so the production assembly path (row id
 * `zotero`, package-name resolution, config validation against the service's
 * static schema, dependency-driven activation, and patch-layer override) is
 * exercised end to end, not just the hand-built `ctx.plugin(...)` wiring.
 *
 * The scholarly component's row is the single authorization for the external
 * tools: the shipped patch leaves the row off, an explicit `disabled: false`
 * layer turns it on, and unloading the component withdraws what it added.
 * @module tests/composition
 */

import { readFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ZoteroService from '../../src/index.js'
import ScholarlyService from '../../src/scholarly/index.js'
import ZoteroLibraryService from '../../src/library/index.js'
import { SCHOLARLY_SETTINGS_NAMESPACE } from '../../src/settings-namespace.js'
import { ZOTERO_LIBRARY_SETTINGS_NAMESPACE } from '../../src/contract.js'
import { expectValue } from '../helpers/lanes/host-lane.js'
import { setupCompositionLane, type CompositionLane } from '../helpers/lanes/composition-lane.js'
import { SCHOLARLY_TOOL_NAMES, ZOTERO_READ_TOOL_NAMES } from '../helpers/tool-names.js'

let lane: CompositionLane | undefined

afterEach(async () => {
  await lane?.dispose()
  lane = undefined
})

describe('the shipped bundle patch through a real Loader composition', () => {
  it('loads the plugin row, registers everything, and unwinds on disposal', async () => {
    lane = await setupCompositionLane([{ id: 'scholarly', disabled: false }])

    expect(lane.context.get('zotero')).toBeInstanceOf(ZoteroService)
    expect(lane.context.get('scholarly')).toBeInstanceOf(ScholarlyService)
    expect(lane.context.get('zoteroLibrary')).toBeInstanceOf(ZoteroLibraryService)
    const names = lane.registeredToolNames()
    // Registration order is a dependency-resolution artifact, not a contract,
    // so the composition asserts the set the shared list declares.
    expect([...names].sort()).toEqual([...ZOTERO_READ_TOOL_NAMES, ...SCHOLARLY_TOOL_NAMES].sort())
    const assembly = await lane.context.systemPrompt.assemble()
    expect(assembly.sections.some((entry) => entry.name === 'zotero:policy')).toBe(true)

    // One end-to-end tool call through the assembled registry.
    lane.mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
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
    const batch = await lane.context.tools.execute({
      calls: [
        {
          type: 'tool-call',
          id: ToolCallId('composition-search'),
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

    // Disposal unwinds every registration owned by the composed tree.
    await lane.context.fiber.dispose()
    expect(lane.context.get('zotero')).toBeUndefined()
    expect(lane.context.get('scholarly')).toBeUndefined()
    expect(lane.context.get('zoteroLibrary')).toBeUndefined()
    expect(lane.context.get('tools')).toBeUndefined()
  })

  it('leaves the scholarly component off until its row is enabled', async () => {
    // The shipped patch carries the scholarly row disabled, so the component
    // is not mounted: its service, its seven tools, and its prompt section are
    // all absent.
    lane = await setupCompositionLane()

    expect(lane.context.get('zotero')).toBeInstanceOf(ZoteroService)
    expect(lane.context.get('scholarly')).toBeUndefined()
    expect(lane.context.get('zoteroLibrary')).toBeInstanceOf(ZoteroLibraryService)
    const names = lane.registeredToolNames()
    expect([...names].sort()).toEqual([...ZOTERO_READ_TOOL_NAMES].sort())
    expect(names.filter((name) => name.startsWith('scholarly_'))).toHaveLength(0)
    const assembly = await lane.context.systemPrompt.assemble()
    expect(assembly.sections.some((entry) => entry.name === 'zotero:policy')).toBe(true)
    expect(assembly.sections.some((entry) => entry.name === 'scholarly:policy')).toBe(false)
  })

  it('names the scholarly row with the namespace the browser reads', async () => {
    // The harness serves a settings namespace per loader entry id, so the row
    // id is what the browser's config form addresses and what the plugin
    // manager's switch handles.
    const bundlePatch = await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const parsed = load(bundlePatch) as PatchOptions[]
    const rows = parsed.flatMap((patch) => patch.insert ?? [])
    const row = rows.find((entry) => entry.name === 'dsh-zotero/scholarly')
    expect(row).toBeDefined()
    expect(row!.id).toBe(SCHOLARLY_SETTINGS_NAMESPACE)
  })

  it('registers the scholarly tools and their prompt section once the row is enabled', async () => {
    lane = await setupCompositionLane([{ id: 'scholarly', disabled: false }])

    expect(lane.context.get('scholarly')).toBeInstanceOf(ScholarlyService)
    const names = lane.registeredToolNames()
    expect(names.filter((name) => name.startsWith('scholarly_')).sort()).toEqual(
      [...SCHOLARLY_TOOL_NAMES].sort(),
    )
    const assembly = await lane.context.systemPrompt.assemble()
    expect(assembly.sections.some((entry) => entry.name === 'scholarly:policy')).toBe(true)
  })

  it('withdraws the scholarly tools when the component is unloaded', async () => {
    // Unloading the component removes its seven tools and its prompt section,
    // while the local library keeps its own.
    lane = await setupCompositionLane([{ id: 'scholarly', disabled: false }])

    const entry = [...lane.context.loader.entries()].find((row) => row.options.id === 'scholarly')
    expect(entry).toBeDefined()
    await entry?.fiber?.dispose()

    const names = lane.registeredToolNames()
    expect(names.filter((name) => name.startsWith('scholarly_'))).toHaveLength(0)
    expect(names.filter((name) => name.startsWith('zotero_')).length).toBeGreaterThan(0)
    const assembly = await lane.context.systemPrompt.assemble()
    expect(assembly.sections.some((section) => section.name === 'scholarly:policy')).toBe(false)
    expect(assembly.sections.some((section) => section.name === 'zotero:policy')).toBe(true)
  })

  it('disables the library subcomponent when its row is disabled', async () => {
    lane = await setupCompositionLane([{ id: 'library', disabled: true }])
    expect(lane.context.get('zotero')).toBeInstanceOf(ZoteroService)
    expect(lane.context.get('zoteroLibrary')).toBeUndefined()
  })

  it('declares the library subcomponent row in cordis.patch.yml', async () => {
    const bundlePatch = await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const parsed = load(bundlePatch) as PatchOptions[]
    const rows = parsed.flatMap((patch) => patch.insert ?? [])
    const row = rows.find((entry) => entry.name === 'dsh-zotero/library')
    expect(row).toBeDefined()
    // The row id is the settings namespace the browser's config form
    // addresses; any other spelling leaves the library form unavailable.
    expect(row!.id).toBe(ZOTERO_LIBRARY_SETTINGS_NAMESPACE)
    expect(row!.config).toEqual({
      rightSidebarEnabled: true,
    })
  })
})
