/** Manual offline equivalence check against the actual installed Zotero source. */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { parse } from '@babel/parser'
import { normalizeForSearch } from '../src/search-text.ts'

const args = process.argv.slice(2)
const flags = new Map()
for (let index = 0; index < args.length; index += 2) {
  if (!['--source', '--archive', '--report'].includes(args[index]) || !args[index + 1])
    throw new Error(
      'Usage: node scripts/verify-zotero-search.mjs (--source utilities_internal.js | --archive omni.ja) [--report file.json]',
    )
  if (flags.has(args[index])) throw new Error(`Duplicate option ${args[index]}`)
  flags.set(args[index], args[index + 1])
}
if (flags.has('--source') === flags.has('--archive'))
  throw new Error('Choose exactly one source or archive.')
const entry = 'chrome/content/zotero/xpcom/utilities_internal.js'
const source = flags.has('--source')
  ? readFileSync(flags.get('--source'), 'utf8')
  : execFileSync('unzip', ['-p', flags.get('--archive'), entry], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
const file = parse(source, { sourceType: 'script' })
const wanted = new Set(['_searchNormalizeMap', '_searchFormattingTagRE', 'normalizeForSearch'])
const expressions = new Map()
function visit(node) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) visit(child)
    return
  }
  if (node.type === 'ObjectProperty' && wanted.has(node.key.name)) {
    if (expressions.has(node.key.name))
      throw new Error(`Ambiguous upstream definition ${node.key.name}`)
    expressions.set(node.key.name, source.slice(node.value.start, node.value.end))
  }
  for (const [key, child] of Object.entries(node))
    if (
      ![
        'loc',
        'extra',
        'comments',
        'leadingComments',
        'trailingComments',
        'innerComments',
      ].includes(key)
    )
      visit(child)
}
visit(file.program)
if (expressions.size !== wanted.size)
  throw new Error(
    'Upstream normalization definitions changed; inspect the source before updating extraction.',
  )
const internal = {}
for (const key of ['_searchNormalizeMap', '_searchFormattingTagRE'])
  internal[key] = runInNewContext('(' + expressions.get(key) + ')', {}, { timeout: 1000 })
const oracle = runInNewContext(
  '(' + expressions.get('normalizeForSearch') + ')',
  { Zotero: { Utilities: { Internal: internal } } },
  { timeout: 1000 },
)
let cases = 0
function compare(text) {
  const actual = normalizeForSearch(text),
    expected = oracle(text)
  cases++
  if (actual !== expected) throw new Error(JSON.stringify({ text, expected, actual }))
}
for (const text of [
  '',
  'café',
  'が',
  '한',
  'children’s “quoted”',
  'prime″ and ′minute',
  'a < b',
  '<i>café</i>',
  '<em>kept</em>',
  '<span class="nocase">eDNA</span>',
  '<span style="font-variant:small-caps;">Å</span>',
])
  compare(text)
// Every Unicode scalar plus deterministic multi-character interactions; no network or model.
for (let point = 0; point <= 0x10ffff; point++)
  if (point < 0xd800 || point > 0xdfff) compare(String.fromCodePoint(point))
let seed = 0x5a17c0de
for (let row = 0; row < 10_000; row++) {
  let text = ''
  for (let column = 0; column < 24; column++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    text += String.fromCodePoint(seed % 0x110000)
  }
  compare(text)
  compare('<i>' + text + '</i>')
}
let zoteroVersion
if (flags.has('--archive')) {
  const ini = readFileSync(join(dirname(flags.get('--archive')), 'application.ini'), 'utf8')
  zoteroVersion = /^Version=(.+)$/m.exec(ini)?.[1]
  if (!zoteroVersion) throw new Error('The installed archive has no application version.')
}
const report = {
  status: 'passed',
  zoteroVersion,
  cases,
  source: flags.get('--source') ?? `${flags.get('--archive')}!/${entry}`,
  upstreamSha256: createHash('sha256').update(source).digest('hex'),
  mirrorSha256: createHash('sha256')
    .update(readFileSync(new URL('../src/search-text.ts', import.meta.url)))
    .digest('hex'),
  networkUsed: false,
}
if (flags.has('--report'))
  writeFileSync(flags.get('--report'), JSON.stringify(report, null, 2) + '\n')
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
