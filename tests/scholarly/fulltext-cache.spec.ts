/** Closed scholarly disk records and memory/disk invalidation. */
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ScholarlyTextStore, type FullTextRecord } from '../../src/scholarly/fulltext/store.ts'

const url = 'https://arxiv.org/html/2301.07041'
const record = {
  provider: 'arxiv-html',
  format: 'markdown',
  text: '# Paper\n\nBody.',
  source: 'arXiv HTML',
  url,
  sourceIdentity: url,
} satisfies FullTextRecord
let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'scholarly-cache-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function pathOf(key: string): string {
  return join(directory, 'v3', `${createHash('sha256').update(key).digest('hex')}.json`)
}

async function inject(key: string, value: unknown): Promise<void> {
  await mkdir(join(directory, 'v3'), { recursive: true })
  await writeFile(pathOf(key), JSON.stringify(value), 'utf8')
}

describe('ScholarlyTextStore closed envelope', () => {
  it('roundtrips provider, format, source identity and body through a cold store', async () => {
    const store = new ScholarlyTextStore(directory)
    expect(await store.get('paper')).toEqual({ kind: 'miss' })
    await store.set('paper', record)
    expect(await new ScholarlyTextStore(directory).get('paper')).toEqual({
      kind: 'hit',
      entry: { kind: 'document', record },
    })
    expect(JSON.parse(await readFile(pathOf('paper'), 'utf8'))).toEqual({
      version: 3,
      key: 'paper',
      entry: { kind: 'document', record },
    })
  })

  it.each([
    {
      name: 'legacy record',
      value: { key: 'paper', record: { text: 'old', source: 'old', structured: true } },
    },
    {
      name: 'legacy flag',
      value: {
        version: 3,
        key: 'paper',
        entry: { kind: 'document', record: { ...record, structured: true } },
      },
    },
    {
      name: 'unknown envelope field',
      value: { version: 3, key: 'paper', entry: { kind: 'document', record }, extra: true },
    },
    {
      name: 'unknown entry field',
      value: { version: 3, key: 'paper', entry: { kind: 'document', record, extra: true } },
    },
    {
      name: 'unknown provider',
      value: {
        version: 3,
        key: 'paper',
        entry: { kind: 'document', record: { ...record, provider: 'legacy' } },
      },
    },
    {
      name: 'provider format mismatch',
      value: {
        version: 3,
        key: 'paper',
        entry: { kind: 'document', record: { ...record, format: 'text' } },
      },
    },
    {
      name: 'provenance on HTML',
      value: {
        version: 3,
        key: 'paper',
        entry: { kind: 'document', record: { ...record, provenance: {} } },
      },
    },
    {
      name: 'wrong URL identity',
      value: {
        version: 3,
        key: 'paper',
        entry: { kind: 'document', record: { ...record, sourceIdentity: `${url}?other` } },
      },
    },
    {
      name: 'MinerU body in ordinary disk cache',
      value: {
        version: 3,
        key: 'paper',
        entry: { kind: 'document', record: { ...record, provider: 'mineru' } },
      },
    },
    {
      name: 'unknown version',
      value: { version: 2, key: 'paper', entry: { kind: 'document', record } },
    },
    { name: 'null envelope', value: null },
    { name: 'missing entry', value: { version: 3, key: 'paper' } },
    {
      name: 'non-string URL',
      value: {
        version: 3,
        key: 'paper',
        entry: { kind: 'document', record: { ...record, url: 42 } },
      },
    },
  ])('evicts a $name without treating it as a valid record', async ({ value }) => {
    await inject('paper', value)
    const store = new ScholarlyTextStore(directory)
    expect(await store.get('paper')).toMatchObject({ kind: 'corrupt' })
    expect(await store.get('paper')).toEqual({ kind: 'miss' })
  })

  it('reports a different logical key even when its record is otherwise valid', async () => {
    await inject('paper', { version: 3, key: 'other', entry: { kind: 'document', record } })
    expect(await new ScholarlyTextStore(directory).get('paper')).toEqual({
      kind: 'corrupt',
      reason: 'cache key mismatch',
    })
  })

  it('reports and evicts malformed JSON', async () => {
    await inject('paper', null)
    await writeFile(pathOf('paper'), '{ truncated', 'utf8')
    const store = new ScholarlyTextStore(directory)
    expect(await store.get('paper')).toEqual({ kind: 'corrupt', reason: 'malformed JSON' })
    expect(await store.get('paper')).toEqual({ kind: 'miss' })
  })

  it('ignores the old cache namespace without migrating its contents', async () => {
    await mkdir(join(directory, 'v2'))
    await writeFile(join(directory, 'v2', 'legacy.json'), JSON.stringify({ key: 'paper', record }))
    expect(await new ScholarlyTextStore(directory).get('paper')).toEqual({ kind: 'miss' })
    expect(await readdir(join(directory, 'v2'))).toEqual(['legacy.json'])
  })

  it('stores PDF target identity without persisting a MinerU artifact body or provenance', async () => {
    const pdfUrl = 'https://example.org/a.pdf?copy=one'
    await new ScholarlyTextStore(directory).set('paper', {
      provider: 'mineru',
      format: 'markdown',
      text: '# Private artifact',
      source: 'MinerU (free)',
      url: pdfUrl,
      sourceIdentity: pdfUrl,
      provenance: {
        parser: 'mineru',
        mode: 'free',
        artifactId: 'artifact',
        fingerprint: 'a'.repeat(64),
        sourceId: 'b'.repeat(64),
        generation: '24e3e1af-1b8e-4da3-933d-0139d6f748bf',
      },
    })
    expect(await new ScholarlyTextStore(directory).get('paper')).toEqual({
      kind: 'hit',
      entry: { kind: 'pdf', url: pdfUrl, sourceIdentity: pdfUrl },
    })
    const disk = await readFile(pathOf('paper'), 'utf8')
    expect(disk).not.toContain('Private artifact')
    expect(disk).not.toContain('provenance')
  })

  it('rejects a plain body belonging to a different PDF query', async () => {
    const pdfUrl = 'https://example.org/a.pdf?copy=one'
    const other = 'https://example.org/a.pdf?copy=two'
    await inject('paper', {
      version: 3,
      key: 'paper',
      entry: {
        kind: 'pdf',
        url: pdfUrl,
        sourceIdentity: pdfUrl,
        record: {
          provider: 'pdf-extract',
          format: 'text',
          text: 'wrong body',
          source: 'a PDF',
          url: other,
          sourceIdentity: other,
        },
      },
    })
    expect(await new ScholarlyTextStore(directory).get('paper')).toMatchObject({ kind: 'corrupt' })
  })
})

