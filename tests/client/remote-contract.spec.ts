/**
 * The zotero Remote contract across the two halves: shared structural identity
 * (`contract.ts`) plus the host and client codec arms. Both arms materialize
 * the same strict schemas from the shared `wire-schemas.ts`, so a schema edit
 * serves both halves; the parity cases below still read each arm's own
 * wrappers, so a wrapper wired to the wrong schema — or a schema dropped from
 * one arm's import — fails here instead of on the wire.
 * @module tests/client/remote-contract
 */

import { describe, expect, it } from 'vitest'
import { ZOTERO_REMOTE } from '../../src/client/remote.ts'
import { ZOTERO_STATUS_CLIENT_RESULT_CODEC } from '../../src/client/status-codec.ts'
import {
  ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL,
  ZOTERO_DIAGNOSTICS_TYPE_SYMBOL,
  ZOTERO_REF_PARAM_TYPE_SYMBOL,
  ZOTERO_REMOTE_PACKAGE,
  ZOTERO_REPORT_RESULT_TYPE_SYMBOL,
  ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL,
  ZOTERO_STATUS_INVOCATION_ID,
  ZOTERO_STATUS_INVOCATION_KIND,
  ZOTERO_STATUS_METHOD,
  ZOTERO_STATUS_SERVICE_KEY,
  ZOTERO_STATUS_TYPE_SYMBOL,
  zoteroStatusInvocation,
} from '../../src/contract.ts'
import { TYPERT_MANIFEST } from '../../src/typert.ts'

describe('zotero Remote contract layering', () => {
  it('shares package and structural endpoint identity across halves', () => {
    expect(ZOTERO_REMOTE.package).toBe(ZOTERO_REMOTE_PACKAGE)
    expect(TYPERT_MANIFEST.package).toBe(ZOTERO_REMOTE_PACKAGE)
    // Both halves build the descriptor through the factory, so its structural
    // identity is asserted on a real descriptor rather than on a second,
    // hand-maintained copy of the same fields.
    expect(zoteroStatusInvocation(ZOTERO_STATUS_CLIENT_RESULT_CODEC)).toMatchObject({
      id: ZOTERO_STATUS_INVOCATION_ID,
      service: ZOTERO_STATUS_SERVICE_KEY,
      namespace: 'zotero',
      method: ZOTERO_STATUS_METHOD,
      parameters: [],
      invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    })
  })

  it('mounts client descriptors that match host structural identity', () => {
    const host = TYPERT_MANIFEST.invocations.find((entry) => entry.method === 'status')
    const client = ZOTERO_REMOTE.descriptors.find((entry) => entry.method === 'status')
    expect(host).toBeDefined()
    expect(client).toBeDefined()
    expect(client).toMatchObject({
      id: host!.id,
      service: host!.service,
      namespace: host!.namespace,
      method: host!.method,
      invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
      parameters: [],
    })
  })

  it('claims the same strict typeSymbol on both codec arms', () => {
    const host = TYPERT_MANIFEST.invocations.find((entry) => entry.method === 'status')
    const client = ZOTERO_REMOTE.descriptors.find((entry) => entry.method === 'status')
    const hostResult = host!.result as { mode: string; typeSymbol: string }
    const clientResult = client!.result as { mode: string; typeSymbol: string }
    expect(hostResult.mode).toBe('strict')
    expect(clientResult.mode).toBe('strict')
    expect(hostResult.typeSymbol).toBe(ZOTERO_STATUS_TYPE_SYMBOL)
    expect(clientResult.typeSymbol).toBe(ZOTERO_STATUS_TYPE_SYMBOL)
  })

  it('materializes status schemas on both host and client codec arms', () => {
    const host = TYPERT_MANIFEST.invocations.find((entry) => entry.method === 'status')
    const client = ZOTERO_REMOTE.descriptors.find((entry) => entry.method === 'status')
    const hostCreate = (host!.result as { create: () => { parse: (v: unknown) => unknown } }).create
    const clientCreate = (client!.result as { create: () => { parse: (v: unknown) => unknown } })
      .create
    expect(typeof hostCreate).toBe('function')
    expect(typeof clientCreate).toBe('function')
    expect(client!.result).toBe(ZOTERO_STATUS_CLIENT_RESULT_CODEC)
    const valid = { providerId: 'local', connected: true }
    expect(hostCreate().parse(valid)).toEqual(valid)
    expect(clientCreate().parse(valid)).toEqual(valid)
    expect(() => clientCreate().parse({ providerId: 123 })).toThrow()
  })

  it('builds descriptors only through the shared factory without sharing mutable identity', () => {
    const probe = zoteroStatusInvocation(ZOTERO_STATUS_CLIENT_RESULT_CODEC)
    expect(probe.id).toBe(ZOTERO_STATUS_INVOCATION_ID)
    expect(probe.service).toBe(ZOTERO_STATUS_SERVICE_KEY)
    expect(probe.namespace).toBe('zotero')
    expect(probe.method).toBe(ZOTERO_STATUS_METHOD)
    // Two builds never share the mutable structural members.
    const other = zoteroStatusInvocation(ZOTERO_STATUS_CLIENT_RESULT_CODEC)
    expect(probe.invocation).not.toBe(other.invocation)
    expect(probe.parameters).not.toBe(other.parameters)
    expect(probe.invocation).toEqual({ kind: ZOTERO_STATUS_INVOCATION_KIND })
    expect(probe.parameters).toEqual([])
  })

  it('spells the host model service key from the shared contract constant', () => {
    const service = TYPERT_MANIFEST.model.services.find(
      (entry) => entry.key === ZOTERO_STATUS_SERVICE_KEY,
    )
    expect(service).toBeDefined()
    expect(service?.members).toContainEqual({
      kind: 'method',
      name: ZOTERO_STATUS_METHOD,
      signature: 'status(signal: AbortSignal): Promise<ZoteroStatusView>',
    })
  })
})

