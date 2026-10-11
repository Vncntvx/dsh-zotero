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
import { type ZoteroAttachmentLocationView, type ZoteroClientErrorReport, type ZoteroDiagnosticsView, type ZoteroReportResultView } from './contract.js';
export declare const zoteroRefParamCodec: {
    readonly mode: "strict";
    readonly typeSymbol: "dsh-zotero#AttachmentRef";
    readonly create: () => z.ZodType<string>;
};
export declare const zoteroAttachmentLocationCodec: {
    readonly mode: "strict";
    readonly typeSymbol: "dsh-zotero#ZoteroAttachmentLocationView";
    readonly create: () => z.ZodType<ZoteroAttachmentLocationView>;
};
export declare const zoteroDiagnosticsCodec: {
    readonly mode: "strict";
    readonly typeSymbol: "dsh-zotero#ZoteroDiagnosticsView";
    readonly create: () => z.ZodType<ZoteroDiagnosticsView>;
};
export declare const zoteroClientErrorReportCodec: {
    readonly mode: "strict";
    readonly typeSymbol: "dsh-zotero#ZoteroClientErrorReport";
    readonly create: () => z.ZodType<ZoteroClientErrorReport>;
};
export declare const zoteroReportResultCodec: {
    readonly mode: "strict";
    readonly typeSymbol: "dsh-zotero#ZoteroReportResultView";
    readonly create: () => z.ZodType<ZoteroReportResultView>;
};
/** Host Typert manifest invocations (real zod factory). */
export declare const ZOTERO_INVOCATIONS: readonly InvocationDescriptor[];
//# sourceMappingURL=status-codec.d.ts.map