/**
 * The smallest real credentials seam: an in-memory record map, so specs observe
 * exactly what the plugin persists and deletes. Real, not a stub of the
 * interface: the plugin's write path calls `readRecord`, `modifyRecord`, and
 * `deleteRecord` for real, and a fake that answered differently would let a
 * grant bug pass.
 *
 * Both the authorizer's own specs and the host endpoint specs need the seam, so
 * it lives here instead of being copied into each lane.
 * @module tests/helpers/credential-seam
 */

import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import { WRITE_APP_NAME } from '../../src/write-auth.js'

/** An in-memory credentials provider; `records` is what the plugin left behind. */
export class MemoryCredentials extends CredentialProvider {
  readonly records = new Map<string, CredentialRecord>()
  readonly deletions: string[] = []

  constructor(ctx: Context) {
    super(ctx)
  }

  async resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return undefined
  }

  async describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return { configured: false, writable: true }
  }

  async set(_ref: CredentialRef, _value: string): Promise<void> {}

  async unset(_ref: CredentialRef): Promise<void> {}

  async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return this.records.get(String(key))
  }

  async describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return { configured: false, writable: true }
  }

  async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return []
  }

  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const next = await mutate(this.records.get(String(key)))
    if (next === undefined) return this.records.get(String(key))
    this.records.set(String(key), next)
    return next
  }

  async deleteRecord(key: CredentialKey): Promise<void> {
    this.deletions.push(String(key))
    this.records.delete(String(key))
  }
}

/** One persisted Always-Allow grant record as the plugin stores it. */
export function writeGrantRecord(key: string, serverId: string): CredentialRecord {
  return {
    kind: 'grant',
    payload: { key, serverId, appName: WRITE_APP_NAME, authorizedAt: '2026-09-13T00:00:00.000Z' },
  }
}
