/** Deployment limits for complete parsed-document preparation. */
export interface ArtifactReaderPreferences {
    readonly maxOpen: number;
    readonly maxBytes: number;
    readonly preparedMaxBytes: number;
    readonly idleTimeoutMs: number;
    readonly maxLifetimeMs: number;
    readonly concurrency: number;
    readonly archiveConcurrency: number;
    readonly archiveQueueLimit: number;
}
export declare const ARTIFACT_READER_DEFAULTS: ArtifactReaderPreferences;
export declare function artifactReaderPreferencesOf(value: unknown): ArtifactReaderPreferences;
//# sourceMappingURL=artifact-reader-preferences.d.ts.map