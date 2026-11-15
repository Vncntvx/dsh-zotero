/**
 * Vendored semantic runtime assets: generated under
 * `assets/onnxruntime/<version>/` from the pinned `onnxruntime-web` dev
 * dependency, then loaded by `src/enrichment/semantic/runtime.ts`.
 * @module scripts/vendor-onnxruntime
 */

/** The provenance record a packaged runtime directory carries. */
export declare const PROVENANCE_FILE: string

/** Absolute `assets/onnxruntime` directory. */
export declare function assetsRoot(): string

/** The exact `onnxruntime-web` version `package.json` pins. */
export declare function pinnedVersion(): string

/** Packaged runtime file names, sorted. */
export declare function runtimeFileNames(): string[]

/** Package-relative paths `verify:pack` must find in the tarball. */
export declare function packedRuntimePaths(version?: string): string[]

/** Copy the pinned runtime into the package assets, dropping other versions. */
export declare function vendorRuntime(): Promise<{
  version: string
  dir: string
  files: Record<string, { bytes: number; sha256: string }>
}>

/** Prove the packaged files match their provenance and ship a license. */
export declare function checkVendoredRuntime(): string
