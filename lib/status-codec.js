/**
 * Host-only strict boundary codec for `zotero/status`.
 *
 * Typert host registration (`ctx.typert.register`) materializes schemas
 * through `create()` (upstream `perf(typert): materialize generated schemas
 * on first use`). Structural endpoint identity comes from `./contract.js`.
 * @module dsh-zotero/status-codec
 */
import { z } from 'zod';
import { ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL, ZOTERO_DIAGNOSTICS_TYPE_SYMBOL, ZOTERO_REF_PARAM_TYPE_SYMBOL, ZOTERO_REPORT_RESULT_TYPE_SYMBOL, ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL, ZOTERO_STATUS_TYPE_SYMBOL, zoteroDiagnosticsInvocation, zoteroReportClientErrorInvocation, zoteroResolveAttachmentInvocation, zoteroStatusInvocation, } from './contract.js';
/** Wire codec: one status view (strict; absent optional facts stay absent). */
const zoteroStatusSchema = z
    .object({
    providerId: z.string(),
    // Optional on the wire because a service that is not composed dialled
    // nothing; required of every answer that reached a provider, which is what
    // `ZoteroStatus` (the provider's own record) carries.
    endpoint: z.string().optional(),
    connected: z.boolean(),
    apiVersion: z.string().optional(),
    serverId: z.string().optional(),
    schemaVersion: z.string().optional(),
    zoteroVersion: z.string().optional(),
    write: z.object({ enabled: z.boolean(), authorized: z.boolean() }).strict().optional(),
    // Optional on the wire because a connected probe has nothing to diagnose;
    // the host-internal `ZoteroStatus` keeps the total field with the
    // `ZOTERO_DIAGNOSIS_OK` sentinel, which the wire producer strips.
    diagnosis: z.string().optional(),
})
    .strict()
    .readonly();
/**
 * Strict status codec. The `TypertCodec` strict arm is exactly
 * `{ mode, typeSymbol, create }` (plus optional `encode`/`decode` for
 * byte-carrying results, which this pure-JSON view does not need), so no live
 * `schema` property is carried.
 */
const zoteroStatusCodec = {
    mode: 'strict',
    typeSymbol: ZOTERO_STATUS_TYPE_SYMBOL,
    create: () => zoteroStatusSchema,
};
/** Wire codec: resolveAttachment parameter (a non-empty string ref). */
const zoteroRefSchema = z.string().min(1);
export const zoteroRefParamCodec = {
    mode: 'strict',
    typeSymbol: ZOTERO_REF_PARAM_TYPE_SYMBOL,
    create: () => zoteroRefSchema,
};
/** Wire codec: resolveAttachment result. */
const zoteroAttachmentLocationSchema = z
    .object({
    ref: z.string(),
    kind: z.enum(['file', 'url']),
    title: z.string(),
    contentType: z.string(),
    path: z.string().optional(),
    url: z.string().optional(),
})
    .strict()
    .readonly();
export const zoteroAttachmentLocationCodec = {
    mode: 'strict',
    typeSymbol: ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL,
    create: () => zoteroAttachmentLocationSchema,
};
/** Wire codec: one diagnostics snapshot (strict; the ring pre-strips absent optionals). */
const zoteroDiagnosticsSchema = z
    .object({
    entries: z
        .array(z
        .object({
        seq: z.number(),
        ts: z.number(),
        level: z.enum(['debug', 'info', 'warn', 'error']),
        event: z.string(),
        message: z.string(),
        count: z.number(),
        detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    })
        .strict()
        .readonly())
        .readonly(),
    total: z.number(),
    truncated: z.boolean(),
    debug: z.boolean(),
})
    .strict()
    .readonly();
export const zoteroDiagnosticsCodec = {
    mode: 'strict',
    typeSymbol: ZOTERO_DIAGNOSTICS_TYPE_SYMBOL,
    create: () => zoteroDiagnosticsSchema,
};
/** Wire codec: reportClientError parameter (surface + message required, stacks optional). */
const zoteroClientErrorReportSchema = z
    .object({
    surface: z.string().min(1),
    message: z.string().min(1),
    stack: z.string().optional(),
    componentStack: z.string().optional(),
})
    .strict()
    .readonly();
export const zoteroClientErrorReportCodec = {
    mode: 'strict',
    typeSymbol: ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL,
    create: () => zoteroClientErrorReportSchema,
};
/** Wire codec: reportClientError result (the ring sequence the report was assigned). */
const zoteroReportResultSchema = z.object({ seq: z.number() }).strict().readonly();
export const zoteroReportResultCodec = {
    mode: 'strict',
    typeSymbol: ZOTERO_REPORT_RESULT_TYPE_SYMBOL,
    create: () => zoteroReportResultSchema,
};
/** Host Typert manifest invocations (real zod factory). */
export const ZOTERO_INVOCATIONS = [
    zoteroStatusInvocation(zoteroStatusCodec),
    zoteroResolveAttachmentInvocation(zoteroRefParamCodec, zoteroAttachmentLocationCodec),
    zoteroDiagnosticsInvocation(zoteroDiagnosticsCodec),
    zoteroReportClientErrorInvocation(zoteroClientErrorReportCodec, zoteroReportResultCodec),
];
//# sourceMappingURL=status-codec.js.map