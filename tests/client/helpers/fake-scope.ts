/**
 * In-memory `ConfigForm` stand-in for client tests: mirrors the shared-form
 * semantics the card relies on — a resolved value layer, a composition base,
 * and a raw user layer whose field PRESENCE marks overrides, plus an atomic
 * revision-fenced `mutate` — and records every write the form performs.
 * @module tests/client/helpers/fake-scope
 */

import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'

/** One write the fake form performed. */
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
  /** Whether writes are refused; defaults to false. */
  rejectWrites?: boolean
}

/** The fake form plus its write ledger. */
export type FakeScope = ConfigForm<Record<string, unknown>> & {
  /** Every write performed, in order. */
  writes: FakeWrite[]
  /** How many subscriptions have been released. */
  unsubscribes: number
}

/**
 * Build a scripted form.
 * @param options - the initial snapshot layers and failure switch.
 * @returns the form and its write ledger.
 */
export function fakeScope(options: FakeScopeOptions = {}): FakeScope {
  let snapshot: ConfigFormSnapshot<Record<string, unknown>> = {
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
  const scope: FakeScope = {
    writes,
    unsubscribes: 0,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        scope.unsubscribes += 1
      }
    },
    set: async (field, value) => {
      // A refused Host write resolves without landing, leaving the section
      // unchanged — which is what makes the model's save report failure.
      if (options.rejectWrites === true) return false
      writes.push({ op: 'set', field, value })
      applyWrite('set', field, value)
      publish()
      return true
    },
    unset: async (field) => {
      if (options.rejectWrites === true) return false
      writes.push({ op: 'unset', field })
      applyWrite('unset', field)
      publish()
      return true
    },
    mutate: async (ops: readonly SettingsPathOpView[]) => {
      if (options.rejectWrites === true) return false
      for (const op of ops) {
        if (op.op === 'set') {
          writes.push({ op: 'set', field: op.path[0]!, value: op.value })
          applyWrite('set', op.path[0]!, op.value)
        } else {
          writes.push({ op: 'unset', field: op.path[0]! })
          applyWrite('unset', op.path[0]!)
        }
      }
      publish()
      return true
    },
  }
  return scope
}
