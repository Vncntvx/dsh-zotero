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
import type { FiberState } from '@deepseek-ai/cordis';
export declare const FIBER_STATE: {
    readonly PENDING: FiberState.PENDING;
    readonly LOADING: FiberState.LOADING;
    readonly ACTIVE: FiberState.ACTIVE;
    readonly FAILED: FiberState.FAILED;
    readonly DISPOSED: FiberState.DISPOSED;
    readonly UNLOADING: FiberState.UNLOADING;
};
/** Exhaustiveness guard: a moved or added `FiberState` member breaks the typecheck. */
export declare const FIBER_STATE_COVERAGE: {
    readonly 0: true;
    readonly 1: true;
    readonly 2: true;
    readonly 3: true;
    readonly 4: true;
    readonly 5: true;
};
//# sourceMappingURL=fiber-state.d.ts.map