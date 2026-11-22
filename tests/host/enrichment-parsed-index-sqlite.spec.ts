/** The worker's SQLite operations against real files, including rejected state transitions. */
import { chmod, symlink } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openParsedIndex, type IndexOperation } from '../../src/enrichment/parsed-index-worker.ts'
import { withTempDir } from '../helpers/temp-dir.ts'

const partition = 'a'.repeat(128)
const document = { artifactId: 'artifact', sourceId: 'source', generation: '1', digest: 'first' }
const replacement = { ...document, generation: '2', digest: 'second' }
const lookup = { kind: 'known', partition } as const
const match = {
  kind: 'match',
  partition,
  allowed: [document],
  variants: [['o’clock'], ['洪峰']],
  limit: 3,
  isolate: false,
} satisfies IndexOperation

it('replaces a complete generation and fences stale pruning and matching', async () => {
  await withTempDir(async (root) => {
    const path = join(root, 'index.db')
    {
      using db = openParsedIndex(path)
      expect(db.execute(lookup)).toEqual([])
      const markdown = '# Model\n\n## Calibration\n\n洪峰 at o’clock.'
      db.execute({ kind: 'put', partition, document, markdown })
      db.execute({ kind: 'put', partition, document, markdown: 'ignored' })
      expect(db.execute(match)).toEqual([
        {
          artifactId: 'artifact',
          generation: '1',
          start: markdown.indexOf('Calibration'),
          end: markdown.lastIndexOf('.'),
          heading: 'Model / Calibration',
        },
      ])
      db.execute({ kind: 'put', partition, document: replacement, markdown: '# Seismic' })
      db.execute({ kind: 'prune', partition, stale: [document] })
      expect(db.execute(lookup)).toEqual([replacement])
      expect(db.execute(match)).toEqual([])
    }
    using reopened = openParsedIndex(path)
    expect(
      reopened.execute({ ...match, allowed: [replacement], variants: [['seismic']] }),
    ).toMatchObject([{ generation: '2', heading: 'Seismic' }])
    expect(reopened.execute({ ...match, allowed: [] })).toEqual([])
    expect(reopened.execute({ ...match, variants: [] })).toEqual([])
    expect(reopened.execute({ ...match, variants: [[]] })).toEqual([])
    reopened.execute({ kind: 'prune', partition, stale: [replacement] })
    expect(reopened.execute(lookup)).toEqual([])
  })
})

it('discards every indexed copy in the same root and preserves other roots', async () => {
  await withTempDir(async (root) => {
    using db = openParsedIndex(join(root, 'index.db'))
    const partitions = [partition, partition.slice(0, 64) + 'b'.repeat(64), 'b'.repeat(128)]
    for (const partition of partitions)
      db.execute({ kind: 'put', partition, document, markdown: 'Flood' })
    db.execute({ kind: 'discard', root: partition.slice(0, 64), artifactId: document.artifactId })
    expect(partitions.map((partition) => db.execute({ kind: 'known', partition }))).toEqual([
      [],
      [],
      [document],
    ])
    expect(() => db.execute({ ...lookup, partition: 'invalid' })).toThrow('Invalid parsed index')
    expect(() =>
      db.execute({ kind: 'discard', root: 'invalid', artifactId: document.artifactId }),
    ).toThrow('Invalid parsed artifact root')
  })
})

it('rejects foreign sqlite objects and leaves their data intact', async () => {
  await withTempDir(async (root) => {
    const path = join(root, 'index.db')
    {
      using db = openParsedIndex(path)
      db.execute(lookup)
    }
    {
      using db = new DatabaseSync(path)
      db.exec("CREATE TABLE original (value TEXT); INSERT INTO original VALUES ('keep')")
    }
    expect(() => openParsedIndex(path)).toThrow('foreign SQL objects')
    using db = new DatabaseSync(path, { readOnly: true })
    expect(db.prepare('SELECT value FROM original').get()?.value).toBe('keep')
  })
})

it.runIf(process.platform !== 'win32')(
  'rejects public databases and linked side files',
  async () => {
    await withTempDir(async (root) => {
      const path = join(root, 'index.db')
      openParsedIndex(path)[Symbol.dispose]()
      await chmod(path, 0o644)
      expect(() => openParsedIndex(path)).toThrow('private regular file')
      await chmod(path, 0o600)
      await symlink(join(root, 'elsewhere'), path + '-shm')
      expect(() => openParsedIndex(path)).toThrow('private regular file')
    })
  },
)

it.each([
  ['PRAGMA user_version=2', 'unknown owner or schema version'],
  ["INSERT INTO parsed_partitions VALUES ('bad')", 'invalid partition'],
  [`DROP INDEX parsed_${partition}_artifact`, 'unexpected partition schema'],
])('rejects mismatched persisted catalog state: %s', async (mutation, message) => {
  await withTempDir(async (root) => {
    const path = join(root, 'index.db')
    {
      using db = openParsedIndex(path)
      db.execute(lookup)
    }
    {
      using sqlite = new DatabaseSync(path)
      sqlite.exec(mutation)
    }
    expect(() => openParsedIndex(path)).toThrow(message)
  })
})

it('indexes evidence beyond a window boundary and preserves UTF-16 offsets', async () => {
  await withTempDir(async (root) => {
    using db = openParsedIndex(join(root, 'index.db'))
    const markdown =
      'x'.repeat(8191) +
      '😀 calibration\n\n' +
      'periodic flow\n'.repeat(1100) +
      '## Last section\n\nFinal aquifer measurement.'
    db.execute({ kind: 'put', partition, document, markdown })
    const hits = db.execute({
      ...match,
      variants: [['calibration'], ['aquifer']],
    }) as readonly { start: number; end: number }[]
    const texts = hits.map(({ start, end }) => markdown.slice(start, end))
    expect(texts.some((text) => text.includes('calibration'))).toBe(true)
    expect(texts.some((text) => text.includes('Final aquifer measurement'))).toBe(true)
    expect(texts.every((text) => !/\p{Surrogate}/u.test(text))).toBe(true)
  })
})

it('records a committed document with no indexable terms without fabricating a hit', async () => {
  await withTempDir(async (root) => {
    using db = openParsedIndex(join(root, 'index.db'))
    db.execute({ kind: 'put', partition, document, markdown: '… … — — 🟦' })
    expect(db.execute(lookup)).toEqual([document])
    expect(db.execute(match)).toEqual([])
  })
})
