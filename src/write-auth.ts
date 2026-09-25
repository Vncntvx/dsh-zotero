/**
 * The write-authorization state of the plugin. Zotero 10 issues local write
 * keys through its own `/api/local/authorize` dialog — Allow (one write),
 * Always Allow (persistent), Deny — and consumes single-use keys at
 * authentication time, before the write runs. This module owns what that
 * implies for the plugin:
 *
 * - the persisted grant lives in the host credentials seam as a `grant`
 *   record bound to the Zotero instance id it was granted by; a record that
 *   names another instance is stale and is tombstoned, never used;
 * - a one-time key lives only in this process's memory and is forgotten as
 *   soon as the write it authorized settles — the server has consumed it
 *   either way;
 * - concurrent callers share one in-flight authorization. The dialog is the
 *   scarcest resource in the loop, and Zotero rate-limits the endpoint at
 *   five requests per minute.
 *
 * There is no key material in the plugin config and no key caching past the
 * semantics above: the credentials seam is re-read per operation by its own
 * discipline, and the memory slot only bridges the one-write lifetime of a
 * single-use grant. A rejected persisted key is tombstoned by identity; a
 * persistence failure propagates and leaves the grant pending for retry.
 *
 * Verified against Zotero 10.0.3-beta.3 (`server_localAPI.js`): the dialog's
 * three buttons are Allow (`remember: false`), Always Allow
 * (`remember: true`), and Deny, with Deny as the default button, and the
 * endpoint is rate-limited to five prompts per minute. A single-use key is
 * deleted inside the authentication check itself, before the request body is
 * judged, so a refused write still burns it. A remembered key is never
 * consumed: it lives in `<Zotero profile>/localAPIKeys.json` and authenticates
 * indefinitely until the user discards the stored authorizations — which is
 * why a persisted grant is treated here as a durable secret, and why the
 * plugin never handles a raw key itself.
 * @module dsh-zotero/write-auth
 */

import {
  credentialKey,
  type CredentialProvider,
  type CredentialRecord,
} from '@deepseek-ai/dsh-credentials'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { TOOL_ABORTED_MESSAGE } from './errors.js'
import { asRecord, asString } from './json.js'
import { awaitSharedOperation, type SharedOperation } from './concurrency.js'
import { ZoteroWriteHttpClient } from './write-http.js'

/**
 * The name Zotero's authorization dialog shows the user for this plugin.
 * A stable, recognizable name: the user decides on it, not on a request.
 */
export const WRITE_APP_NAME = 'dsh (Zotero plugin)'

/**
 * The credentials record that carries this plugin's persistent write grant,
 * keyed under the plugin's own registered scope.
 */
export const WRITE_KEY_RECORD = credentialKey('dsh-zotero', 'local-write-key')

/** The grant payload this plugin stores; opaque to the credentials seam. */
export interface ZoteroWriteGrantPayload {
  /** The local API key Zotero issued. */
  readonly key: string
  /** The Zotero instance id the dialog that granted the key was served by. */
  readonly serverId: string
  /** The app name shown in the granting dialog, kept for the audit trail. */
  readonly appName: string
  /** When the dialog granted the key (ISO 8601). */
  readonly authorizedAt: string
}

export interface WriteAuthorizerDeps {
  /** The write transport; the authorize call rides it. */
  readonly client: ZoteroWriteHttpClient
  /** The host credentials seam; absent compositions keep grants in memory only. */
  readonly credentials?: CredentialProvider | (() => CredentialProvider | undefined)
  /**
   * Live read of the persist-grant setting. A live read, not a captured
   * boolean: a settings commit applies to the next authorization without a
   * rebuild.
   */
  readonly persistKey: () => boolean
}

/** One key for one write lifecycle: usable now, and either reusable or spent. */
export interface ZoteroWriteKey {
  readonly key: string
  /** True when Zotero will consume the key at authentication time. */
  readonly oneTime: boolean
}

export interface ParsedGrant {
  readonly key: string
  readonly boundTo: string
  readonly appName?: string
  readonly authorizedAt?: string
}

/** A persisted grant narrowed to the fields the authorizer routes on. */
function parseGrantRecord(record: unknown): ParsedGrant | undefined {
  if (asRecord(record)?.kind !== 'grant') return undefined
  const payload = asRecord(asRecord(record)?.payload)
  const key = payload === undefined ? undefined : asString(payload.key)
  const boundTo = payload === undefined ? undefined : asString(payload.serverId)
  if (key === undefined || key === '' || boundTo === undefined) return undefined
  const appName = payload === undefined ? undefined : asString(payload.appName)
  const authorizedAt = payload === undefined ? undefined : asString(payload.authorizedAt)
  return {
    key,
    boundTo,
    ...(appName !== undefined ? { appName } : {}),
    ...(authorizedAt !== undefined ? { authorizedAt } : {}),
  }
}

