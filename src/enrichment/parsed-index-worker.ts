/** Enrichment-owned SQLite worker. Every write transaction publishes a complete generation. */
import { closeSync, lstatSync, openSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { parentPort, workerData } from 'node:worker_threads'
import { chunkText, tokenize } from '../evidence.js'
import { markdownHeadingsOf } from '../parsed-title.js'

export interface IndexedDocument {
  readonly artifactId: string
  readonly sourceId: string
  readonly generation: string
  readonly digest: string
}

export interface IndexedPassage {
  readonly artifactId: string
  readonly generation: string
  readonly start: number
  readonly end: number
  readonly heading: string
}

export type IndexOperation =
  | { kind: 'known'; partition: string }
  | { kind: 'put'; partition: string; document: IndexedDocument; markdown: string }
  | { kind: 'prune'; partition: string; stale: readonly IndexedDocument[] }
  | { kind: 'discard'; root: string; artifactId: string }
  | {
      kind: 'match'
      partition: string
      allowed: readonly IndexedDocument[]
      variants: readonly (readonly string[])[]
      limit: number
      isolate: boolean
    }

const APP_ID = 0x44535a50
const CATALOG = 'CREATE TABLE parsed_partitions (name TEXT PRIMARY KEY) STRICT'
const TABLE_PREFIX = 'parsed_'
const TOKEN_SETTINGS = "tokenize='unicode61 remove_diacritics 0'"
const schemaOf = (name: string) => ({
  documents: `CREATE TABLE ${name}_doc (artifactId TEXT PRIMARY KEY, sourceId TEXT NOT NULL, generation TEXT NOT NULL, digest TEXT NOT NULL) STRICT`,
  passages: `CREATE TABLE ${name}_passage (id INTEGER PRIMARY KEY, artifactId TEXT NOT NULL, sourceId TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, heading TEXT NOT NULL, terms TEXT NOT NULL, FOREIGN KEY (artifactId) REFERENCES ${name}_doc(artifactId) ON DELETE CASCADE) STRICT`,
  byArtifact: `CREATE INDEX ${name}_artifact ON ${name}_passage (artifactId)`,
  fts: `CREATE VIRTUAL TABLE ${name}_fts USING fts5(terms, ${TOKEN_SETTINGS}, content='', contentless_delete=1)`,
})

function ensureRegularFile(path: string): boolean {
  try {
    const stat = lstatSync(path)
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (process.getuid !== undefined && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))
    )
      throw new Error('The parsed index path is not a private regular file.')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function transaction<T>(db: DatabaseSync, write: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = write()
    db.exec('COMMIT')
    return value
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function openIndex(path: string): DatabaseSync {
  const exists = ensureRegularFile(path)
  for (const suffix of ['-wal', '-shm', '-journal']) ensureRegularFile(path + suffix)
  if (!exists) {
    try {
      closeSync(openSync(path, 'wx', 0o600))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (!ensureRegularFile(path)) throw new Error('The parsed index disappeared during opening.')
  }
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: 5000 })
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY')
    transaction(db, () => {
      const id = db.prepare('PRAGMA application_id').get()?.application_id
      const version = db.prepare('PRAGMA user_version').get()?.user_version
      const objects = db.prepare('SELECT name, sql FROM sqlite_schema WHERE sql IS NOT NULL').all()
      if (id === 0 && version === 0 && objects.length === 0) {
        db.exec(`${CATALOG}; PRAGMA application_id=${APP_ID}; PRAGMA user_version=1`)
        return
      }
      const definitions = new Map(objects.map(({ name, sql }) => [name, sql]))
      if (id !== APP_ID || version !== 1 || definitions.get('parsed_partitions') !== CATALOG)
        throw new Error('The parsed index has an unknown owner or schema version.')
      definitions.delete('parsed_partitions')
      for (const { name } of db.prepare('SELECT name FROM parsed_partitions').all()) {
        if (typeof name !== 'string' || !/^parsed_[a-f0-9]{128}$/.test(name))
          throw new Error('The parsed index has an invalid partition.')
        const schema = schemaOf(name)
        for (const [key, suffix] of [
          ['documents', '_doc'],
          ['passages', '_passage'],
          ['byArtifact', '_artifact'],
          ['fts', '_fts'],
        ] as const) {
          if (definitions.get(name + suffix) !== schema[key])
            throw new Error('The parsed index has an unexpected partition schema.')
          definitions.delete(name + suffix)
        }
        for (const suffix of ['_data', '_idx', '_docsize', '_config'])
          definitions.delete(name + '_fts' + suffix)
      }
      if (definitions.size !== 0) throw new Error('The parsed index contains foreign SQL objects.')
    })
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

function ensurePartition(db: DatabaseSync, partition: string): string {
  if (!/^[a-f0-9]{128}$/.test(partition)) throw new Error('Invalid parsed index partition.')
  const name = TABLE_PREFIX + partition
  if (db.prepare('SELECT 1 FROM parsed_partitions WHERE name = ?').get(name)) return name
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM parsed_partitions WHERE name = ?').get(name)) return
    db.exec(Object.values(schemaOf(name)).join(';'))
    db.prepare('INSERT INTO parsed_partitions VALUES (?)').run(name)
  })
  return name
}

