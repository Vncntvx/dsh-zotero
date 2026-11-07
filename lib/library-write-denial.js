/**
 * Structured `ToolFailure.info.code` values that mean the user, not the
 * system, ended the plan review. `ASK_CANCELLED` is the code this repository
 * already treats as a user decision not to approve (`src/write-approval.ts`).
 * It is checked before the wording, so a harness release that starts filling
 * `info` is classified by identity rather than by a sentence.
 */
export const HARNESS_DENIAL_CODES = ['ASK_CANCELLED'];
/**
 * The two refusal sentences the harness emits, with `$TOOL` standing for
 * `exec.name`. The matchers below are derived from these templates and the
 * boundary specs build their inputs from them, so an upstream wording change
 * is one edit in this module.
 */
export const HARNESS_REFUSAL_TEMPLATES = {
    rejected: 'the user rejected tool "$TOOL"',
    cancelled: 'approval for tool "$TOOL" was cancelled',
};
/** Escape the literal halves of a template before compiling it to a matcher. */
function quote(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Turn one template into an anchored matcher that captures the tool name. */
function refusalPattern(kind) {
    const parts = HARNESS_REFUSAL_TEMPLATES[kind].split('$TOOL');
    return new RegExp(`^${quote(parts[0] ?? '')}([^"]+)${quote(parts[1] ?? '')}$`);
}
export const HARNESS_USER_REJECTION = refusalPattern('rejected');
export const HARNESS_APPROVAL_CANCELLED = refusalPattern('cancelled');
const REFUSAL_PATTERNS = [HARNESS_USER_REJECTION, HARNESS_APPROVAL_CANCELLED];
/**
 * Classify one tool execution result as a user decline or a real failure.
 * Only an exact refusal sentence naming `expectedToolName` counts: a gateway
 * error that merely quotes a rejected tool, a refusal for another tool, or a
 * sentence with trailing text stays `failed`, because none of them proves the
 * user declined *this* write.
 * @param result - the settled tool result from `ctx.tools.execute`.
 * @param expectedToolName - the write tool the panel actually dispatched.
 * @returns `'declined'` only for a proven user refusal of that call.
 */
export function classifyDenial(result, expectedToolName) {
    if (!result.isError)
        return 'failed';
    const code = result.error.info?.code;
    if (code !== undefined && HARNESS_DENIAL_CODES.some((denial) => denial === code))
        return 'declined';
    return REFUSAL_PATTERNS.some((pattern) => pattern.exec(result.error.message)?.[1] === expectedToolName)
        ? 'declined'
        : 'failed';
}
//# sourceMappingURL=library-write-denial.js.map