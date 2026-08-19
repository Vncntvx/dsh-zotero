/**
 * In-memory `SettingsScope` stand-in for client tests: mirrors the Host wire
 * semantics the form relies on — a resolved value layer, a composition base,
 * and a raw user layer whose field PRESENCE marks overrides — and records
 * every write the form performs.
 * @module tests/client/helpers/fake-scope
 */

import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** One write the fake scope performed. */
interface FakeWrite {
  /** 'set' or 'unset'. */
  op: 'set' | 'unset'
  /** Field the write addressed. */
  field: string
  /** Value a 'set' write stored. */
  value?: unknown
}

/** Options for {@link fakeScope}. */
export interface FakeScopeOptions {
  /** Resolved value layer (schema defaults over the composition base). */
  value?: Record<string, unknown>
  /** Composition base layer. */
  base?: unknown
  /** Raw user layer; field presence marks overrides. */
  user?: Record<string, unknown>
  /** Whether the Host document accepts writes; defaults to true. */
  writable?: boolean
  /** Namespace availability; defaults to 'ready'. */
  status?: 'ready' | 'unavailable' | 'loading'
  /** Whether `set` rejects; defaults to false. */
  rejectWrites?: boolean
}

/** The fake scope plus its write ledger. */
export type FakeScope = SettingsScope<Record<string, unknown>> & {
  /** Every write performed, in order. */
  writes: FakeWrite[]
}

/**
 * Build a scripted scope.
 * @param options - the initial snapshot layers and failure switch.
 * @returns the scope and its write ledger.
 */
export function fakeScope(options: FakeScopeOptions = {}): FakeScope {
  let snapshot: SettingsScopeSnapshot<Record<string, unknown>> = {
    status: options.status ?? 'ready',
    value: options.value,
    base: options.base,
    user: options.user,
    revision: 1,
    writable: options.writable ?? true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  const writes: FakeWrite[] = []
  const publish = (): void => {
    for (const listener of listeners) listener()
  }
  const applyWrite = (op: 'set' | 'unset', field: string, value?: unknown): void => {
    const user = { ...(snapshot.user as Record<string, unknown> | undefined) }
    const resolved = { ...(snapshot.value as Record<string, unknown> | undefined) }
    if (op === 'set') {
      user[field] = value
      resolved[field] = value
    } else {
      delete user[field]
      delete resolved[field]
    }
    snapshot = { ...snapshot, user, value: resolved }
  }
  return {
    writes,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: async (field, value) => {
      // The real client scope never rejects: a refused Host write resolves
      // without landing, leaving the section unchanged — which is what makes
      // the form's read-back report failure.
      if (options.rejectWrites === true) return
      writes.push({ op: 'set', field, value })
      applyWrite('set', field, value)
      publish()
    },
    unset: async (field) => {
      if (options.rejectWrites === true) return
      writes.push({ op: 'unset', field })
      applyWrite('unset', field)
      publish()
    },
  }
}