// Encode each ICU token as one FTS token, even when it contains an apostrophe;
// match queries encode identically.
const encoded = (term: string) => 'x' + Buffer.from(term).toString('hex')

function* markdownWindows(markdown: string, start: number, end: number) {
  while (start < end) {
    let stop = Math.min(start + 8192, end)
    if (stop < end) {
      const lastBreak = markdown.lastIndexOf('\n', stop - 1)
      if (lastBreak - start >= 4096) stop = lastBreak + 1
      else if (/[\uD800-\uDBFF]/u.test(markdown[stop - 1]!)) stop--
    }
    yield { start, text: markdown.slice(start, stop) }
    start = stop
  }
}

function replace(db: DatabaseSync, name: string, document: IndexedDocument, markdown: string) {
  const headings = markdownHeadingsOf(markdown)
  const sections = [{ start: 0, title: '', level: 0 }, ...headings]
  transaction(db, () => {
    const present = db
      .prepare(`SELECT generation,digest FROM ${name}_doc WHERE artifactId=?`)
      .get(document.artifactId)
    if (present?.generation === document.generation && present.digest === document.digest) return
    discard(db, name, document.artifactId)
    db.prepare(`INSERT INTO ${name}_doc VALUES (?,?,?,?)`).run(
      document.artifactId,
      document.sourceId,
      document.generation,
      document.digest,
    )
    const passage = db.prepare(`INSERT INTO ${name}_passage
      (artifactId,sourceId,start,end,heading,terms) VALUES (?,?,?,?,?,?)`)
    const index = db.prepare(`INSERT INTO ${name}_fts (rowid,terms) VALUES (?,?)`)
    const path: { readonly title: string; readonly level: number }[] = []
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]!
      while (path.length > 0 && path.at(-1)!.level >= section.level) path.pop()
      if (section.title !== '') path.push(section)
      const heading = path
        .map(({ title }) => title)
        .join(' / ')
        .slice(0, 1024)
      const end = sections[i + 1]?.start ?? markdown.length
      for (const window of markdownWindows(markdown, section.start, end)) {
        for (const chunk of chunkText(window.text, 180, 1800)) {
          const terms = tokenize(chunk.text).map(encoded).join(' ')
          if (terms === '') continue
          const row = passage.run(
            document.artifactId,
            document.sourceId,
            window.start + chunk.start!,
            window.start + chunk.end!,
            heading,
            terms,
          )
          index.run(row.lastInsertRowid, terms)
        }
      }
    }
  })
}

function discard(db: DatabaseSync, name: string, artifactId: string) {
  db.prepare(
    `DELETE FROM ${name}_fts WHERE rowid IN (
    SELECT id FROM ${name}_passage WHERE artifactId = ?
  )`,
  ).run(artifactId)
  db.prepare(`DELETE FROM ${name}_doc WHERE artifactId=?`).run(artifactId)
}

