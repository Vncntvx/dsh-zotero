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

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ZoteroService from '../../src/index.js'
import ScholarlyService from '../../src/scholarly/index.js'
import { SCHOLARLY_SETTINGS_NAMESPACE } from '../../src/settings-namespace.js'
import { expectValue } from '../helpers/lanes/host-lane.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { StubCommands } from '../helpers/stub-commands.js'
import { SCHOLARLY_TOOL_NAMES, ZOTERO_READ_TOOL_NAMES } from '../helpers/tool-names.js'

let root: string | undefined
let context: Context | undefined
let mock: MockZotero | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  await mock?.close()
  mock = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a composition from the shipped bundle patch.
 * @param extraPatches - patch layers applied on top of the shipped ones.
 */
async function bootComposition(extraPatches: readonly PatchOptions[] = []): Promise<void> {
  mock = await MockZotero.start()
  root = await mkdtemp(join(tmpdir(), 'dsh-zotero-loader-'))
  const configPath = join(root, 'cordis.yml')
  // The real bundle patch file is parsed with the include's own entry-list
  // dialect (the same parse `boot()` performs on `--patch` layers), so the
  // shipped artifact's rows (id `zotero`, name `dsh-zotero`, empty config,
  // and the scholarly row shipped off) are what the composition validates.
  const bundlePatch = await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
  const parsedPatch = load(bundlePatch, { schema: entryListSchema }) as PatchOptions[]
  await writeFile(
    configPath,
    [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: 'test-stub-commands'",
      '',
    ].join('\n'),
  )

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['test-stub-commands', StubCommands],
    ['dsh-zotero', ZoteroService],
    ['dsh-zotero/scholarly', ScholarlyService],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>

  // A later patch layer overrides the bundle row's config: the mock base
  // URL replaces the default so no test touches a live Zotero. This also
  // exercises the row-level config replacement semantics.
  await context.loader.create({
    name: 'cordis:include',
    config: {
      path: pathToFileURL(configPath).href,
      patches: [
        ...parsedPatch,
        { id: 'zotero', config: { baseUrl: mock.baseUrl } },
        ...extraPatches,
      ],
    },
  })
  await context.loader.await()
}

/** The names of every registered model tool in the current composition. */
function registeredToolNames(): string[] {
  return context!.tools.schemas().map((schema) => schema.name)
}

describe('the shipped bundle patch through a real Loader composition', () => {
  it('loads the plugin row, registers everything, and unwinds on disposal', async () => {
    await bootComposition([{ id: 'scholarly', disabled: false }])

    expect(context!.get('zotero')).toBeInstanceOf(ZoteroService)
    expect(context!.get('scholarly')).toBeInstanceOf(ScholarlyService)
    const names = registeredToolNames()
    // Registration order is a dependency-resolution artifact, not a contract,
    // so the composition asserts the set the shared list declares.
    expect([...names].sort()).toEqual([...ZOTERO_READ_TOOL_NAMES, ...SCHOLARLY_TOOL_NAMES].sort())
    const assembly = await context!.systemPrompt.assemble()
    expect(assembly.sections.some((entry) => entry.name === 'zotero:policy')).toBe(true)
    const commands = context!.get('commands') as StubCommands | undefined
    expect(commands?.registered.map((definition) => definition.name)).toEqual(['zotero'])

    // One end-to-end tool call through the assembled registry.
    mock!.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
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
    const result = expectValue(
      await context!.tools.execute({
        callId: ToolCallId('composition-search'),
        name: 'zotero_search',
        arguments: { query: 'flash', limit: 5 },
        signal: new AbortController().signal,
      }),
      'zotero_search',
    )
    expect(result.value).toMatchObject({ total: 1, returned: 1 })

    // Disposal unwinds every registration owned by the composed tree.
    await context!.fiber.dispose()
    expect(context!.get('zotero')).toBeUndefined()
    expect(context!.get('scholarly')).toBeUndefined()
    expect(context!.get('tools')).toBeUndefined()
    expect(commands?.registered).toEqual([])
  })

  it('leaves the scholarly component off until its row is enabled', async () => {
    // The shipped patch carries the scholarly row disabled, so the component
    // is not mounted: its service, its seven tools, and its prompt section are
    // all absent.
    await bootComposition()

    expect(context!.get('zotero')).toBeInstanceOf(ZoteroService)
    expect(context!.get('scholarly')).toBeUndefined()
    const names = registeredToolNames()
    expect([...names].sort()).toEqual([...ZOTERO_READ_TOOL_NAMES].sort())
    expect(names.filter((name) => name.startsWith('scholarly_'))).toHaveLength(0)
    const assembly = await context!.systemPrompt.assemble()
    expect(assembly.sections.some((entry) => entry.name === 'zotero:policy')).toBe(true)
    expect(assembly.sections.some((entry) => entry.name === 'scholarly:policy')).toBe(false)
  })

  it('names the scholarly row with the namespace the browser reads', async () => {
    // The harness serves a settings namespace per loader entry id, so the row
    // id is what the browser's config form addresses and what the plugin
    // manager's switch handles.
    const bundlePatch = await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const parsed = load(bundlePatch, { schema: entryListSchema }) as PatchOptions[]
    const rows = parsed.flatMap((patch) => patch.insert ?? [])
    const row = rows.find((entry) => entry.name === 'dsh-zotero/scholarly')
    expect(row).toBeDefined()
    expect(row!.id).toBe(SCHOLARLY_SETTINGS_NAMESPACE)
  })

  it('registers the scholarly tools and their prompt section once the row is enabled', async () => {
    await bootComposition([{ id: 'scholarly', disabled: false }])

    expect(context!.get('scholarly')).toBeInstanceOf(ScholarlyService)
    const names = registeredToolNames()
    expect(names.filter((name) => name.startsWith('scholarly_')).sort()).toEqual(
      [...SCHOLARLY_TOOL_NAMES].sort(),
    )
    const assembly = await context!.systemPrompt.assemble()
    expect(assembly.sections.some((entry) => entry.name === 'scholarly:policy')).toBe(true)
  })

  it('withdraws the scholarly tools when the component is unloaded', async () => {
    // Unloading the component removes its seven tools and its prompt section,
    // while the local library keeps its own.
    await bootComposition([{ id: 'scholarly', disabled: false }])

    const entry = [...context!.loader.entries()].find((row) => row.options.id === 'scholarly')
    expect(entry).toBeDefined()
    await entry?.fiber?.dispose()

    const names = registeredToolNames()
    expect(names.filter((name) => name.startsWith('scholarly_'))).toHaveLength(0)
    expect(names.filter((name) => name.startsWith('zotero_')).length).toBeGreaterThan(0)
    const assembly = await context!.systemPrompt.assemble()
    expect(assembly.sections.some((section) => section.name === 'scholarly:policy')).toBe(false)
    expect(assembly.sections.some((section) => section.name === 'zotero:policy')).toBe(true)
  })
})
