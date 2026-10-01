/**
 * Host-only strict boundary codec for `zotero/status`.
 *
 * Typert host registration (`ctx.typert.register`) materializes schemas
 * through `create()` (upstream `perf(typert): materialize generated schemas
 * on first use`). Structural endpoint identity comes from `./contract.js`.
 * @module dsh-zotero/status-codec
 */
import { z } from 'zod';
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol';
import { type ZoteroStatusView } from './contract.js';
/** Wire codec: one status view (strict; absent optional facts stay absent). */
export declare const zoteroStatusSchema: z.ZodReadonly<z.ZodObject<{
    providerId: z.ZodString;
    endpoint: z.ZodOptional<z.ZodString>;
    connected: z.ZodBoolean;
    apiVersion: z.ZodOptional<z.ZodString>;
    serverId: z.ZodOptional<z.ZodString>;
    schemaVersion: z.ZodOptional<z.ZodString>;
    zoteroVersion: z.ZodOptional<z.ZodString>;
    write: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodBoolean;
        authorized: z.ZodBoolean;
    }, z.core.$strict>>;
    diagnosis: z.ZodString;
}, z.core.$strict>>;
/**
 * Strict status codec. The `TypertCodec` strict arm is exactly
 * `{ mode, typeSymbol, create }` (plus optional `encode`/`decode` for
 * byte-carrying results, which this pure-JSON view does not need) — no live
 * `schema` property is carried.
 */
export declare const zoteroStatusCodec: {
    readonly mode: "strict";
    readonly typeSymbol: "dsh-zotero#ZoteroStatusView";
    readonly create: () => z.ZodType<ZoteroStatusView>;
};
/** Host Typert manifest invocations (real zod factory). */
export declare const ZOTERO_INVOCATIONS: readonly InvocationDescriptor[];
//# sourceMappingURL=status-codec.d.ts.map