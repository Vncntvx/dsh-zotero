/**
 * Tool-call diagnostics: a debug digest when a `zotero_` call enters dispatch,
 * and one outcome line when the harness publishes the result.
 *
 * `tools/result` is the authoritative, frozen outcome, and it also fires for
 * calls the pipeline refused before dispatch (a `tools/pre-execute` denial, a
 * guard, a cancellation). Those report their outcome without `ms`; `ms`
 * therefore spans dispatch entry to result publication, including post-execute
 * and finalization. A retrying wrapper above this listener re-stamps the start,
 * so `ms` covers the last attempt.
 * @module dsh-zotero/tool-diagnostics
 */
import type { Context } from '@deepseek-ai/cordis';
import { DiagnosticsRecorder } from './diagnostics.js';
export declare function installToolDiagnostics(ctx: Context, diagnostics: DiagnosticsRecorder): void;
//# sourceMappingURL=tool-diagnostics.d.ts.map