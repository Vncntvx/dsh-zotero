/**
 * Host-only strict boundary codecs for the `zotero` wire namespace.
 *
 * Typert host registration (`ctx.typert.register`) materializes schemas
 * through `create()` (upstream `perf(typert): materialize generated schemas
 * on first use`). Structural endpoint identity comes from `./contract.js`;
 * the strict schemas are the shared definitions in `./wire-schemas.js`, the
 * same objects the client arm carries.
 * @module dsh-zotero/status-codec
 */
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol';
/** Host Typert manifest invocations (real zod factory). */
export declare const ZOTERO_INVOCATIONS: readonly InvocationDescriptor[];
//# sourceMappingURL=status-codec.d.ts.map