export declare class WriteAuthorizationBudget {
    private readonly now;
    private readonly pause;
    private timestamps;
    constructor(now?: () => number, pause?: (milliseconds: number, signal?: AbortSignal) => Promise<void>);
    reserve(signal?: AbortSignal): Promise<void>;
}
//# sourceMappingURL=write-authorization-budget.d.ts.map