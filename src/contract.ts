/**
 * The zotero wire contract, shared verbatim by the host manifest
 * (`ctx.typert.register` in typert.ts) and the client contribution
 * (`ctx.remote.$mount` in client/remote.ts).
 *
 * The Remote namespace is the browser settings page's data channel: the
 * harness exposes registered settings namespaces over its own settings RPC
 * only through an explicit product allowlist, so a third-party namespace
 * cannot ride that path. The Typert Gateway instead serves any declared
 * Remote endpoint (`/api/zotero/<method>`), which keeps the page fully
 * functional in an unmodified harness — the same channel dsh-at-file uses
 * for its picker. The host methods read and write the `zotero` settings
 * namespace through the local settings seam, so validation, revision
 * fencing, persistence, and live-apply all stay the harness's own.
 * @module dsh-zotero/contract
 */

import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

/**
 * The namespace as the settings page reads it: the resolved value over the
 * composition base and the raw user layer (whose field presence marks
 * overrides), plus the revision fencing the next write. `available` is false
 * while no settings service composes the namespace — a deployment without a
 * settings document gets a read-only page instead of a broken one.
 */
export interface ZoteroConfigView {
  /** Whether the `zotero` namespace is registered on the Host. */
  readonly available: boolean
  /** Whether the Host document accepts writes. */
  readonly writable: boolean
  /** Schema-resolved value over base and user layers. */
  readonly value?: Record<string, unknown>
  /** Composition layer the value resolves over, when one was declared. */
  readonly base?: Record<string, unknown>
  /** Raw user layer as stored, when one exists. */
  readonly user?: Record<string, unknown>
  /** Namespace revision fencing the next write; absent before the first view. */
  readonly revision?: number
}

/** Wire codec: one namespace view (strict, shared by every endpoint result). */
export const zoteroConfigViewSchema = z
  .object({
    available: z.boolean(),
    writable: z.boolean(),
    value: z.record(z.string(), z.unknown()).nullable().optional(),
    base: z.record(z.string(), z.unknown()).nullable().optional(),
    user: z.record(z.string(), z.unknown()).nullable().optional(),
    revision: z.number().int().nullable().optional(),
  })
  .readonly()

/** The zotero connectivity view the web tab renders (optional facts omitted when absent). */
export interface ZoteroStatusView {
  readonly providerId: string
  readonly connected: boolean
  readonly apiVersion?: string
  readonly serverId?: string
  readonly schemaVersion?: string
  readonly diagnosis: string
}

/** Wire codec: one status view (strict; absent optional facts stay absent). */
export const zoteroStatusSchema = z
  .object({
    providerId: z.string(),
    connected: z.boolean(),
    apiVersion: z.string().optional(),
    serverId: z.string().optional(),
    schemaVersion: z.string().optional(),
    diagnosis: z.string(),
  })
  .readonly()

/** Wire codec: one user-layer patch (a plain JSON object). */
export const zoteroPatchSchema = z.record(z.string(), z.unknown()).readonly()

/** Wire codec: one section field name. */
export const zoteroFieldSchema = z.string().min(1)

/** Wire codec: a namespace revision the caller read (absent means unchecked). */
export const zoteroRevisionSchema = z.number().int().optional()

/** The zotero Remote namespace's strict invocation descriptors. */
export const ZOTERO_INVOCATIONS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-zotero#zotero/status',
    service: 'zoteroRemote',
    namespace: 'zotero',
    method: 'status',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-zotero#ZoteroStatusView',
      schema: zoteroStatusSchema,
    },
  },
  {
    id: 'dsh-zotero#zotero/config',
    service: 'zoteroRemote',
    namespace: 'zotero',
    method: 'config',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-zotero#ZoteroConfigView',
      schema: zoteroConfigViewSchema,
    },
  },
  {
    id: 'dsh-zotero#zotero/configUpdate',
    service: 'zoteroRemote',
    namespace: 'zotero',
    method: 'configUpdate',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'patch',
        wire: 'patch',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-zotero#ZoteroConfigPatch',
          schema: zoteroPatchSchema,
        },
      },
      {
        name: 'revision',
        wire: 'revision',
        source: 'json',
        acceptsUndefined: true,
        codec: { mode: 'strict', typeSymbol: 'number', schema: zoteroRevisionSchema },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-zotero#ZoteroConfigView',
      schema: zoteroConfigViewSchema,
    },
  },
  {
    id: 'dsh-zotero#zotero/configClear',
    service: 'zoteroRemote',
    namespace: 'zotero',
    method: 'configClear',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'field',
        wire: 'field',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'string', schema: zoteroFieldSchema },
      },
      {
        name: 'revision',
        wire: 'revision',
        source: 'json',
        acceptsUndefined: true,
        codec: { mode: 'strict', typeSymbol: 'number', schema: zoteroRevisionSchema },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-zotero#ZoteroConfigView',
      schema: zoteroConfigViewSchema,
    },
  },
]
