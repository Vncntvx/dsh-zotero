/**
 * Durable parsing receipts beyond the happy path: a root that cannot be
 * created, a file that grows after its stat, a directory that moves between
 * write and revalidation, and a stored identity that names another operation.
 * Also: replay rules for persisted operations after a remount.
 * @module tests/host/enrichment-parse-jobs-persistence
 */
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ZOTERO_ENRICHMENT_OPERATION_CONFLICT,
  ZOTERO_ENRICHMENT_TASK_FAILED,
  ZOTERO_NOT_FOUND,
} from '../../src/errors.js'
import { ENRICHMENT_DEFAULTS } from '../../src/enrichment-preferences.js'
import {
  DiskParseJobPersistence,
  PARSE_CANCELLED_MESSAGE,
  type ParseJobRecord,
} from '../../src/enrichment/parse-jobs.js'
import { parseDigest } from '../../src/enrichment/parse-target.js'
import { deferred } from '../helpers/sync.js'
import {
  parseJobsFixture,
  parsedResult,
  parseRequest,
  parseSignal,
  type ParseJobsFixture,
} from './support/enrichment-parse-jobs.js'

const control = vi.hoisted(() => ({
  /** When set, `open` returns this handle instead of touching the path. */
  open: undefined as undefined | ((path: string) => object | undefined),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (path: string, flags: string | number, mode?: number) => {
      const handle = control.open?.(path)
      if (handle !== undefined) return handle as never
      return await (actual.open as (...args: unknown[]) => Promise<unknown>)(path, flags, mode)
    },
  }
})

let fixture: ParseJobsFixture | undefined
const roots: string[] = []
afterEach(async () => {
  control.open = undefined
  await fixture?.dispose()
  fixture = undefined
  vi.restoreAllMocks()
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  )
})

const owner = SessionId('parse-owner')

function recordOf(overrides: Partial<ParseJobRecord> = {}): ParseJobRecord {
  return {
    version: 1,
    owner: parseDigest('parse-owner'),
    operationId: randomUUID(),
    binding: parseDigest('binding'),
    action: 'parse',
    generation: randomUUID(),
    jobId: 'job-1',
    state: { kind: 'failed', code: ZOTERO_ENRICHMENT_TASK_FAILED, message: 'failed' },
    ...overrides,
  }
}

async function settled(host: ParseJobsFixture, jobId: string, sessionId = owner) {
  return await host.ctx.jobs.wait(JobId(jobId), 5000, sessionId)
}

