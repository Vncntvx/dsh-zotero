/**
 * Unit tests for direct artifact repair fallback.
 *
 * Verifies multi-frame Zstandard decoding and re-encoding, torn-tail recovery,
 * plain JSONL support, contract validation, and atomic replacement with backup.
 *
 * @module tests/host/artifact-repair
 */

import { describe, expect, it } from 'vitest'
import { constants, zstdCompressSync } from 'node:zlib'
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { repairArtifactFile } from '../../src/remediation/artifact-repair.js'
import { RETIRED_SESSION_EVENT_TYPES } from '../../src/remediation/session-events.js'

const CHECKSUM_OPTIONS = {
  params: { [constants.ZSTD_c_checksumFlag]: 1 },
}

function createSessionLines(id: string, events: readonly Record<string, unknown>[]): string[] {
  const header = JSON.stringify({
    id,
    version: 4,
    createdAt: 1,
    isSeeded: false,
    delegationDepth: 0,
  })
  const records = events.map((event, seq) =>
    JSON.stringify({ seq, time: 1 + seq, data: {}, ...event }),
  )
  return [header, ...records]
}

function cleanupTempFiles(prefix: string): void {
  const dir = tmpdir()
  for (const file of readdirSync(dir)) {
    if (file.startsWith(prefix)) {
      try {
        unlinkSync(join(dir, file))
      } catch {
        // ignore cleanup error
      }
    }
  }
}

describe('repairArtifactFile', () => {
  it('repairs a multi-frame Zstandard session log and creates a backup', async () => {
    const prefix = `art-repair-zstd-${Date.now()}`
    const testFile = join(tmpdir(), `${prefix}.jsonl.zstd`)

    const lines = createSessionLines('test-zstd-1', [
      { type: 'zotero/status' },
      { type: 'model/response', ignorable: true },
    ])
    // Frame 0: header
    const frame0 = zstdCompressSync(`${lines[0]}\n`, CHECKSUM_OPTIONS)
    // Frame 1: events
    const frame1 = zstdCompressSync(`${lines.slice(1).join('\n')}\n`, CHECKSUM_OPTIONS)
    const rawFile = Buffer.concat([frame0, frame1])
    writeFileSync(testFile, rawFile)

    try {
      const outcome = await repairArtifactFile(testFile, RETIRED_SESSION_EVENT_TYPES)

      expect(outcome.changedRecords).toBe(1)
      expect(outcome.totalRecords).toBe(3)
      expect(outcome.droppedTailBytes).toBe(0)
      expect(outcome.backupPath).toBeDefined()

      // Backup preserves exact original raw bytes
      const backupBytes = readFileSync(outcome.backupPath as string)
      expect(backupBytes.equals(rawFile)).toBe(true)

      // Repaired file is a readable multi-frame zstd artifact
      const repairedOutcome = await repairArtifactFile(testFile, RETIRED_SESSION_EVENT_TYPES)
      expect(repairedOutcome.changedRecords).toBe(0)
      expect(repairedOutcome.totalRecords).toBe(3)
    } finally {
      cleanupTempFiles(prefix)
    }
  })

  it('repairs a plain JSONL session log', async () => {
    const prefix = `art-repair-jsonl-${Date.now()}`
    const testFile = join(tmpdir(), `${prefix}.jsonl`)

    const lines = createSessionLines('test-jsonl-1', [{ type: 'zotero/status' }])
    writeFileSync(testFile, `${lines.join('\n')}\n`, 'utf8')

    try {
      const outcome = await repairArtifactFile(testFile, RETIRED_SESSION_EVENT_TYPES)

      expect(outcome.changedRecords).toBe(1)
      expect(outcome.totalRecords).toBe(2)
      expect(outcome.backupPath).toBeDefined()

      const text = readFileSync(testFile, 'utf8')
      expect(text).toContain('"ignorable":true')
    } finally {
      cleanupTempFiles(prefix)
    }
  })

  it('discards torn tail bytes at the end of a compressed session log', async () => {
    const prefix = `art-repair-torn-${Date.now()}`
    const testFile = join(tmpdir(), `${prefix}.jsonl.zstd`)

    const lines = createSessionLines('test-torn-1', [{ type: 'zotero/status' }])
    const frame0 = zstdCompressSync(`${lines[0]}\n`, CHECKSUM_OPTIONS)
    const frame1 = zstdCompressSync(`${lines.slice(1).join('\n')}\n`, CHECKSUM_OPTIONS)
    const tornBytes = zstdCompressSync(
      Buffer.from('{"seq":2,"time":3,"data":{},"type":"incomplete"}\n'),
      CHECKSUM_OPTIONS,
    ).subarray(0, 12)
    writeFileSync(testFile, Buffer.concat([frame0, frame1, tornBytes]))

    try {
      const outcome = await repairArtifactFile(testFile, RETIRED_SESSION_EVENT_TYPES)

      expect(outcome.changedRecords).toBe(1)
      expect(outcome.droppedTailBytes).toBe(tornBytes.length)
    } finally {
      cleanupTempFiles(prefix)
    }
  })

  it('refuses to repair an empty or invalid artifact file', async () => {
    const prefix = `art-repair-empty-${Date.now()}`
    const testFile = join(tmpdir(), `${prefix}.jsonl`)
    writeFileSync(testFile, '', 'utf8')

    try {
      await expect(repairArtifactFile(testFile, RETIRED_SESSION_EVENT_TYPES)).rejects.toThrow(
        'contains no records',
      )
    } finally {
      cleanupTempFiles(prefix)
    }
  })
})
