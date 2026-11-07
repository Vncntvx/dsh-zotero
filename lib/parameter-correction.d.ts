/**
 * The model-facing parameter correction hint.
 *
 * A rejected call already names the missing required property; what the
 * pipeline cannot know is which misspelled argument the model sent instead.
 * This module pairs the two names and appends one hint block to the error
 * result. It runs as a `tools/post-execute` listener so every plugin tool —
 * core read, core write, and scholarly — gets the same treatment without
 * wrapping fifteen independent registrations.
 *
 * The hint never changes the error code, issues a request, or retries. It is
 * emitted only for a unique close match; a wrong suggestion would cost the
 * retry the hint exists to save.
 *
 * @module dsh-zotero/parameter-correction
 */
import type { Context } from '@deepseek-ai/cordis';
import type { PostToolDecision, ToolDefinition, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools';
/** One undeclared argument and the declared parameter it was meant for. */
export interface ParameterCorrection {
    readonly input: string;
    readonly expected: string;
}
/** Resolve the definition a call executed, for its parameter schema. */
export type ParameterCorrectionLookup = (exec: ToolExecution) => ToolDefinition | undefined;
/** The shape of one `tools/post-execute` listener. */
export type ParameterCorrectionListener = (exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>) => Promise<PostToolDecision>;
/**
 * Pair one undeclared argument with the missing required parameter it
 * misspells. Ambiguity yields no hint: a wrong suggestion costs the model the
 * retry the hint exists to save.
 * @param parameters - the tool's declared parameter schema.
 * @param argumentsValue - the arguments the model sent.
 * @param result - the normalized outcome.
 * @returns the correction, or undefined when there is nothing to correct.
 */
export declare function parameterCorrectionOf(parameters: ToolDefinition['parameters'] | undefined, argumentsValue: unknown, result: Readonly<ToolExecutionResult>): ParameterCorrection | undefined;
/**
 * The model-facing correction block. The error it accompanies already names
 * the missing property; the hint supplies the argument the model sent instead.
 * @param tool - the tool that rejected the call.
 * @param correction - the rejected argument and the declared parameter.
 * @returns the content block text appended to the error result.
 */
export declare function parameterCorrectionHint(tool: string, correction: ParameterCorrection): string;
/**
 * Build the `tools/post-execute` listener for one tool-name set. It appends
 * after `next()` so a downstream content replacement is preserved, and leaves
 * a block decision untouched.
 * @param admitted - the tool names this installer owns.
 * @param lookup - resolves the executed definition for its parameter schema.
 * @returns the waterfall listener.
 */
export declare function parameterCorrectionListener(admitted: ReadonlySet<string>, lookup: ParameterCorrectionLookup): ParameterCorrectionListener;
/**
 * Install the correction listener for the given tool names. The listener is
 * fiber-scoped, so it unwinds with the installing service.
 * @param ctx - the plugin context carrying the tool registry.
 * @param names - the tool names this installer owns.
 */
export declare function installParameterCorrection(ctx: Context, names: readonly string[]): void;
//# sourceMappingURL=parameter-correction.d.ts.map