describe('durable parsing receipt guards', () => {
  it('refuses a receipt root that is a regular file instead of swallowing the mkdir failure', async () => {
    const root = await mkdtempRoot()
    const file = join(root, 'not-a-directory')
    await writeFile(file, 'x')
    const persistence = new DiskParseJobPersistence(async () => file)

    await expect(persistence.put({ ...ENRICHMENT_DEFAULTS }, recordOf())).rejects.toMatchObject({
      code: 'ENOTDIR',
    })
    expect((await stat(file)).isFile()).toBe(true)
  })

  it('reports an oversized receipt when the file grows after its stat', async () => {
    fixture = await parseJobsFixture()
    const source = parseDigest('owner')
    const operationId = randomUUID()
    const name = parseDigest(JSON.stringify([source, operationId]))
    const path = join(await realpath(fixture.root), 'parse-jobs', `${name}.json`)
    await mkdir(join(fixture.root, 'parse-jobs'))
    await writeFile(path, '')
    const reads: number[] = []
    control.open = (opened) =>
      opened === path
        ? {
            stat: async () => ({ isFile: () => true, size: 65536 }),
            read: async (buffer: Buffer, offset: number, length: number) => {
              buffer.fill(0x30, offset, offset + length)
              reads.push(length)
              return { bytesRead: length }
            },
            close: async () => {},
          }
        : undefined

    await expect(
      fixture.persistence.get(fixture.config.value, source, operationId),
    ).rejects.toThrow('Oversized parsing receipt')
    expect(reads).toEqual([65537])
  })

  it('rejects a receipt directory that moves between the write and its revalidation', async () => {
    const first = await mkdtempRoot()
    const second = await mkdtempRoot()
    await mkdir(join(second, 'parse-jobs'))
    let calls = 0
    const persistence = new DiskParseJobPersistence(async () => {
      calls += 1
      return calls === 1 ? first : second
    })

    await expect(persistence.put({ ...ENRICHMENT_DEFAULTS }, recordOf())).rejects.toThrow(
      'Parsing receipt directory changed',
    )
    expect(await readdir(join(first, 'parse-jobs'))).toEqual([])
    expect(await readdir(join(second, 'parse-jobs'))).toEqual([])
  })

  it('refuses a stored receipt whose identity names another operation', async () => {
    fixture = await parseJobsFixture()
    const ownerHash = parseDigest('parse-owner')
    const operationId = randomUUID()
    const name = parseDigest(JSON.stringify([ownerHash, operationId]))
    await mkdir(join(fixture.root, 'parse-jobs'))
    await writeFile(
      join(fixture.root, 'parse-jobs', `${name}.json`),
      JSON.stringify(recordOf({ owner: parseDigest('intruder'), operationId: randomUUID() })),
    )

    await expect(
      fixture.persistence.get(fixture.config.value, ownerHash, operationId),
    ).rejects.toThrow('Parsing receipt identity mismatch')
  })

  it('round-trips a source generation independently from operation receipts', async () => {
    fixture = await parseJobsFixture()
    const source = parseDigest('source-under-test')
    const generation = randomUUID()

    expect(await fixture.persistence.generation(fixture.config.value, source)).toBeUndefined()
    await fixture.persistence.putGeneration(fixture.config.value, source, generation)
    expect(await fixture.persistence.generation(fixture.config.value, source)).toBe(generation)
  })

  it('refuses a retry that has no persisted operation to resume', async () => {
    fixture = await parseJobsFixture()

    await expect(
      fixture.helper.startDocumentParse(
        parseRequest(undefined, { action: 'retry' }),
        parseSignal(),
      ),
    ).rejects.toMatchObject({ code: ZOTERO_NOT_FOUND })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.resolveAttachment).not.toHaveBeenCalled()
    expect(fixture.ctx.jobs.list(owner)).toEqual([])
  })

  it('refuses a persisted operation rebound to another action after a remount', async () => {
    fixture = await parseJobsFixture()
    const request = parseRequest()
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    expect((await settled(fixture, started.jobId)).status).toBe('completed')
    const remounted = fixture.remount()

    await expect(
      remounted.startDocumentParse({ ...request, action: 'reparse' }, parseSignal()),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_OPERATION_CONFLICT })
    expect(fixture.execute).toHaveBeenCalledTimes(1)
  })

  it('reports a persisted pending operation as cancelled without resuming it after a remount', async () => {
    const gate = deferred<void>()
    const executeEntered = deferred<void>()
    const pendingWritten = deferred<void>()
    let calls = 0
    fixture = await parseJobsFixture({
      execute: async (execution) => {
        calls += 1
        executeEntered.resolve()
        await gate.promise
        return parsedResult(execution)
      },
    })
    const original = fixture.persistence.put.bind(fixture.persistence)
    vi.spyOn(fixture.persistence, 'put').mockImplementation(async (config, record) => {
      await original(config, record)
      if (record.state.kind === 'pending') pendingWritten.resolve()
    })
    const request = parseRequest()
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    await pendingWritten.promise
    await executeEntered.promise
    const remounted = fixture.remount()

    const receipt = await remounted.documentParseReceipt(
      { sessionId: request.sessionId, operationId: request.operationId },
      parseSignal(),
    )
    expect(receipt).toMatchObject({
      kind: 'cancelled',
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      message: PARSE_CANCELLED_MESSAGE,
    })
    const replay = await remounted.startDocumentParse(request, parseSignal())
    expect(replay.jobId).toBe(started.jobId)
    expect(replay.generation).toBe(started.generation)
    expect(fixture.ctx.jobs.list(owner)).toHaveLength(1)
    expect(calls).toBe(1)

    gate.resolve()
    expect((await settled(fixture, started.jobId)).status).toBe('completed')
  })

  it('records a positive parsed page count in the completed receipt', async () => {
    fixture = await parseJobsFixture({
      execute: async (execution) => {
        const base = parsedResult(execution)
        return {
          ...base,
          artifact: { ...base.artifact, meta: { ...base.artifact.meta, pageCount: 7 } },
        }
      },
    })
    const request = parseRequest()
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    expect((await settled(fixture, started.jobId)).status).toBe('completed')

    const receipt = await fixture.helper.documentParseReceipt(
      { sessionId: request.sessionId, operationId: request.operationId },
      parseSignal(),
    )
    expect(receipt).toMatchObject({ kind: 'completed', receipt: { pageCount: 7 } })
  })

  it('omits a non-positive parsed page count from the completed receipt', async () => {
    fixture = await parseJobsFixture({
      execute: async (execution) => {
        const base = parsedResult(execution)
        return {
          ...base,
          artifact: { ...base.artifact, meta: { ...base.artifact.meta, pageCount: 0 } },
        }
      },
    })
    const request = parseRequest()
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    expect((await settled(fixture, started.jobId)).status).toBe('completed')

    const receipt = await fixture.helper.documentParseReceipt(
      { sessionId: request.sessionId, operationId: request.operationId },
      parseSignal(),
    )
    expect(receipt.kind).toBe('completed')
    expect(receipt).not.toHaveProperty('receipt.pageCount')
  })
})

describe('artifact lookup projections', () => {
  it('reports an expired artifact lookup as expired rather than missing', async () => {
    fixture = await parseJobsFixture({
      lookup: async () => ({ kind: 'miss', reason: 'expired' }),
    })
    const request = parseRequest()

    expect(
      await fixture.helper.documentArtifact(
        { sessionId: request.sessionId, op: 'inspect', target: request.target },
        parseSignal(),
      ),
    ).toEqual({ kind: 'expired' })
  })

  it('returns the page count a ready artifact lookup records', async () => {
    fixture = await parseJobsFixture({
      lookup: async (input, config) => ({
        kind: 'hit',
        text: '# Ready',
        format: 'markdown',
        source: 'MinerU',
        pageCount: 12,
        provenance: parsedResult({ input, config, generation: randomUUID() }).provenance,
      }),
    })
    const request = parseRequest()

    expect(
      await fixture.helper.documentArtifact(
        { sessionId: request.sessionId, op: 'inspect', target: request.target },
        parseSignal(),
      ),
    ).toMatchObject({ kind: 'ready', characterCount: 7, pageCount: 12 })
  })
})

/** A temporary root this spec owns and removes. */
async function mkdtempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zotero-parse-receipts-'))
  roots.push(root)
  return root
}
