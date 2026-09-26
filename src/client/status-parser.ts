/**
 * Pure parsing utility that converts `/zotero` command raw text output
 * into a typed status representation for client view rendering.
 * @module dsh-zotero/client/status-parser
 */

import {
  ZOTERO_STATUS_CONNECTED,
  ZOTERO_STATUS_DISCONNECTED,
  ZOTERO_STATUS_NOT_REPORTED,
  ZOTERO_STATUS_SERVER_ID_UNREPORTED,
  ZOTERO_STATUS_FIELD_VERSION,
  ZOTERO_STATUS_FIELD_API,
  ZOTERO_STATUS_FIELD_SCHEMA,
  ZOTERO_STATUS_FIELD_SERVER_ID,
  ZOTERO_STATUS_FIELD_WRITE,
  ZOTERO_STATUS_WRITE_DISABLED,
  ZOTERO_STATUS_WRITE_ENABLED_STORED,
  ZOTERO_STATUS_WRITE_ENABLED_PENDING,
} from '../contract.ts'

/** Structured result derived from formatted status text. */
export interface ParsedZoteroStatus {
  readonly connected: boolean
  readonly zoteroVersion?: string
  readonly apiVersion?: string
  readonly schemaVersion?: string
  readonly serverId?: string
  readonly serverIdUnreported?: boolean
  readonly write?: { readonly enabled: boolean; readonly authorized: boolean }
  readonly diagnosis?: string
  readonly rawText: string
}

function parseField(line: string, label: string): string | undefined {
  const prefix = `${label}:`
  if (!line.startsWith(prefix)) return undefined
  const val = line.slice(prefix.length).trim()
  return val === ZOTERO_STATUS_NOT_REPORTED ? undefined : val
}

function parseWrite(
  line: string,
): { readonly enabled: boolean; readonly authorized: boolean } | undefined {
  const prefix = `${ZOTERO_STATUS_FIELD_WRITE}:`
  if (!line.startsWith(prefix)) return undefined
  const val = line.slice(prefix.length).trim()
  if (val === ZOTERO_STATUS_WRITE_DISABLED) {
    return { enabled: false, authorized: false }
  }
  if (val === ZOTERO_STATUS_WRITE_ENABLED_STORED) {
    return { enabled: true, authorized: true }
  }
  if (val === ZOTERO_STATUS_WRITE_ENABLED_PENDING) {
    return { enabled: true, authorized: false }
  }
  return undefined
}

/**
 * Parse the output text of `/zotero` or `/zotero status`.
 * @param text - The raw text produced by the command outcome.
 * @returns Parsed status object, or null if the text does not match expected status format.
 */
export function parseZoteroStatusText(text: string | undefined | null): ParsedZoteroStatus | null {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed === '') return null

  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const firstLine = lines[0]!
  if (firstLine.startsWith(ZOTERO_STATUS_CONNECTED)) {
    let zoteroVersion: string | undefined
    let apiVersion: string | undefined
    let schemaVersion: string | undefined
    let serverId: string | undefined
    let serverIdUnreported = false
    let write: { readonly enabled: boolean; readonly authorized: boolean } | undefined

    const serverIdPrefix = `${ZOTERO_STATUS_FIELD_SERVER_ID}:`

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!
      const parsedVer = parseField(line, ZOTERO_STATUS_FIELD_VERSION)
      if (parsedVer !== undefined) {
        zoteroVersion = parsedVer
        continue
      }
      const parsedApi = parseField(line, ZOTERO_STATUS_FIELD_API)
      if (parsedApi !== undefined) {
        apiVersion = parsedApi
        continue
      }
      const parsedSchema = parseField(line, ZOTERO_STATUS_FIELD_SCHEMA)
      if (parsedSchema !== undefined) {
        schemaVersion = parsedSchema
        continue
      }
      if (line === ZOTERO_STATUS_SERVER_ID_UNREPORTED) {
        serverIdUnreported = true
        continue
      }
      if (line.startsWith(serverIdPrefix)) {
        const val = line.slice(serverIdPrefix.length).trim()
        if (val.startsWith(ZOTERO_STATUS_NOT_REPORTED)) {
          serverIdUnreported = true
        } else {
          serverId = val
        }
        continue
      }
      const parsedWrite = parseWrite(line)
      if (parsedWrite !== undefined) {
        write = parsedWrite
        continue
      }
    }

    return {
      connected: true,
      zoteroVersion,
      apiVersion,
      schemaVersion,
      serverId: serverIdUnreported ? undefined : serverId,
      serverIdUnreported: serverIdUnreported || undefined,
      write,
      rawText: trimmed,
    }
  }

  if (firstLine.startsWith(ZOTERO_STATUS_DISCONNECTED)) {
    const diagnosis = lines.slice(1).join('\n').trim() || undefined
    return {
      connected: false,
      diagnosis,
      rawText: trimmed,
    }
  }

  return null
}
