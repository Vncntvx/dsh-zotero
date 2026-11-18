import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

function entriesOf(text: string, retiredTitle: string) {
  const entries = new Map<number, 'active' | 'retired'>()
  let retired = false
  for (const [, level, title] of text.matchAll(/^(#{2,6}) (.+)$/gm)) {
    if (level === '##') retired = title === retiredTitle
    const match = /^DN-(\d+)[:：]/u.exec(title ?? '')
    if (!match) continue
    const number = Number(match[1])
    if (entries.has(number)) throw new Error(`Duplicate DN-${number}`)
    if (level !== (retired ? '###' : '##')) throw new Error(`Wrong heading level for DN-${number}`)
    entries.set(number, retired ? 'retired' : 'active')
  }
  return entries
}

interface EntryBlock {
  number: number
  lines: string[]
}

function blocksOf(text: string): EntryBlock[] {
  const blocks: EntryBlock[] = []
  let current: EntryBlock | undefined
  for (const line of text.split('\n')) {
    const heading = /^## DN-(\d+)[:：](.*)$/u.exec(line)
    if (heading === null) {
      current?.lines.push(line)
      continue
    }
    const title = (heading[2] ?? '').trim()
    if (title === '') throw new Error(`DN-${heading[1]} has no title`)
    current = { number: Number(heading[1]), lines: [] }
    blocks.push(current)
  }
  return blocks
}

const ZH_FIELDS = [
  /^- \*\*上游\*\*：/u,
  /^- \*\*上游特性\*\*：/u,
  /^- \*\*上游缺陷\*\*：/u,
  /^- \*\*本地补丁\*\*：/u,
  /^- \*\*为什么是妥协\*\*：/u,
  /^- \*\*上游期望\*\*：/u,
  /^- \*\*复核触发\*\*：/u,
  /^- \*\*验证\*\*：/u,
  /^- \*\*后续处理\*\*：/u,
] as const
const EN_FIELDS = [
  /^- \*\*Upstream\*\*:/u,
  /^- \*\*Upstream feature\*\*:/u,
  /^- \*\*Upstream defect\*\*:/u,
  /^- \*\*Local patch\*\*:/u,
  /^- \*\*Why this is a compromise\*\*:/u,
  /^- \*\*Upstream expectation\*\*:/u,
  /^- \*\*Review trigger\*\*:/u,
  /^- \*\*Verification\*\*:/u,
  /^- \*\*Follow-up\*\*:/u,
] as const

/** References outside the ledger that point at a number neither half defines. */
function danglingReferences(rel: string, text: string, known: ReadonlySet<number>): string[] {
  const missing: string[] = []
  text.split('\n').forEach((line, index) => {
    for (const [, digits] of line.matchAll(/\bDN-(\d+)\b/gu)) {
      if (!known.has(Number(digits))) missing.push(`${rel}:${index + 1} DN-${digits}`)
    }
  })
  return missing
}

it('protects the identity of every bilingual development note', () => {
  const zh = readFileSync(new URL('../../docs/development-notes.md', import.meta.url), 'utf8')
  const en = readFileSync(new URL('../../docs/development-notes.en.md', import.meta.url), 'utf8')
  const entries = entriesOf(zh, '已退役条目')
  expect(entries.size).toBeGreaterThan(0)
  expect(entries).toEqual(entriesOf(en, 'Retired entries'))
})

it('detects missing, renumbered or retired entries even when section counts still match', () => {
  const original = entriesOf('## DN-8: One\n## Retired\n### DN-6: Two', 'Retired')
  expect(entriesOf('## DN-8: One\n## Retired', 'Retired')).not.toEqual(original)
  expect(entriesOf('## DN-9: One\n## Retired\n### DN-6: Two', 'Retired')).not.toEqual(original)
  expect(entriesOf('## Retired\n### DN-8: One\n### DN-6: Two', 'Retired')).not.toEqual(original)
  expect(() => entriesOf('## DN-8: One\n## DN-8: Two', 'Retired')).toThrow('Duplicate DN-8')
  expect(() => entriesOf('### DN-8: One', 'Retired')).toThrow('Wrong heading level')
})

it('requires every upstream patch to state its cause, exit condition, and evidence', () => {
  const cases: Array<[string, readonly RegExp[]]> = [
    ['docs/development-notes.md', ZH_FIELDS],
    ['docs/development-notes.en.md', EN_FIELDS],
  ]
  for (const [path, fields] of cases) {
    const blocks = blocksOf(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'))
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      for (const field of fields) {
        expect(
          block.lines.some((line) => field.test(line)),
          `${path} DN-${block.number} is missing ${field}`,
        ).toBe(true)
      }
    }
  }
})

it('resolves every DN reference outside the ledger to an entry', () => {
  const known = new Set<number>([
    ...entriesOf(
      readFileSync(new URL('../../docs/development-notes.md', import.meta.url), 'utf8'),
      '已退役条目',
    ).keys(),
    ...entriesOf(
      readFileSync(new URL('../../docs/development-notes.en.md', import.meta.url), 'utf8'),
      'Retired entries',
    ).keys(),
  ])
  const roots = ['src', 'scripts', 'docs', 'tests'] as const
  const skipped = new Set([
    'docs/development-notes.md',
    'docs/development-notes.en.md',
    'tests/host/development-notes.spec.ts',
  ])
  const missing: string[] = []
  for (const root of roots) {
    const names = readdirSync(new URL(`../../${root}/`, import.meta.url), { recursive: true })
      .filter((name): name is string => typeof name === 'string')
      .filter((name) => /\.(?:ts|tsx|mjs|md|json|ya?ml)$/u.test(name))
    for (const name of names) {
      const rel = `${root}/${name}`
      if (skipped.has(rel)) continue
      const text = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
      missing.push(...danglingReferences(rel, text, known))
    }
  }
  expect(missing).toEqual([])
})

it('detects a dangling reference', () => {
  expect(danglingReferences('x.ts', 'see DN-4', new Set([4]))).toEqual([])
  expect(danglingReferences('x.ts', 'see DN-5', new Set([4]))).toEqual(['x.ts:1 DN-5'])
})
