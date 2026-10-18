/**
 * The plugin's single spelling of the harness's caller-cancellation error.
 *
 * Cancellation is the harness's own outcome: the registry renders the
 * canonical `Error: tool call aborted` result from the `TOOL_ABORTED` code
 * (packages/core/tools/src/index.ts), and consumers route on that code, never
 * on the wording. The text is not part of this plugin's public surface
 * (`src/index.ts` re-exports `src/errors.ts` wholesale), but every internal
 * cancellation path must raise the identical error, so the one spelling lives
 * here.
 *
 * The value mirrors the harness's canonical cancellation text, which the
 * plugin writes into `HarnessError.message` so the error it raises reads
 * exactly like the result the harness would have synthesized. If the harness
 * changes that wording, this constant follows.
 * @module dsh-zotero/abort
 */

/**
 * The model-facing text of a caller-cancelled call. Must stay identical to the
 * harness's canonical cancellation wording.
 */
export const TOOL_ABORTED_MESSAGE = 'tool call aborted'