import { runRemoteParitySpec, type ParityCase } from './helpers/remote-parity.ts'

const PARITY_CASES: readonly ParityCase[] = [
  {
    method: 'status',
    boundary: { kind: 'result' },
    wire: 'status result',
    typeSymbol: ZOTERO_STATUS_TYPE_SYMBOL,
    valid: { providerId: 'local', connected: true },
    incomplete: [
      { connected: true },
      { providerId: 'local' },
      { providerId: 'local', connected: true, write: { enabled: true } },
    ],
    malformed: [
      { providerId: 7, connected: true },
      { providerId: 'local', connected: 'yes' },
      { providerId: 'local', connected: true, diagnosis: 3 },
      { providerId: 'local', connected: true, write: 'on' },
    ],
    undeclared: [
      { providerId: 'local', connected: true, extraFact: 1 },
      { providerId: 'local', connected: true, write: { enabled: true, authorized: false, x: 1 } },
    ],
    badEnum: [],
  },
  {
    method: 'resolveAttachment',
    boundary: { kind: 'param', index: 0 },
    wire: 'resolveAttachment ref parameter',
    typeSymbol: ZOTERO_REF_PARAM_TYPE_SYMBOL,
    valid: 'ITEM-ABCD',
    incomplete: [undefined],
    malformed: [42, '', null, {}],
    // A bare string has no members, so there is nothing to over-declare.
    undeclared: [],
    badEnum: [],
  },
  {
    method: 'resolveAttachment',
    boundary: { kind: 'result' },
    wire: 'resolveAttachment result',
    typeSymbol: ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL,
    valid: {
      ref: 'ITEM-ABCD',
      kind: 'file',
      title: 'paper.pdf',
      contentType: 'application/pdf',
      path: '/tmp/paper.pdf',
    },
    incomplete: [
      { kind: 'file', title: 'p', contentType: 'application/pdf' },
      { ref: 'ITEM-1', title: 'p', contentType: 'application/pdf' },
      { ref: 'ITEM-1', kind: 'file', contentType: 'application/pdf' },
      { ref: 'ITEM-1', kind: 'file', title: 'p' },
    ],
    malformed: [
      { ref: 1, kind: 'file', title: 'p', contentType: 'application/pdf' },
      { ref: 'ITEM-1', kind: 'file', title: 'p', contentType: 'application/pdf', path: 3 },
    ],
    undeclared: [
      { ref: 'ITEM-1', kind: 'file', title: 'p', contentType: 'application/pdf', extra: true },
    ],
    badEnum: [{ ref: 'ITEM-1', kind: 'other', title: 'p', contentType: 'application/pdf' }],
  },
  {
    method: 'diagnostics',
    boundary: { kind: 'result' },
    wire: 'diagnostics result',
    typeSymbol: ZOTERO_DIAGNOSTICS_TYPE_SYMBOL,
    valid: {
      entries: [{ seq: 1, ts: 0, level: 'info', event: 'probe', message: 'ok', count: 1 }],
      total: 1,
      truncated: false,
      debug: false,
    },
    incomplete: [
      { total: 1, truncated: false, debug: false },
      { entries: [], truncated: false, debug: false },
      { entries: [], total: 0, debug: false },
      { entries: [], total: 0, truncated: false },
      {
        entries: [{ seq: 1, ts: 0, level: 'info', event: 'e', message: 'm' }],
        total: 1,
        truncated: false,
        debug: false,
      },
    ],
    malformed: [
      { entries: {}, total: 0, truncated: false, debug: false },
      { entries: [], total: '0', truncated: false, debug: false },
      {
        entries: [{ seq: '1', ts: 0, level: 'info', event: 'e', message: 'm', count: 1 }],
        total: 1,
        truncated: false,
        debug: false,
      },
      {
        entries: [
          { seq: 1, ts: 0, level: 'info', event: 'e', message: 'm', count: 1, detail: { a: null } },
        ],
        total: 1,
        truncated: false,
        debug: false,
      },
    ],
    undeclared: [
      { entries: [], total: 0, truncated: false, debug: false, extra: 1 },
      {
        entries: [{ seq: 1, ts: 0, level: 'info', event: 'e', message: 'm', count: 1, extra: 1 }],
        total: 1,
        truncated: false,
        debug: false,
      },
    ],
    badEnum: [
      {
        entries: [{ seq: 1, ts: 0, level: 'trace', event: 'e', message: 'm', count: 1 }],
        total: 1,
        truncated: false,
        debug: false,
      },
    ],
  },
  {
    method: 'reportClientError',
    boundary: { kind: 'param', index: 0 },
    wire: 'reportClientError report parameter',
    typeSymbol: ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL,
    valid: { surface: 'panel', message: 'boom' },
    incomplete: [{ message: 'boom' }, { surface: 'panel' }],
    malformed: [
      { surface: '', message: 'boom' },
      { surface: 'panel', message: '' },
      { surface: 1, message: 'boom' },
      { surface: 'panel', message: 'boom', stack: 3 },
    ],
    undeclared: [{ surface: 'panel', message: 'boom', extra: 1 }],
    badEnum: [],
  },
  {
    method: 'reportClientError',
    boundary: { kind: 'result' },
    wire: 'reportClientError result',
    typeSymbol: ZOTERO_REPORT_RESULT_TYPE_SYMBOL,
    valid: { seq: 1 },
    incomplete: [{}],
    malformed: [{ seq: '1' }],
    undeclared: [{ seq: 1, extra: 1 }],
    badEnum: [],
  },
]

runRemoteParitySpec(PARITY_CASES)