describe('ScholarlyTextStore resource ownership', () => {
  it('deletes a record from both memory and disk', async () => {
    const store = new ScholarlyTextStore(directory)
    await store.set('paper', record)
    await store.delete('paper')
    expect(await store.get('paper')).toEqual({ kind: 'miss' })
    expect(await new ScholarlyTextStore(directory).get('paper')).toEqual({ kind: 'miss' })
  })

  it('serves evicted memory entries from disk and isolates path-shaped logical keys', async () => {
    const store = new ScholarlyTextStore(directory, 1)
    await store.set('../../escape', record)
    await store.set('a/b', { ...record, text: 'second' })
    await store.set('a_b', { ...record, text: 'third' })
    expect(await store.get('../../escape')).toMatchObject({ kind: 'hit', entry: { record } })
    expect(await store.get('a/b')).toMatchObject({
      kind: 'hit',
      entry: { record: { text: 'second' } },
    })
    expect(await store.get('a_b')).toMatchObject({
      kind: 'hit',
      entry: { record: { text: 'third' } },
    })
    expect(
      (await readdir(join(directory, 'v3'))).every((name) => /^[a-f0-9]{64}\.json$/.test(name)),
    ).toBe(true)
  })

  it('does not retain an uncommitted body in memory after a disk write failure', async () => {
    const blocker = join(directory, 'file')
    await writeFile(blocker, 'not a directory')
    const store = new ScholarlyTextStore(join(blocker, 'cache'))
    await expect(store.set('paper', record)).rejects.toThrow()
    expect(await store.get('paper')).not.toMatchObject({ kind: 'hit' })
  })

  it('refuses a body over the cache ceiling', async () => {
    const store = new ScholarlyTextStore(directory)
    await expect(store.set('huge', { ...record, text: 'x'.repeat(5 * 1_048_576) })).rejects.toThrow(
      /exceeds the .* cache ceiling/,
    )
    expect(await store.get('huge')).toEqual({ kind: 'miss' })
  })

  it('does not repopulate memory or disk after disposal', async () => {
    const store = new ScholarlyTextStore(directory)
    await store.set('paper', record)
    store.dispose()
    await store.set('later', record)
    expect(await store.get('paper')).toEqual({ kind: 'miss' })
    expect(await store.get('later')).toEqual({ kind: 'miss' })
    expect(await new ScholarlyTextStore(directory).get('later')).toEqual({ kind: 'miss' })
  })
})