async function tombstoneGrant(
  credentials: CredentialProvider,
  target: { readonly key: string; readonly boundTo: string },
): Promise<void> {
  await credentials.modifyRecord(WRITE_KEY_RECORD, async (current) => {
    const grant = parseGrantRecord(current)
    if (grant?.key !== target.key || grant.boundTo !== target.boundTo) return undefined
    const marker: CredentialRecord = {
      kind: 'grant',
      payload: {
        revoked: true,
        serverId: target.boundTo,
        revokedAt: new Date().toISOString(),
      },
    }
    return marker
  })
}

/** The in-process grant and any persistence still owed to the credentials seam. */
interface MemoryGrant {
  readonly key: string
  readonly serverId: string
  readonly oneTime: boolean
  /** The authorization time recorded in the persisted audit payload. */
  readonly authorizedAt: string
  /** True when an Always-Allow grant was obtained while persistence was eligible. */
  readonly persistPending: boolean
}

function grantIdentity(serverId: string, key: string): string {
  return `${serverId}\u0000${key}`
}

interface AuthorizationOperation extends SharedOperation<ZoteroWriteKey> {}

/**
 * Resolve and maintain the plugin's write authorization for the connected
 * Zotero instance. `keyFor` is the entry point the write domain calls before
 * every batch: it answers with the persisted grant while it is bound to the
 * connected instance, else with this process's own grant, else it runs the
 * authorize dialog and answers with what the user granted.
 */
export class WriteAuthorizer {
  private memory: MemoryGrant | undefined
  private readonly authorizing = new Map<string, AuthorizationOperation>()
  private readonly persisting = new Map<string, Promise<void>>()

  constructor(private readonly deps: WriteAuthorizerDeps) {}

  private getCredentials(): CredentialProvider | undefined {
    return typeof this.deps.credentials === 'function'
      ? this.deps.credentials()
      : this.deps.credentials
  }

