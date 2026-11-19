/**
 * Read-only acceptance against a real Zotero using a packed profile and its
 * installed dsh runtime. Registers every tool; executes the eight read arms.
 *
 * node scripts/smoke.mjs --profile-dir <dsh-home>/profiles/web [--dsh <bin.js>]
 * The selected profile must already contain the installed plugin tarball.
 * @module dsh-zotero/scripts/smoke
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readFileSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

/** @param {string} flag @returns {string | undefined} the following argv entry, when present. */
function argAfter(flag) {
  const index = process.argv.indexOf(flag)
  return index < 0 ? undefined : process.argv[index + 1]
}
const profileDir = resolve(argAfter('--profile-dir') ?? process.cwd())
const profileManifest = resolve(profileDir, 'package.json')
const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
if (!manifest.dependencies?.['dsh-zotero'] || !manifest.dsh?.profile)
  throw new Error(
    'smoke requires a dsh profile with the installed plugin tarball; use --profile-dir',
  )
const profileRequire = createRequire(pathToFileURL(profileManifest))
const installedPlugin = realpathSync(profileRequire.resolve('dsh-zotero/package.json'))
if (!installedPlugin.includes('/node_modules/'))
  throw new Error('smoke requires an installed tarball, not a linked source checkout')
const dshEntry = realpathSync(
  argAfter('--dsh') ?? execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim(),
)
const runtimeRequire = createRequire(pathToFileURL(dshEntry))
/** @param {string} name */
const runtimeImport = (name) => import(pathToFileURL(runtimeRequire.resolve(name)).href)
const { Context } = await runtimeImport('@deepseek-ai/cordis')
const { PluginPackages, createRuntimeResolution, loadProfileDirectory } = await runtimeImport(
  '@deepseek-ai/dsh-app-boot',
)
const installAnchor = runtimeRequire.resolve('@deepseek-ai/dsh/package.json')
const profile = loadProfileDirectory('dsh', profileDir, installAnchor)
const resolution = await createRuntimeResolution({ installAnchor, profile })
const ctx = new Context()
await ctx.plugin(PluginPackages, { resolution })
try {
  const { default: SystemPrompt } = await runtimeImport('@deepseek-ai/dsh-system-prompt')
  const { default: ToolRuntime } = await runtimeImport('@deepseek-ai/dsh-tools')
  const {
    default: ZoteroService,
    ZOTERO_TOOL_NAMES,
    ZOTERO_WRITE_TOOL_NAMES,
  } = await import(pathToFileURL(profileRequire.resolve('dsh-zotero')).href)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(await runtimeImport('@deepseek-ai/dsh-tool-executor-native'), {})
  // Writes ride the production registration path too: `writeEnabled` registers
  // every declared write tool; the registry assertion covers the complete vocabulary.
  // Nothing dispatches them: the smoke only calls reads.
  await ctx.plugin(ZoteroService, { writeEnabled: true })
  const zotero = ctx.zotero

  /**
   * Build a `ZoteroObjectRef` from a model-facing item ref string (the seam's public grammar).
   * @param {string} ref
   */
  function itemRef(ref) {
    const key = /zotero:\/\/(?:user\/0|group\/(\d+))\/item\/([A-Z0-9]{8})/.exec(ref)
    if (key === null) throw new Error(`unexpected item ref ${ref}`)
    const groupId = key[1] === undefined ? undefined : Number(key[1])
    return {
      library: groupId === undefined ? { type: 'user', id: 0 } : { type: 'group', id: groupId },
      kind: 'item',
      key: key[2],
    }
  }

  const status = await zotero.status()
  if (!status.connected) throw new Error(`Zotero not connected: ${status.diagnosis}`)
  console.log(
    `status: connected, api ${status.apiVersion}, server ${status.serverId ?? '(pre-10)'}`,
  )

  const search = await zotero.search(
    {
      scope: { kind: 'library' },
      mode: 'metadata',
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 2,
    },
    undefined,
    { includeSupplemental: true },
  )
  console.log(`search: ${search.returned}/${search.total} items`)

  if (search.items.length === 0)
    throw new Error('Production read acceptance requires at least one real top-level Zotero item.')
  {
    const ref = itemRef(search.items[0].ref)
    const detail = await zotero.get({ ref, include: new Set() })
    console.log(`get: ${detail.title} [${detail.itemType}] (children ${detail.children.total})`)

    const batch = await zotero.getBatch({ refs: [ref] })
    if (batch.items.length !== 1 || batch.items[0].status !== 'ok')
      throw new Error('get_batch did not resolve the selected item')
    console.log(`get_batch: ${batch.items.length} item(s)`)
    const matched = await zotero.matchReferences({
      references: [{ inputId: 'smoke-selected-item', title: detail.title }],
    })
    if (matched.items.length !== 1) throw new Error('match_references did not return one result')
    console.log(`match_references: ${matched.items[0].status}`)

    const children = await zotero.get({
      ref,
      include: new Set(['notes', 'attachments', 'annotations']),
    })
    console.log(
      `children: notes ${children.notes?.returned ?? 0}, attachments ${children.attachments?.returned ?? 0}, annotations ${children.annotations?.returned ?? 0}`,
    )

    const evidence = await zotero.retrieve({
      mode: 'evidence',
      ref,
      query: 'a',
      sources: ['abstract'],
      passages: 1,
    })
    console.log(
      `retrieve: ${evidence.evidence.length} evidence passage(s), truncated ${evidence.truncated}`,
    )

    // 'a' is an arbitrary single-term recall probe: any indexed term works, the
    // smoke only needs one ranked pass over the evidence pipeline.
    const exported = await zotero.export({ refs: [ref], format: 'citation' })
    console.log(
      `export: ${exported.format}, ${exported.citations.length} citation(s), ${exported.citations[0].text.length} chars`,
    )

    try {
      const location = await zotero.attachment(ref)
      console.log(
        `attachment: ${location.kind} ${location.kind === 'file' ? location.path : location.url}`,
      )
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error)?.code !== 'ZOTERO_NO_ATTACHMENT') throw error
      console.log(
        `attachment: no usable attachment (${/** @type {{ code?: string }} */ (error).code})`,
      )
    }
  }

  const libraries = await zotero.browse({ kind: 'libraries', offset: 0, limit: 10 })
  console.log(`browse: ${libraries.returned}/${libraries.total} libraries`)

  const baseline = await zotero.changes({})
  console.log(`changes: baseline at version ${baseline.cursor?.version ?? 'unknown'}`)

  const assembly = await ctx.systemPrompt.assemble()
  if (
    assembly.sections.find(
      /** @param {{ name: string }} entry */ (entry) => entry.name === 'zotero:policy',
    ) === undefined
  ) {
    throw new Error('zotero:policy section missing')
  }
  // The registry must carry exactly the plugin's vocabulary (every name the
  // shared list declares, and no zotero_* tool it does not), so a registration
  // that rots (a tool dropped, renamed, or added without the list) fails here.
  const registered = ctx.tools
    .schemas()
    .map(/** @param {{ name: string }} schema */ (schema) => schema.name)
  const missing = ZOTERO_TOOL_NAMES.filter(
    /** @param {string} name */ (name) => !registered.includes(name),
  )
  const extra = registered.filter(
    /** @param {string} name */
    (name) => name.startsWith('zotero_') && !ZOTERO_TOOL_NAMES.includes(name),
  )
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `tool registry out of step: missing [${missing.join(', ')}], unexpected [${extra.join(', ')}]`,
    )
  }
  console.log(`assembly: zotero:policy present, all ${ZOTERO_TOOL_NAMES.length} tools registered`)
  console.log('SMOKE PASS: all eight read arms completed')

  console.log(`write tools registered, never executed: ${ZOTERO_WRITE_TOOL_NAMES.length}`)
} finally {
  await ctx.fiber.dispose()
}
