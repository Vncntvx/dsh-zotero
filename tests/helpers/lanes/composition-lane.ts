/**
 * The real-Loader composition lane: boots the shipped bundle patch
 * (`cordis.patch.yml`) through the Cordis Loader exactly as production
 * assembly does — row ids, package-name resolution, patch-layer overrides,
 * dependency-driven activation — with the three plugin services bound to
 * in-process modules and a MockZotero answering the loopback calls. Specs
 * that need the loader's own seams (entry updates, row unloading) boot here;
 * the hand-built `ctx.plugin(...)` wiring lives in the host lane.
 * @module tests/helpers/lanes/composition-lane
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include, { type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { projectToolSchema } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline, executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline'
import ZoteroService from '../../../src/index.js'
import ScholarlyService from '../../../src/scholarly/index.js'
import ZoteroLibraryService from '../../../src/library/index.js'
import EnrichmentService from '../../../src/enrichment/index.js'
import { MockZotero } from '../mock-zotero.js'

/** One booted real-Loader composition, disposed as a unit by {@link dispose}. */
export interface CompositionLane {
  readonly context: Context
  readonly mock: MockZotero
  /** The names of every registered model tool in the current composition. */
  registeredToolNames(): string[]
  dispose(): Promise<void>
}

/**
 * Boot a composition from the shipped bundle patch.
 * @param extraPatches - patch layers applied on top of the shipped ones.
 */
export async function setupCompositionLane(
  extraPatches: readonly PatchOptions[] = [],
): Promise<CompositionLane> {
  const mock = await MockZotero.start()
  const root = await mkdtemp(join(tmpdir(), 'dsh-zotero-loader-'))
  const configPath = join(root, 'cordis.yml')
  // The shipped artifact contains plain YAML values; the include plugin
  // applies its child-owned expression dialect when it loads the patch.
  // Parsing the artifact here with js-yaml's current public API keeps this
  // independent of the include package's private js-yaml major.
  const bundlePatch = await readFile(new URL('../../../cordis.patch.yml', import.meta.url), 'utf8')
  const parsedPatch = load(bundlePatch) as PatchOptions[]
  await writeFile(
    configPath,
    ["- name: '@deepseek-ai/dsh-system-prompt'", "- name: '@deepseek-ai/dsh-tools'", ''].join('\n'),
  )

  const context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['dsh-zotero', ZoteroService],
    ['dsh-zotero/scholarly', ScholarlyService],
    ['dsh-zotero/library', ZoteroLibraryService],
    ['dsh-zotero/enrichment', EnrichmentService],
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
  context.tools.setExecutor({
    describe(tools) {
      return { schemas: tools.map((definition) => projectToolSchema(definition, false)) }
    },
    execute(input) {
      return executeToolBatch(input, new ToolExecutionPipeline(context), () => 10)
    },
  })

  return {
    context,
    mock,
    registeredToolNames(): string[] {
      return context.tools.schemas().map((schema) => schema.name)
    },
    async dispose(): Promise<void> {
      await context.fiber.dispose()
      await mock.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}
