export declare class PdfReadingFiles {
    private readonly files;
    private readonly pending;
    private disposed;
    private cleanup?;
    /** Only this plugin's private directories belonging to exited processes are reclaimed. */
    private removeAbandoned;
    stage(data: Uint8Array, signal: AbortSignal): Promise<{
        path: string;
        lease: string;
    }>;
    private create;
    release(lease: string): Promise<void>;
    dispose(): Promise<void>;
}
//# sourceMappingURL=pdf-files.d.ts.map