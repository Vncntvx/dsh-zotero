/**
 * Loader composition test: boots the REAL bundle patch (`cordis.patch.yml`)
 * through the Cordis Loader, so the production assembly path — row id
 * `zotero`, package-name resolution, config validation against the service's
 * static schema, dependency-driven activation, and patch-layer override — is
 * exercised end to end, not just the hand-built `ctx.plugin(...)` wiring.
 * @module tests/composition
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service, type Context as CordisContext } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ZoteroService from '../src/index.js'
import { MockZotero } from './helpers/mock-zotero.js'

/** Minimal command registry stand-in so the optional /zotero command path loads. */
class StubCommands extends Service {
  readonly registered: unknown[] = []

  constructor(ctx: CordisContext) {
    super(ctx, 'commands')
  }

  register(definition: unknown): () => void {
    const registered = this.registered
    return this.ctx.effect(() => {
      registered.push(definition)
      return () => {
        const index = registered.indexOf(definition)
        if (index >= 0) registered.splice(index, 1)
      }
    }, 'StubCommands.register()')
  }
}

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

describe('the shipped bundle patch through a real Loader composition', () => {
  it('loads the plugin row, registers everything, and unwinds on disposal', async () => {
    mock = await MockZotero.start()
    root = await mkdtemp(join(tmpdir(), 'dsh-zotero-loader-'))
    const configPath = join(root, 'cordis.yml')
    // The real bundle patch file is parsed with the include's own entry-list
    // dialect — the same parse `boot()` performs on `--patch` layers — so the
    // shipped artifact's rows (id `zotero`, name `dsh-zotero`, empty config)
    // are what the composition validates.
    const bundlePatch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
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
        patches: [...parsedPatch, { id: 'zotero', config: { baseUrl: mock.baseUrl } }],
      },
    })
    await context.loader.await()

    expect(context.get('zotero')).toBeInstanceOf(ZoteroService)
    const names = context.tools.schemas().map((schema) => schema.name)
    // Registration order is a dependency-resolution artifact, not a contract.
    expect([...names].sort()).toEqual(
      [
        'zotero_search',
        'zotero_get',
        'zotero_retrieve',
        'zotero_attachment',
        'zotero_export',
      ].sort(),
    )
    const assembly = await context.systemPrompt.assemble()
    expect(assembly.sections.some((entry) => entry.name === 'zotero:policy')).toBe(true)
    const commands = context.get('commands') as StubCommands | undefined
    expect(commands?.registered.map((definition) => (definition as { name: string }).name)).toEqual(
      ['zotero'],
    )

    // One end-to-end tool call through the assembled registry.
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
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
    const result = await context.tools.execute({
      callId: CallId('composition-search'),
      name: 'zotero_search',
      arguments: { query: 'flash', limit: 5 },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect(result.value).toMatchObject({ total: 1, returned: 1 })

    // Disposal unwinds every registration owned by the composed tree.
    await context.fiber.dispose()
    expect(context.get('zotero')).toBeUndefined()
    expect(context.get('tools')).toBeUndefined()
    expect(commands?.registered).toEqual([])
  })
})
