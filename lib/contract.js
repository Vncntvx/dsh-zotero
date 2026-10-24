/**
 * The zotero wire contract's shared structural surface: types, wire identity,
 * and the invocation factory both halves use. This module is dependency-free
 * so the browser bundle can inline it without dragging host-only schema
 * materialization (zod) into the client graph.
 *
 * Boundary codecs are **not** defined here. Host registration materializes
 * strict zod schemas in `src/status-codec.ts`; the client Remote face
 * materializes the structurally identical schemas in
 * `src/client/status-codec.ts`, in the `{ mode, typeSymbol, create }` shape the
 * typert generator emits, so `zod` stays a platform module the shell serves.
 *
 * The two arms do not validate alike. Client Gateway decodes a unary result
 * only through `descriptor.result.decode`, which the generator emits solely for
 * byte-carrying boundaries; a pure-JSON result therefore reaches the browser as
 * `RemoteResult.value` unvalidated and the client factory is never called
 * there. Strict validation of JSON inputs is the host gateway's own `decode`
 * step, not this module's.
 *
 * The Remote namespace carries the one fact the settings plane does not: live
 * connectivity of the configured Zotero provider. Configuration rides the
 * shared configuration form (`ctx.configForms`), not this channel.
 * @module dsh-zotero/contract
 */
import { ZOTERO_SETTINGS_NAMESPACE } from './settings-namespace.js';
/** Wire namespace both halves spell; re-exported so contract is one import site. */
export { ZOTERO_SETTINGS_NAMESPACE };
/** Package identity every Typert contribution from this plugin claims. */
export const ZOTERO_REMOTE_PACKAGE = 'dsh-zotero';
/**
 * Success sentinel the host status probe writes into its total `diagnosis`
 * field (`src/local/provider.ts`). The wire view strips it — a connected probe
 * has nothing to diagnose — so this constant is the single spelling both the
 * writer and the stripper compare against.
 */
export const ZOTERO_DIAGNOSIS_OK = 'ok';
/** Strict codec type symbol for {@link ZoteroStatusView}; host and client must agree. */
export const ZOTERO_STATUS_TYPE_SYMBOL = 'dsh-zotero#ZoteroStatusView';
/** Strict codec type symbol for the string ref parameter. */
export const ZOTERO_REF_PARAM_TYPE_SYMBOL = 'dsh-zotero#AttachmentRef';
/** Strict codec type symbol for {@link ZoteroAttachmentLocationView}. */
export const ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL = 'dsh-zotero#ZoteroAttachmentLocationView';
/** Strict codec type symbol for {@link ZoteroDiagnosticsView}. */
export const ZOTERO_DIAGNOSTICS_TYPE_SYMBOL = 'dsh-zotero#ZoteroDiagnosticsView';
/** Strict codec type symbol for {@link ZoteroClientErrorReport}. */
export const ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL = 'dsh-zotero#ZoteroClientErrorReport';
/** Strict codec type symbol for {@link ZoteroReportResultView}. */
export const ZOTERO_REPORT_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroReportResultView';
/** Globally stable invocation id for the status probe. */
export const ZOTERO_STATUS_INVOCATION_ID = 'dsh-zotero#zotero/status';
/** Globally stable invocation id for resolveAttachment. */
const ZOTERO_RESOLVE_ATTACHMENT_INVOCATION_ID = 'dsh-zotero#zotero/resolveAttachment';
/** Globally stable invocation id for the diagnostics snapshot. */
const ZOTERO_DIAGNOSTICS_INVOCATION_ID = 'dsh-zotero#zotero/diagnostics';
/** Globally stable invocation id for the client error report. */
const ZOTERO_REPORT_CLIENT_ERROR_INVOCATION_ID = 'dsh-zotero#zotero/reportClientError';
/**
 * Cordis service key that owns the status method on the host half.
 * The host Remote service (`src/remote.ts`) and the Typert model must both
 * spell this key from here, never as a second literal.
 */
export const ZOTERO_STATUS_SERVICE_KEY = 'zoteroRemote';
/** Wire method name for the status probe. */
export const ZOTERO_STATUS_METHOD = 'status';
/** Wire method name for resolveAttachment. */
export const ZOTERO_RESOLVE_ATTACHMENT_METHOD = 'resolveAttachment';
/** Wire method name for the diagnostics snapshot. */
export const ZOTERO_DIAGNOSTICS_METHOD = 'diagnostics';
/** Wire method name for the client error report. */
export const ZOTERO_REPORT_CLIENT_ERROR_METHOD = 'reportClientError';
/** Invocation kind for direct service calls (no Context receiver). */
export const ZOTERO_STATUS_INVOCATION_KIND = 'direct';
/**
 * Build one status invocation descriptor around a result codec. Host and
 * client both call this so endpoint identity cannot drift; only the codec arm
 * differs by side. Every structural field is copied, so a caller never shares
 * a mutable reference with the descriptor it built.
 * @param result - the strict result codec for {@link ZoteroStatusView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroStatusInvocation(result) {
    return {
        id: ZOTERO_STATUS_INVOCATION_ID,
        service: ZOTERO_STATUS_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_STATUS_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [],
        result,
    };
}
/**
 * Build one resolveAttachment invocation descriptor around parameter and result codecs.
 * @param param - the strict parameter codec for the ref string.
 * @param result - the strict result codec for {@link ZoteroAttachmentLocationView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroResolveAttachmentInvocation(param, result) {
    return {
        id: ZOTERO_RESOLVE_ATTACHMENT_INVOCATION_ID,
        service: ZOTERO_STATUS_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_RESOLVE_ATTACHMENT_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [
            {
                name: 'ref',
                wire: 'ref',
                source: 'json',
                codec: param,
            },
        ],
        result,
    };
}
/**
 * Build one diagnostics invocation descriptor around a result codec. Zero
 * parameters, like the status probe: the endpoint serves its own capped
 * newest-first slice and the `debug` fact.
 * @param result - the strict result codec for {@link ZoteroDiagnosticsView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroDiagnosticsInvocation(result) {
    return {
        id: ZOTERO_DIAGNOSTICS_INVOCATION_ID,
        service: ZOTERO_STATUS_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_DIAGNOSTICS_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [],
        result,
    };
}
/**
 * Build one reportClientError invocation descriptor around parameter and result codecs.
 * @param param - the strict parameter codec for {@link ZoteroClientErrorReport}.
 * @param result - the strict result codec for {@link ZoteroReportResultView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroReportClientErrorInvocation(param, result) {
    return {
        id: ZOTERO_REPORT_CLIENT_ERROR_INVOCATION_ID,
        service: ZOTERO_STATUS_SERVICE_KEY,
        namespace: ZOTERO_SETTINGS_NAMESPACE,
        method: ZOTERO_REPORT_CLIENT_ERROR_METHOD,
        invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
        cancellation: { parameter: 'signal' },
        parameters: [
            {
                name: 'report',
                wire: 'report',
                source: 'json',
                codec: param,
            },
        ],
        result,
    };
}
/*
 * The `/zotero` status strings live in `src/command.ts` with the formatter that
 * emits them. The card reads the `zoteroStatus` projection, so these strings
 * are human-facing output only and do not cross the boundary.
 */
//# sourceMappingURL=contract.js.map