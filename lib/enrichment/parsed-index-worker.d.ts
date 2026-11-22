export interface IndexedDocument {
    readonly artifactId: string;
    readonly sourceId: string;
    readonly generation: string;
    readonly digest: string;
}
export interface IndexedPassage {
    readonly artifactId: string;
    readonly generation: string;
    readonly start: number;
    readonly end: number;
    readonly heading: string;
}
export type IndexOperation = {
    kind: 'known';
    partition: string;
} | {
    kind: 'inspect';
    partition: string;
} | {
    kind: 'rebuild-start';
    path: string;
} | {
    kind: 'rebuild-drop';
} | {
    kind: 'rebuild-stage';
    document: IndexedDocument;
    markdown: string;
} | {
    kind: 'rebuild-commit';
    partition: string;
    cancelled: Int32Array;
} | {
    kind: 'put';
    partition: string;
    document: IndexedDocument;
    markdown: string;
} | {
    kind: 'prune';
    partition: string;
    stale: readonly IndexedDocument[];
} | {
    kind: 'discard';
    root: string;
    artifactId: string;
} | {
    kind: 'match';
    partition: string;
    allowed: readonly IndexedDocument[];
    variants: readonly (readonly string[])[];
    limit: number;
    isolate: boolean;
};
export declare function openParsedIndex(path: string): {
    execute: (operation: IndexOperation) => unknown;
    [Symbol.dispose]: () => void;
};
//# sourceMappingURL=parsed-index-worker.d.ts.map