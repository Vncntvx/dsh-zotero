/**
 * Runtime mirror of Cordis's `FiberState` const enum, shared by host services.
 *
 * Cordis compiles `FiberState` as a `const enum`, so no runtime object exists to
 * import across packages. The values are anchored to the enum members instead
 * of spelled as bare numbers (`1 as FiberState.LOADING`), the same mirror
 * `packages/host/plugin-inventory/src/index.ts` keeps: a member that moves or
 * disappears then fails the typecheck rather than silently shifting the state
 * callers compare against.
 * @module dsh-zotero/fiber-state
 */
import type { FiberState } from '@deepseek-ai/cordis'

export const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Exhaustiveness guard: a moved or added `FiberState` member breaks the typecheck. */
export const FIBER_STATE_COVERAGE = {
  [FIBER_STATE.PENDING]: true,
  [FIBER_STATE.LOADING]: true,
  [FIBER_STATE.ACTIVE]: true,
  [FIBER_STATE.FAILED]: true,
  [FIBER_STATE.DISPOSED]: true,
  [FIBER_STATE.UNLOADING]: true,
} as const satisfies Record<FiberState, true>
