/**
 * Direct artifact repair for session logs.
 *
 * Used as the verified fallback when the running DeepSeek Harness runtime
 * (such as 0.2.2-alpha.2) does not export `openArtifactMaintenance` on the
 * persistence service.
 *
 * Preserves the exact same contract:
 * 1. Checks lock exclusion.
 * 2. Parses concatenated Zstandard frames or plain text JSONL records.
 * 3. Injects `"ignorable":true` into retired event records (leaving all other bytes intact).
 * 4. Validates rewritten records against the harness storage contract.
 * 5. Writes an atomic `.bak.<timestamp>` backup before replacing the file.
 * 6. Atomically replaces the artifact file via `.tmp` and rename.
 *
 * @module dsh-zotero/remediation/artifact-repair
 */

import { constants, zstdCompress, zstdDecompress, type ZstdOptions } from 'node:zlib'
import { promisify } from 'node:util'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { assertContiguous, validateStoredEvents } from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'

const zstdCompressAsync = promisify(zstdCompress)
const zstdDecompressAsync = promisify(zstdDecompress)

const ZSTD_MAGIC = 0xfd2fb528

const CHECKSUM_OPTIONS: ZstdOptions = {
  params: { [constants.ZSTD_c_checksumFlag]: 1 },
}

/** Records one rewritten frame may carry before the next frame starts. */
const MAX_FRAME_RECORDS = 512

/** Plaintext bytes one rewritten frame may carry before the next frame starts. */
const MAX_FRAME_BYTES = 1024 * 1024

export interface ArtifactRepairOutcome {
  readonly changedRecords: number
  readonly totalRecords: number
  readonly droppedTailBytes: number
  readonly backupPath?: string
}

interface ZstdFrameRange {
  readonly start: number
  readonly end: number
}

interface ZstdFrameScan {
  readonly frames: ZstdFrameRange[]
  readonly tornStart?: number
}

/**
 * Scan structurally complete Zstandard frames in file order.
 */
function scanZstdFrames(buffer: Buffer): ZstdFrameScan {
  const frames: ZstdFrameRange[] = []
  let offset = 0

  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`)
    }
    offset += 4

    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) {
      throw new Error(
        `corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`,
      )
    }

    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes

    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`)
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }

    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }

  return { frames }
}

/** Split newline-terminated plaintext into records. */
function splitRecords(plaintext: Buffer): { records: string[]; tailBytes: number } {
  const records: string[] = []
  let start = 0
  for (
    let newline = plaintext.indexOf(0x0a);
    newline !== -1;
    newline = plaintext.indexOf(0x0a, start)
  ) {
    records.push(plaintext.toString('utf8', start, newline))
    start = newline + 1
  }
  return { records, tailBytes: plaintext.length - start }
}

/** Add `ignorable: true` as the first member of a JSON object record. */
function addIgnorableField(record: string): string {
  const open = record.indexOf('{')
  return `${record.slice(0, open + 1)}"ignorable":true,${record.slice(open + 1)}`
}

/** Compute frame slice boundaries for multi-frame compression. */
function frameEnd(lines: readonly string[], start: number): number {
  let end = start
  let bytes = 0
  while (end < lines.length && end - start < MAX_FRAME_RECORDS) {
    const recordBytes = Buffer.byteLength(lines[end] as string, 'utf8') + 1
    if (end > start && bytes + recordBytes > MAX_FRAME_BYTES) break
    bytes += recordBytes
    end += 1
  }
  return end
}

/** Encode records into Zstandard frames with checksums. */
async function encodeZstdArtifact(records: readonly string[]): Promise<Buffer> {
  const frames: Buffer[] = [await zstdCompressAsync(`${records[0] as string}\n`, CHECKSUM_OPTIONS)]
  const lines = records.slice(1)
  for (let start = 0; start < lines.length;) {
    const end = frameEnd(lines, start)
    frames.push(
      await zstdCompressAsync(`${lines.slice(start, end).join('\n')}\n`, CHECKSUM_OPTIONS),
    )
    start = end
  }
  return Buffer.concat(frames)
}

/**
 * Repair one session log artifact file by injecting `ignorable: true` into
 * matching retired event types.
 */
export async function repairArtifactFile(
  path: string,
  eventTypes: readonly string[],
): Promise<ArtifactRepairOutcome> {
  const rawBytes = await readFile(path)
  const isZstd = rawBytes.length >= 4 && rawBytes.readUInt32LE(0) === ZSTD_MAGIC

  let records: string[]
  let droppedTailBytes = 0

  if (isZstd) {
    const scan = scanZstdFrames(rawBytes)
    if (scan.frames.length === 0) {
      throw new Error(`cannot repair artifact "${path}": no complete Zstandard frames found`)
    }
    const plaintexts: Buffer[] = []
    for (const frame of scan.frames) {
      plaintexts.push(await zstdDecompressAsync(rawBytes.subarray(frame.start, frame.end)))
    }
    const decoded = splitRecords(Buffer.concat(plaintexts))
    records = decoded.records
    droppedTailBytes =
      scan.tornStart !== undefined ? rawBytes.length - scan.tornStart : decoded.tailBytes
  } else {
    const decoded = splitRecords(rawBytes)
    records = decoded.records
    droppedTailBytes = decoded.tailBytes
  }

  if (records.length === 0) {
    throw new Error(`cannot repair artifact "${path}": artifact contains no records`)
  }

  const targetTypes = new Set(eventTypes)
  let changedRecords = 0

  const rewrittenRecords = records.map((record, index) => {
    if (index === 0) return record
    try {
      const parsed = JSON.parse(record) as { readonly type?: unknown; readonly ignorable?: unknown }
      if (targetTypes.has(String(parsed.type)) && parsed.ignorable !== true) {
        changedRecords += 1
        return addIgnorableField(record)
      }
    } catch {
      // Non-JSON record handled by downstream validation
    }
    return record
  })

  if (changedRecords === 0) {
    return {
      changedRecords: 0,
      totalRecords: records.length,
      droppedTailBytes,
    }
  }

  // Contract validation prior to writing
  const header = JSON.parse(rewrittenRecords[0] as string) as SessionHeader
  const events = rewrittenRecords.slice(1).map((r) => JSON.parse(r) as SessionEvent)
  validateStoredEvents(header, events)
  assertContiguous(header.id, events, 0)

  // Durably write pre-rewrite backup copy
  const stamp = `${new Date().toISOString().replaceAll(':', '-')}.${process.pid}.${Math.random().toString(16).slice(2, 8)}`
  const backupPath = `${path}.bak.${stamp}`
  const backupHandle = await open(backupPath, 'wx', 0o600)
  try {
    await backupHandle.writeFile(rawBytes)
    await backupHandle.sync()
  } finally {
    await backupHandle.close()
  }

  // Encode replacement bytes
  const replacementBytes = isZstd
    ? await encodeZstdArtifact(rewrittenRecords)
    : Buffer.from(`${rewrittenRecords.join('\n')}\n`, 'utf8')

  // Publish replacement atomically via .tmp and rename
  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2, 8)}`
  const tmpHandle = await open(tmpPath, 'wx', 0o600)
  try {
    await tmpHandle.writeFile(replacementBytes)
    await tmpHandle.sync()
  } finally {
    await tmpHandle.close()
  }

  try {
    await rename(tmpPath, path)
  } catch (err) {
    try {
      await unlink(tmpPath)
    } catch {
      // Ignore cleanup error
    }
    throw err
  }

  return {
    changedRecords,
    totalRecords: records.length,
    droppedTailBytes,
    backupPath,
  }
}