  /**
   * The key to write with for this Zotero instance.
   * @param serverId - the instance id the plugin last read from; grants are
   *   bound to it, so a write follows the instance the reads saw.
   * @param signal - caller cancellation, forwarded to the authorize request.
   * @returns the key plus whether Zotero will consume it on first use.
   */
  async keyFor(serverId: string, signal?: AbortSignal): Promise<ZoteroWriteKey> {
    if (signal?.aborted) throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED)
    const stored = await this.storedKey(serverId)
    if (signal?.aborted) throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED)
    if (stored !== undefined) {
      if (this.memory?.serverId === serverId) this.memory = undefined
      return { key: stored, oneTime: false }
    }
    const memory = this.memory
    if (memory !== undefined && memory.serverId === serverId) {
      await this.persistPendingGrant(memory)
      if (signal?.aborted) throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED)
      return { key: memory.key, oneTime: memory.oneTime }
    }
    const operation = this.authorizationFor(serverId, signal)
    return await this.awaitAuthorization(operation, signal)
  }

  /** Start or reuse the single authorization operation for one server. */
  private authorizationFor(serverId: string, _signal?: AbortSignal): AuthorizationOperation {
    const existing = this.authorizing.get(serverId)
    if (existing !== undefined && !existing.controller.signal.aborted && !existing.settled) {
      return existing
    }
    if (existing !== undefined) this.authorizing.delete(serverId)
    const operation: AuthorizationOperation = {
      controller: new AbortController(),
      promise: Promise.resolve({
        key: '',
        oneTime: false,
      }),
      waiters: 0,
      settled: false,
    }
    operation.promise = this.authorize(serverId, operation.controller.signal).finally(() => {
      operation.settled = true
      if (this.authorizing.get(serverId) === operation) this.authorizing.delete(serverId)
    })
    // A sole cancelled waiter leaves nobody to consume the shared rejection.
    // Keep it observed without changing the promise returned to real waiters.
    void operation.promise.catch(() => undefined)
    this.authorizing.set(serverId, operation)
    return operation
  }

  /**
   * Await a shared authorization without letting one cancelled caller cancel
   * another live caller. The underlying request is aborted only after every
   * waiter has detached.
   */
  private async awaitAuthorization(
    operation: AuthorizationOperation,
    signal: AbortSignal | undefined,
  ): Promise<ZoteroWriteKey> {
    return await awaitSharedOperation(operation, signal)
  }

  /** Read and parse the current stored write grant without any side effects. */
  private async readStoredGrant(): Promise<ParsedGrant | undefined> {
    const credentials = this.getCredentials()
    if (credentials === undefined) return undefined
    const record = await credentials.readRecord(WRITE_KEY_RECORD)
    return parseGrantRecord(record)
  }

  /**
   * Whether a grant for this Zotero instance is already available — the
   * in-memory key of this process, or a persisted grant bound to the
   * instance. A status fact for the settings card and the command output;
   * never a capability: {@link keyFor} still runs the full resolution.
   */
  async hasGrant(serverId: string): Promise<boolean> {
    if (this.memory !== undefined && this.memory.serverId === serverId) return true
    const grant = await this.readStoredGrant()
    return grant !== undefined && grant.boundTo === serverId
  }

  /**
   * Forget this process's copy of a key. Called by the domain when the write
   * a one-time key authorized has settled — the server consumed the key at
   * authentication whether the write succeeded or failed, so the memory slot
   * must never answer with it again. Persisted grants are untouched.
   * @param key - the one-time key the domain is done with.
   */
  forget(key: string): void {
    if (this.memory?.key === key) {
      this.memory = undefined
    }
  }

  /**
   * Invalidate one exact grant after Zotero rejects it. The memory copy goes
   * immediately; the durable record is tombstoned through `modifyRecord`, so a
   * newer grant written by another process is never deleted.
   */
  async invalidate(serverId: string, key: string): Promise<void> {
    if (this.memory?.serverId === serverId && this.memory.key === key) {
      this.memory = undefined
    }
    const credentials = this.getCredentials()
    if (credentials === undefined) return
    await tombstoneGrant(credentials, { key, boundTo: serverId })
  }

  /**
   * The persisted grant for this instance, or undefined. The record is
   * re-read on every call (the credentials seam's own discipline: never
   * cache a secret across operations), and a grant bound to another Zotero
   * instance is tombstoned rather than used — the next authorization then
   * re-binds to the instance actually connected.
   */
  private async storedKey(serverId: string): Promise<string | undefined> {
    const credentials = this.getCredentials()
    if (credentials === undefined) return undefined
    const grant = await this.readStoredGrant()
    if (grant === undefined) return undefined
    if (grant.boundTo !== serverId) {
      await tombstoneGrant(credentials, grant)
      return undefined
    }
    return grant.key
  }

  /**
   * Persist one Always-Allow grant through the serialized credentials seam.
   * The memory grant remains pending after a failed write, so a later key
   * resolution retries it. When persistence is configured and the seam is
   * present, the current call fails closed rather than using a grant whose
   * Always-Allow promise could not be committed.
   */
  private async persistPendingGrant(grant: MemoryGrant | undefined = this.memory): Promise<void> {
    if (grant === undefined || !grant.persistPending || !this.deps.persistKey()) return
    const identity = grantIdentity(grant.serverId, grant.key)
    const existing = this.persisting.get(identity)
    if (existing !== undefined) {
      await existing
      return
    }
    const credentials = this.getCredentials()
    if (credentials === undefined) return

    const task = (async (): Promise<void> => {
      const current = this.memory
      if (
        current === undefined ||
        !current.persistPending ||
        current.serverId !== grant.serverId ||
        current.key !== grant.key ||
        !this.deps.persistKey()
      ) {
        return
      }
      const payload: ZoteroWriteGrantPayload = {
        key: current.key,
        serverId: current.serverId,
        appName: WRITE_APP_NAME,
        authorizedAt: current.authorizedAt,
      }
      const stored = await credentials.modifyRecord(WRITE_KEY_RECORD, async (record) => {
        const latest = this.memory
        if (
          latest?.key !== current.key ||
          latest.serverId !== current.serverId ||
          !latest.persistPending
        ) {
          return record
        }
        const previous = parseGrantRecord(record)
        if (previous?.key === payload.key && previous.boundTo === payload.serverId) return record
        if (previous?.authorizedAt !== undefined && previous.authorizedAt > payload.authorizedAt) {
          return record
        }
        const next: CredentialRecord = { kind: 'grant', payload }
        return next
      })
      const latest = this.memory
      if (
        latest?.key !== current.key ||
        latest.serverId !== current.serverId ||
        !latest.persistPending
      ) {
        return
      }
      const persisted = parseGrantRecord(stored)
      if (persisted?.boundTo === current.serverId) {
        this.memory = { ...current, persistPending: false }
      }
    })()
    this.persisting.set(identity, task)
    try {
      await task
    } finally {
      if (this.persisting.get(identity) === task) this.persisting.delete(identity)
    }
  }

  /**
   * Run the authorize dialog. A grant the user marked Always Allow is
   * persisted into the credentials seam — bound to this instance — when the
   * seam is composed and the setting allows it; every grant is also kept in
   * memory so the immediate next write does not re-open the dialog. If the
   * seam is absent, persistence remains pending for a later key resolution.
   */
  private async authorize(serverId: string, signal?: AbortSignal): Promise<ZoteroWriteKey> {
    const grant = await this.deps.client.authorize(WRITE_APP_NAME, { serverId, signal })
    if (signal?.aborted) throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED)
    const persistPending = grant.remember && this.deps.persistKey()
    this.memory = {
      key: grant.key,
      serverId,
      oneTime: !grant.remember,
      authorizedAt: new Date().toISOString(),
      persistPending,
    }
    if (persistPending) await this.persistPendingGrant()
    return { key: grant.key, oneTime: !grant.remember }
  }
}
