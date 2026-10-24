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
    diagnosis: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
/** Host Typert manifest invocations (real zod factory). */
export declare const ZOTERO_INVOCATIONS: readonly InvocationDescriptor[];
//# sourceMappingURL=status-codec.d.ts.map