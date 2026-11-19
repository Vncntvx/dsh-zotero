export const FIBER_STATE = {
    PENDING: 0,
    LOADING: 1,
    ACTIVE: 2,
    FAILED: 3,
    DISPOSED: 4,
    UNLOADING: 5,
};
/** Exhaustiveness guard: a moved or added `FiberState` member breaks the typecheck. */
export const FIBER_STATE_COVERAGE = {
    [FIBER_STATE.PENDING]: true,
    [FIBER_STATE.LOADING]: true,
    [FIBER_STATE.ACTIVE]: true,
    [FIBER_STATE.FAILED]: true,
    [FIBER_STATE.DISPOSED]: true,
    [FIBER_STATE.UNLOADING]: true,
};
//# sourceMappingURL=fiber-state.js.map