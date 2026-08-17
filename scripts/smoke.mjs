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
import ZoteroService from 'dsh-zotero'

const ctx = new Context()
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(ToolRuntime, {})
await ctx.plugin(ZoteroService, {})
const zotero = ctx.zotero

/** Build a `ZoteroObjectRef` from a model-facing item ref string (the seam's public grammar). */
function itemRef(ref) {
  const key = /zotero:\/\/user\/0\/item\/([A-Z0-9]{8})/.exec(ref)?.[1]
  if (key === undefined) throw new Error(`unexpected item ref ${ref}`)
  return { library: { type: 'user', id: 0 }, kind: 'item', key }
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

  const evidence = await zotero.retrieve({ ref, query: 'a', sources: ['abstract'], passages: 1 })
  console.log(
    `retrieve: ${evidence.evidence.length} evidence passage(s), truncated ${evidence.truncated}`,
  )

  const exported = await zotero.export({ refs: [ref], format: 'citation' })
  console.log(
    `export: ${exported.format}, ${exported.citations.length} citation(s), ${exported.citations[0].text.length} chars`,
  )
} else {
  console.log('library empty; item-level calls skipped')
}

const assembly = await ctx.systemPrompt.assemble()
if (assembly.sections.find((entry) => entry.name === 'zotero:policy') === undefined) {
  throw new Error('zotero:policy section missing')
}
for (const name of [
  'zotero_search',
  'zotero_get',
  'zotero_retrieve',
  'zotero_attachment',
  'zotero_export',
]) {
  if (ctx.tools.get(name) === undefined) throw new Error(`tool ${name} not registered`)
}
console.log('assembly: zotero:policy present, all 5 tools registered')
console.log('SMOKE PASS')
