/**
 * Production-stack smoke test: exercises the plugin through the same
 * published packages the npm-installed dsh ships, against a live Zotero.
 *
 * The plugin must first be installed into a dsh profile:
 *
 *   npm_config_cache=<repo>/.npm-cache dsh plugin --profile <name> add ./dsh-zotero-<version>.tgz
 *   cd ~/.dsh/profiles/<name>
 *   node --input-type=module < /path/to/dsh-zotero/scripts/smoke.mjs
 *
 * Run from inside the profile directory so bare imports resolve from the
 * profile's flat node_modules (the production dependency stack), not from
 * this repository's devDependencies.
 * @module dsh-zotero/scripts/smoke
 */

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ZoteroService, { ZOTERO_TOOL_NAMES } from 'dsh-zotero'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// Fail loud when run from this repository instead of a dsh profile: the bare
// import above must resolve to the profile's installed tarball (the
// production stack), not to this checkout's devDependencies. Resolution is
// anchored at the current working directory (which the header requires to
// be the profile directory) not at this script's location.
{
  const cwdRequire = createRequire(pathToFileURL(resolve(process.cwd(), 'package.json')).href)
  const resolved = cwdRequire.resolve('dsh-zotero/package.json')
  if (!resolved.includes('node_modules')) {
    throw new Error(
      `smoke must run from inside a dsh profile directory (resolved ${resolved}); see the header`,
    )
  }
}

const ctx = new Context()
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(ToolRuntime, {})
// Writes ride the production registration path too: `writeEnabled` registers
// the eight write tools so the registry assertion below covers all sixteen.
// Nothing dispatches them: the smoke only calls reads.
await ctx.plugin(ZoteroService, { writeEnabled: true })
const zotero = ctx.zotero

/** Build a `ZoteroObjectRef` from a model-facing item ref string (the seam's public grammar). */
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
console.log(`status: connected, api ${status.apiVersion}, server ${status.serverId ?? '(pre-10)'}`)

const search = await zotero.search({
  scope: { kind: 'library' },
  mode: 'metadata',
  sort: 'dateModified',
  direction: 'desc',
  offset: 0,
  limit: 2,
})
console.log(`search: ${search.returned}/${search.total} items`)

if (search.items.length > 0) {
  const ref = itemRef(search.items[0].ref)
  const detail = await zotero.get({ ref, include: new Set() })
  console.log(`get: ${detail.title} [${detail.itemType}] (children ${detail.children.total})`)

  const children = await zotero.children({
    ref,
    include: new Set(['notes', 'attachments', 'annotations']),
  })
  console.log(
    `children: notes ${children.notes?.returned ?? 0}, attachments ${children.attachments?.returned ?? 0}, annotations ${children.annotations?.returned ?? 0}`,
  )

  const evidence = await zotero.retrieve({ ref, query: 'a', sources: ['abstract'], passages: 1 })
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
    const location = await zotero.attachment({ ref })
    console.log(
      `attachment: ${location.kind} ${location.kind === 'file' ? location.path : location.url}`,
    )
  } catch (error) {
    // An item without attachments has nothing to resolve; the typed error is
    // the honest outcome, not a smoke failure.
    console.log(`attachment: skipped (${error.code ?? error.message})`)
  }
} else {
  console.log('library empty; item-level calls skipped')
}

const libraries = await zotero.browse({ kind: 'libraries', offset: 0, limit: 10 })
console.log(`browse: ${libraries.returned}/${libraries.total} libraries`)

const baseline = await zotero.changes({})
console.log(`changes: baseline at version ${baseline.cursor?.version ?? 'unknown'}`)

const assembly = await ctx.systemPrompt.assemble()
if (assembly.sections.find((entry) => entry.name === 'zotero:policy') === undefined) {
  throw new Error('zotero:policy section missing')
}
// The registry must carry exactly the plugin's vocabulary (every name the
// shared list declares, and no zotero_* tool it does not), so a registration
// that rots (a tool dropped, renamed, or added without the list) fails here.
const registered = ctx.tools.schemas().map((schema) => schema.name)
const missing = ZOTERO_TOOL_NAMES.filter((name) => !registered.includes(name))
const extra = registered.filter(
  (name) => name.startsWith('zotero_') && !ZOTERO_TOOL_NAMES.includes(name),
)
if (missing.length > 0 || extra.length > 0) {
  throw new Error(
    `tool registry out of step: missing [${missing.join(', ')}], unexpected [${extra.join(', ')}]`,
  )
}
if (search.items.length === 0) {
  console.log(`assembly: zotero:policy present, all ${ZOTERO_TOOL_NAMES.length} tools registered`)
  console.log('SMOKE PASS (empty library: item-level checks skipped, discovery covered)')
} else {
  console.log(`assembly: zotero:policy present, all ${ZOTERO_TOOL_NAMES.length} tools registered`)
  console.log('SMOKE PASS')
}
