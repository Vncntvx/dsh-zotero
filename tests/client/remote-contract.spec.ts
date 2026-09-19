/**
 * Client Remote contribution must stay free of host-only zod codecs while
 * remaining structurally identical to the host Typert manifest.
 * @module tests/client/remote-contract
 */

import { describe, expect, it } from 'vitest'
import { ZOTERO_REMOTE } from '../../src/client/remote.ts'
import {
  HOST_OWNED_CODEC_MESSAGE,
  ZOTERO_STATUS_CLIENT_RESULT_CODEC,
} from '../../src/client/status-codec.ts'
import {
  ZOTERO_REMOTE_PACKAGE,
  ZOTERO_STATUS_INVOCATION_ID,
  ZOTERO_STATUS_INVOCATION_KIND,
  ZOTERO_STATUS_METHOD,
  ZOTERO_STATUS_SERVICE_KEY,
  ZOTERO_STATUS_TYPE_SYMBOL,
  ZOTERO_STATUS_ENDPOINT,
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

  it('materializes host codecs and refuses client materialization', () => {
    const host = TYPERT_MANIFEST.invocations.find((entry) => entry.method === 'status')
    const client = ZOTERO_REMOTE.descriptors.find((entry) => entry.method === 'status')
    const hostCreate = (host!.result as { create: () => unknown }).create
    const clientCreate = (client!.result as { create: () => unknown }).create
    expect(typeof hostCreate).toBe('function')
    expect(hostCreate()).toBeDefined()
    expect(client!.result).toBe(ZOTERO_STATUS_CLIENT_RESULT_CODEC)
    expect(() => clientCreate()).toThrow(HOST_OWNED_CODEC_MESSAGE)
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
