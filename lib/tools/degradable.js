/**
 * The one degrade rule shared by the write tools' best-effort plan previews.
 *
 * A plan card reads the blast radius before the user is asked to approve it:
 * a delete's item and child-collection counts, a tag delete's item counts.
 * Those reads are advisory — the delete itself re-reads under a version
 * precondition — so a plan can still render with an `unknown` count instead of
 * refusing a call the domain would have settled correctly.
 *
 * "Best effort" does not mean "swallow everything". Two failures mean the
 * preview could not name a target, which is exactly the fact the plan renders
 * as unknown: the object does not exist, or the name is ambiguous. Every other
 * failure — a timeout, a transport error, a protocol shape change — is a real
 * fault the caller must see.
 *
 * A caller cancellation is neither. It must reach the harness as `TOOL_ABORTED`
 * rather than being folded into a plan card, so an aborted read re-raises the
 * harness's own cancellation error even when the underlying failure was
 * something else: a job-level signal that fired first must not turn a late
 * timeout into a domain error the harness reports as a tool failure, and a
 * cancellation must never leak out as a bare `ZoteroError`.
 * @module dsh-zotero/tools/degradable
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools';
import { ZOTERO_NOT_FOUND, ZOTERO_SCOPE_AMBIGUOUS, ZoteroError } from '../errors.js';
import { TOOL_ABORTED_MESSAGE } from '../abort.js';
/**
 * Whether a failed preview read may be degraded to an `unknown` plan entry.
 *
 * Deliberately closed: only a target that does not exist and a name that
 * matches several objects make the preview inconclusive without being a
 * fault. Everything else is rethrown by the caller.
 * @param error - the rejection from a preview read.
 * @returns true when the plan may render the count as unknown.
 */
function isPreviewDegradable(error) {
    return (error instanceof ZoteroError &&
        (error.code === ZOTERO_NOT_FOUND || error.code === ZOTERO_SCOPE_AMBIGUOUS));
}
/**
 * Decide what a failed preview read means, in the one place the rule lives.
 *
 * The order matters: an aborted call outranks the degrade rule, because a
 * caller who cancelled must see the harness's cancellation rather than a plan
 * card that pretends the count is merely unknown.
 * @param error - the rejection from the preview read.
 * @param signal - the caller's cancellation signal, when the read carried one.
 * @param degraded - the value the plan renders when the read is inconclusive.
 * @returns the degraded value, or the error to re-raise.
 */
export function previewOutcomeOf(error, signal, degraded) {
    if (signal?.aborted === true) {
        // The original failure rides as the cause: the harness renders the
        // cancellation, and a reader of the error chain still sees what the
        // aborted read actually ran into.
        return {
            kind: 'rethrow',
            error: new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED, { cause: error }),
        };
    }
    if (isPreviewDegradable(error))
        return { kind: 'degrade', value: degraded };
    return { kind: 'rethrow', error };
}
/**
 * Run one best-effort preview read under the shared degrade rule: the
 * fallback value when the read was merely inconclusive, the original error
 * (or the harness abort) otherwise. The one wrapper every previewing tool
 * funnels through, so the rule cannot drift between them.
 * @param signal - the caller's cancellation signal, when the read carries one.
 * @param fallback - the value the plan renders when the read is inconclusive.
 * @param read - the preview read.
 * @returns the read's value, or the fallback on a degradable failure.
 */
export async function runPreview(signal, fallback, read) {
    try {
        return await read();
    }
    catch (error) {
        const outcome = previewOutcomeOf(error, signal, fallback);
        if (outcome.kind === 'degrade')
            return outcome.value;
        throw outcome.error;
    }
}
//# sourceMappingURL=degradable.js.map