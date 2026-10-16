/**
 * The zotero Remote contract across the two halves: shared structural identity
 * (`contract.ts`) plus the host and client codec arms, which each materialize
 * their own strict schema for the same wire identity. Neither half may import
 * the other's schemas, so the parity cases below are the only thing standing
 * between a one-sided edit and a silent wire drift.
 * @module tests/client/remote-contract
 */

import { describe, expect, it } from 'vitest'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_REMOTE } from '../../src/client/remote.ts'
import { ZOTERO_STATUS_CLIENT_RESULT_CODEC } from '../../src/client/status-codec.ts'
import {
  ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL,
  ZOTERO_DIAGNOSTICS_TYPE_SYMBOL,
  ZOTERO_REF_PARAM_TYPE_SYMBOL,
  ZOTERO_REMOTE_PACKAGE,
  ZOTERO_REPORT_RESULT_TYPE_SYMBOL,
  ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL,
  ZOTERO_STATUS_ENDPOINT,
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
    expect(ZOTERO_STATUS_ENDPOINT).toMatchObject({
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
    expect(probe.invocation).not.toBe(ZOTERO_STATUS_ENDPOINT.invocation)
    expect(probe.parameters).not.toBe(ZOTERO_STATUS_ENDPOINT.parameters)
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
      signature: 'status(): Promise<ZoteroStatusView>',
    })
  })
})

/** The `{ mode, typeSymbol, create }` arm both halves hand the wire. */
interface BoundaryCodec {
  readonly mode: string
  readonly typeSymbol: string
  readonly create: () => { parse: (value: unknown) => unknown }
}

/** Which end of an invocation a boundary sits on. */
type Boundary = { readonly kind: 'result' } | { readonly kind: 'param'; readonly index: number }

/**
 * One wire boundary plus the verdicts both schema arms must reach. The sample
 * lists are hand-written per field on purpose: a reflection-based comparison
 * would compare the two schemas to each other and pass when both sides drift
 * the same way, which is exactly the failure a shared-identity contract must
 * not hide.
 */
interface ParityCase {
  /** The invocation method that carries the boundary. */
  readonly method: string
  /** Which end of that invocation it is. */
  readonly boundary: Boundary
  /** Human label used in failure messages. */
  readonly wire: string
  /** The strict typeSymbol the shared contract fixes for it. */
  readonly typeSymbol: string
  /** A value both arms must accept, to equal parsed results. */
  readonly valid: unknown
  /** Each entry omits a member the schema requires. */
  readonly incomplete: readonly unknown[]
  /** Each entry puts a member at a type the schema does not declare. */
  readonly malformed: readonly unknown[]
  /** Each entry adds a member `.strict()` must refuse. */
  readonly undeclared: readonly unknown[]
  /** Each entry names an enum member outside the declared set. */
  readonly badEnum: readonly unknown[]
}

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

/** Locate one boundary's codec on a descriptor. */
function codecAt(descriptor: InvocationDescriptor, boundary: Boundary): BoundaryCodec {
  if (boundary.kind === 'result') return descriptor.result as BoundaryCodec
  const parameter = descriptor.parameters[boundary.index]
  if (parameter === undefined) {
    throw new Error(`${descriptor.method} has no parameter at index ${boundary.index}`)
  }
  return parameter.codec as BoundaryCodec
}

/** Locate an invocation on either half by wire method. */
function invocationOf(
  invocations: readonly InvocationDescriptor[],
  method: string,
): InvocationDescriptor {
  const found = invocations.find((entry) => entry.method === method)
  if (found === undefined) throw new Error(`no invocation for ${method}`)
  return found
}

describe('host/client schema parity', () => {
  for (const testCase of PARITY_CASES) {
    it(`fixes one strict codec on both arms for the ${testCase.wire}`, () => {
      const hostCodec = codecAt(
        invocationOf(TYPERT_MANIFEST.invocations, testCase.method),
        testCase.boundary,
      )
      const clientCodec = codecAt(
        invocationOf(ZOTERO_REMOTE.descriptors, testCase.method),
        testCase.boundary,
      )
      expect(hostCodec.mode).toBe('strict')
      expect(clientCodec.mode).toBe('strict')
      expect(hostCodec.typeSymbol).toBe(testCase.typeSymbol)
      expect(clientCodec.typeSymbol).toBe(testCase.typeSymbol)
      expect(typeof hostCodec.create).toBe('function')
      expect(typeof clientCodec.create).toBe('function')
    })

    it(`holds both arms to the same verdicts on the ${testCase.wire}`, () => {
      const hostParse = codecAt(
        invocationOf(TYPERT_MANIFEST.invocations, testCase.method),
        testCase.boundary,
      ).create()
      const clientParse = codecAt(
        invocationOf(ZOTERO_REMOTE.descriptors, testCase.method),
        testCase.boundary,
      ).create()
      // A case whose refusal lists all emptied out would pass vacuously.
      const refusals = [
        ...testCase.incomplete,
        ...testCase.malformed,
        ...testCase.undeclared,
        ...testCase.badEnum,
      ]
      expect(refusals.length, testCase.wire).toBeGreaterThanOrEqual(3)

      const hostAccepted = hostParse.parse(testCase.valid)
      expect(hostAccepted, testCase.wire).toEqual(testCase.valid)
      expect(clientParse.parse(testCase.valid), testCase.wire).toEqual(hostAccepted)

      const groups: readonly (readonly [string, readonly unknown[]])[] = [
        ['incomplete', testCase.incomplete],
        ['malformed', testCase.malformed],
        ['undeclared', testCase.undeclared],
        ['bad-enum', testCase.badEnum],
      ]
      for (const [group, samples] of groups) {
        for (const sample of samples) {
          expect(() => hostParse.parse(sample), `${testCase.wire} ${group}`).toThrow()
          expect(() => clientParse.parse(sample), `${testCase.wire} ${group}`).toThrow()
        }
      }
    })
  }
})