function match(
  db: DatabaseSync,
  name: string,
  operation: Extract<IndexOperation, { kind: 'match' }>,
) {
  if (operation.allowed.length === 0 || operation.variants.length === 0) return []
  db.exec(
    'CREATE TEMP TABLE IF NOT EXISTS allowed (artifactId TEXT PRIMARY KEY, generation TEXT, digest TEXT) STRICT',
  )
  const insert = db.prepare('INSERT INTO temp.allowed VALUES (?,?,?)')
  const authorized = `JOIN ${name}_doc d ON d.artifactId=p.artifactId
    JOIN temp.allowed a ON a.artifactId=d.artifactId AND a.generation=d.generation AND a.digest=d.digest`
  db.exec('BEGIN')
  try {
    for (const doc of operation.allowed) insert.run(doc.artifactId, doc.generation, doc.digest)
    // FTS5 uses corpus-wide length and frequency statistics. A JOIN filters
    // rows, but cannot prevent out-of-scope documents from changing ranking.
    const isolate =
      operation.isolate ||
      db
        .prepare(
          `SELECT 1 FROM ${name}_doc d
          LEFT JOIN temp.allowed a ON a.artifactId=d.artifactId AND a.generation=d.generation AND a.digest=d.digest
          WHERE a.artifactId IS NULL LIMIT 1`,
        )
        .get() !== undefined
    const fts = isolate ? 'isolated_fts' : name + '_fts'
    if (isolate) {
      db.exec(`CREATE VIRTUAL TABLE temp.isolated_fts USING fts5(terms,${TOKEN_SETTINGS},content='');
        INSERT INTO temp.isolated_fts (rowid,terms)
        SELECT p.id,p.terms FROM ${name}_passage p ${authorized}`)
    }
    const variants = operation.variants.filter((terms) => terms.length > 0)
    if (variants.length === 0) return []
    const args: SQLInputValue[] = variants.map((terms) => terms.map(encoded).join(' OR '))
    const hits = variants.map(
      () => `SELECT id,
      1.0/(60 + ROW_NUMBER() OVER (ORDER BY relevance,id)) AS vote
      FROM (SELECT p.id,${fts}.rank AS relevance FROM ${fts}
        JOIN ${name}_passage p ON p.id=${fts}.rowid ${authorized} WHERE ${fts} MATCH ?)`,
    )
    return db
      .prepare(
        `WITH votes AS (${hits.join(' UNION ALL ')}),
      scores AS (SELECT id,SUM(vote) AS score FROM votes GROUP BY id),
      ordered AS (
        SELECT p.artifactId,d.generation,p.start,p.end,p.heading,p.id,s.score,
          ROW_NUMBER() OVER (PARTITION BY p.sourceId ORDER BY s.score DESC,p.id) AS passageRank
        FROM scores s JOIN ${name}_passage p ON p.id=s.id ${authorized}
      )
      SELECT artifactId,generation,start,end,heading FROM ordered WHERE passageRank<=3
      ORDER BY score DESC,id LIMIT ?`,
      )
      .all(...args, operation.limit)
  } finally {
    // The allowlist and any isolated FTS table contain one request's data only.
    db.exec('ROLLBACK')
  }
}

function execute(db: DatabaseSync, operation: IndexOperation): unknown {
  if (operation.kind === 'discard') {
    if (!/^[a-f0-9]{64}$/.test(operation.root)) throw new Error('Invalid parsed artifact root.')
    transaction(db, () => {
      const partitions = db
        .prepare('SELECT name FROM parsed_partitions WHERE name GLOB ?')
        .all(TABLE_PREFIX + operation.root + '*')
      for (const { name } of partitions) discard(db, String(name), operation.artifactId)
    })
    return
  }
  const name = ensurePartition(db, operation.partition)
  switch (operation.kind) {
    case 'known':
      return db.prepare(`SELECT artifactId,sourceId,generation,digest FROM ${name}_doc`).all()
    case 'put':
      replace(db, name, operation.document, operation.markdown)
      return
    case 'prune':
      transaction(db, () => {
        const lookup = db.prepare(`SELECT generation,digest FROM ${name}_doc WHERE artifactId=?`)
        for (const doc of operation.stale) {
          const row = lookup.get(doc.artifactId)
          if (doc.generation === row?.generation && doc.digest === row.digest)
            discard(db, name, doc.artifactId)
        }
      })
      return
    case 'match':
      return match(db, name, operation)
  }
}

export function openParsedIndex(path: string) {
  const db = openIndex(path)
  return {
    execute: (operation: IndexOperation) => execute(db, operation),
    [Symbol.dispose]: () => db.close(),
  }
}

if (parentPort !== null) {
  const port = parentPort
  const db = openParsedIndex(workerData as string)
  port.on('message', ({ id, operation }: { id: number; operation: IndexOperation }) => {
    try {
      port.postMessage({ id, ok: true, value: db.execute(operation) })
    } catch (error) {
      port.postMessage({
        id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })
  port.once('close', () => db[Symbol.dispose]())
}
