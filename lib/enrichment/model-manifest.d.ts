/**
 * The catalog manifest rule that install, readiness, and load all share.
 *
 * Three modules used to carry their own copy of these constants and their own
 * validation loop, and they had already drifted: the installer refused a
 * catalog record with no pinned files, the inspector accepted it, and the
 * error types differed. A record that one path installs and another path calls
 * ready is a bundle nobody can reason about, so the rule lives here and each
 * caller only maps the message onto its own error class.
 *
 * This module imports types only, so Node's native TypeScript stripping can
 * load it from the CLI scripts without pulling in the ONNX runtime.
 * @module dsh-zotero/enrichment/model-manifest
 */
import type { SemanticModelManifest } from '../enrichment-model-catalog.js';
export declare const MANIFEST_PATH = "manifest.json";
export declare const MANIFEST_MAX_BYTES: number;
export declare const READ_CHUNK_BYTES: number;
export declare const SAFE_SEGMENT: RegExp;
export declare const SHA256: RegExp;
/** One pinned file of a bundle, as the catalog declares it. */
export interface CatalogFilePin {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
}
/**
 * The catalog-relative path rule: no absolute prefix, no empty, `.`, `..`,
 * colon-bearing segment, backslash or NUL. The backslash and NUL checks are
 * what keep a Windows-style traversal out of `join(dir, path)` even though the
 * catalog itself is trusted code. Callers keep their own error class and
 * message; only the rule lives here.
 * @param value - the declared path.
 * @returns the refusal reason, or undefined when the path is safe.
 */
export declare function unsafeRelativePathReason(value: string): string | undefined;
/**
 * Validate one catalog-relative path.
 * @param value - the declared path.
 * @param refuse - the caller's error mapping.
 * @returns the path unchanged when it is safe.
 */
export declare function safeRelativePath(value: string, refuse: (reason: string) => never): string;
/** The catalog record's fingerprint: every field a verification depends on. */
export declare function catalogFingerprintOf(expected: SemanticModelManifest): string;
/**
 * Validate one catalog record's pinned files.
 *
 * Every check that install, inspect and load must agree on lives here: the
 * schema version, the physical key shape, path safety, the reserved marker
 * name, duplicate paths, the byte and digest shapes, and a record that pins at
 * least one file.
 * @param expected - the catalog record.
 * @param refuse - the caller's error mapping (each caller keeps its own class).
 * @returns the pins by their validated relative path.
 */
export declare function catalogFilePinsOf(expected: SemanticModelManifest, refuse: (reason: string) => never): Map<string, CatalogFilePin>;
//# sourceMappingURL=model-manifest.d.ts.map