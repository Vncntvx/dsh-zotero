export declare const HARNESS_PIN_DOCS: readonly string[]
export declare function withHarnessDocPin(path: string, text: string, pin: string): string
export declare function harnessDocPinProblems(path: string, text: string, pin: string): string[]

/** Manual evidence reviews are never rewritten by the pin writer. */
export declare const HARNESS_REVIEW_DOCS: readonly string[]
export declare function harnessReviewProblems(path: string, text: string, pin: string): string[]
