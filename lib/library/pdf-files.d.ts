export declare class PdfReadingFiles {
    private readonly root;
    private readonly ownerUid;
    private readonly files;
    private readonly pending;
    private disposed;
    private cleanup?;
    /**
     * @param root - the directory the reading files live in; the process temp
     * directory unless a test supplies its own, so an abandoned-directory reap
     * can be driven without inspecting the shared one.
     */
    constructor(root?: string, ownerUid?: () => number | undefined);
    /** Only this plugin's private directories belonging to exited processes are reclaimed. */
    private removeAbandoned;
    stage(data: Uint8Array, signal: AbortSignal): Promise<{
        path: string;
        lease: string;
    }>;
    private create;
    release(lease: string): Promise<boolean>;
    dispose(): Promise<void>;
}
//# sourceMappingURL=pdf-files.d.ts.map