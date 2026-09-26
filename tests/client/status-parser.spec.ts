/**
 * Tests for the client-side `/zotero` command status output parser.
 * @module tests/client/status-parser
 */

import { describe, expect, it } from 'vitest'
import {
  ZOTERO_STATUS_CONNECTED,
  ZOTERO_STATUS_DISCONNECTED,
  ZOTERO_STATUS_SERVER_ID_UNREPORTED,
  ZOTERO_STATUS_WRITE_DISABLED,
  ZOTERO_STATUS_WRITE_ENABLED_PENDING,
  ZOTERO_STATUS_WRITE_ENABLED_STORED,
} from '../../src/contract.ts'
import { parseZoteroStatusText } from '../../src/client/status-parser.ts'

describe('parseZoteroStatusText', () => {
  it('returns null for empty, undefined, null, or non-string input', () => {
    expect(parseZoteroStatusText(undefined)).toBeNull()
    expect(parseZoteroStatusText(null)).toBeNull()
    expect(parseZoteroStatusText('')).toBeNull()
    expect(parseZoteroStatusText('   \n  \t  ')).toBeNull()
  })

  it('returns null for usage messages and non-status errors', () => {
    expect(parseZoteroStatusText('Usage: /zotero [status]')).toBeNull()
    expect(parseZoteroStatusText('Unknown command argument')).toBeNull()
  })

  it('parses a fully populated connected status string', () => {
    const raw = [
      'Zotero local API: connected',
      'Zotero version: 7.0.11',
      'API version: 3',
      'Schema version: 1',
      'Server ID: 0123456789abcdef',
      'Write: enabled (key stored)',
    ].join('\n')

    const result = parseZoteroStatusText(raw)
    expect(result).toEqual({
      connected: true,
      zoteroVersion: '7.0.11',
      apiVersion: '3',
      schemaVersion: '1',
      serverId: '0123456789abcdef',
      serverIdUnreported: undefined,
      write: { enabled: true, authorized: true },
      rawText: raw,
    })
  })

  it('parses connected status with an unreported Server ID and disabled write', () => {
    const raw = [
      'Zotero local API: connected',
      'Zotero version: 6.0.30',
      'API version: 3',
      'Schema version: 1',
      'Server ID: not reported — this build does not identify its database, so refs and cursors cannot be pinned to it',
      'Write: disabled',
    ].join('\n')

    const result = parseZoteroStatusText(raw)
    expect(result).toEqual({
      connected: true,
      zoteroVersion: '6.0.30',
      apiVersion: '3',
      schemaVersion: '1',
      serverId: undefined,
      serverIdUnreported: true,
      write: { enabled: false, authorized: false },
      rawText: raw,
    })
  })

  it('normalizes "not reported" field values to undefined', () => {
    const raw = [
      'Zotero local API: connected',
      'Zotero version: not reported',
      'API version: not reported',
      'Schema version: not reported',
    ].join('\n')

    const result = parseZoteroStatusText(raw)
    expect(result).toEqual({
      connected: true,
      zoteroVersion: undefined,
      apiVersion: undefined,
      schemaVersion: undefined,
      serverId: undefined,
      serverIdUnreported: undefined,
      write: undefined,
      rawText: raw,
    })
  })

  it('parses connected status with minimal or missing fields', () => {
    const raw = 'Zotero local API: connected\nWrite: enabled (no key yet)'
    const result = parseZoteroStatusText(raw)
    expect(result).toEqual({
      connected: true,
      zoteroVersion: undefined,
      apiVersion: undefined,
      schemaVersion: undefined,
      serverId: undefined,
      serverIdUnreported: undefined,
      write: { enabled: true, authorized: false },
      rawText: raw,
    })
  })

  it('ignores unrecognized lines in connected status', () => {
    const raw = 'Zotero local API: connected\nUnrecognized line: value'
    const result = parseZoteroStatusText(raw)
    expect(result).toEqual({
      connected: true,
      zoteroVersion: undefined,
      apiVersion: undefined,
      schemaVersion: undefined,
      serverId: undefined,
      serverIdUnreported: undefined,
      write: undefined,
      rawText: raw,
    })
  })

  it('parses disconnected status with diagnosis', () => {
    const raw = [
      'Zotero local API: not connected',
      'ZOTERO_NOT_RUNNING: Could not connect to Zotero at 127.0.0.1:23119',
    ].join('\n')

    const result = parseZoteroStatusText(raw)
    expect(result).toEqual({
      connected: false,
      diagnosis: 'ZOTERO_NOT_RUNNING: Could not connect to Zotero at 127.0.0.1:23119',
      rawText: raw,
    })
  })

  it('parses disconnected status without diagnosis', () => {
    const raw = 'Zotero local API: not connected'
    const result = parseZoteroStatusText(raw)
    expect(result).toEqual({
      connected: false,
      diagnosis: undefined,
      rawText: raw,
    })
  })

  it('parses formatted status outputs for connected states with various write permissions', () => {
    const raw1 = [
      ZOTERO_STATUS_CONNECTED,
      'Zotero version: 7.0.11',
      'API version: 3',
      'Schema version: 1',
      'Server ID: abcd1234efgh5678',
      `Write: ${ZOTERO_STATUS_WRITE_ENABLED_STORED}`,
    ].join('\n')
    const parsed1 = parseZoteroStatusText(raw1)
    expect(parsed1).toEqual({
      connected: true,
      zoteroVersion: '7.0.11',
      apiVersion: '3',
      schemaVersion: '1',
      serverId: 'abcd1234efgh5678',
      serverIdUnreported: undefined,
      write: { enabled: true, authorized: true },
      rawText: raw1,
    })

    const raw2 = [
      ZOTERO_STATUS_CONNECTED,
      'Zotero version: 7.0.11',
      ZOTERO_STATUS_SERVER_ID_UNREPORTED,
      `Write: ${ZOTERO_STATUS_WRITE_ENABLED_PENDING}`,
    ].join('\n')
    const parsed2 = parseZoteroStatusText(raw2)
    expect(parsed2).toEqual({
      connected: true,
      zoteroVersion: '7.0.11',
      apiVersion: undefined,
      schemaVersion: undefined,
      serverId: undefined,
      serverIdUnreported: true,
      write: { enabled: true, authorized: false },
      rawText: raw2,
    })

    const raw3 = [ZOTERO_STATUS_CONNECTED, `Write: ${ZOTERO_STATUS_WRITE_DISABLED}`].join('\n')
    const parsed3 = parseZoteroStatusText(raw3)
    expect(parsed3?.write).toEqual({ enabled: false, authorized: false })
  })

  it('parses disconnected state with diagnosis formatted output', () => {
    const raw = [ZOTERO_STATUS_DISCONNECTED, 'ZOTERO_NOT_RUNNING: offline'].join('\n')
    const parsed = parseZoteroStatusText(raw)
    expect(parsed).toEqual({
      connected: false,
      diagnosis: 'ZOTERO_NOT_RUNNING: offline',
      rawText: raw,
    })
  })
})
