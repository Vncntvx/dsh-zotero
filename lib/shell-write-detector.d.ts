/**
 * Ask for approval when static shell text describes a Local API write.
 * The scanner preserves quoted payloads and escaped separators, resolves literal
 * assignments, and joins raw socket pipelines. Addresses are canonicalized before
 * comparing ports, including short, numeric and mapped loopback spellings.
 *
 * This is a static detector. Script files, computed endpoints, environment values
 * absent from the command, and arbitrary binaries require the harness's execution
 * boundary; no shell text scanner can prove their network effects. run_code stays
 * outside this tool-name contract. Every terminal_send text is inspected because
 * a later Enter can execute text that was buffered without submit.
 * @module dsh-zotero/shell-write-detector
 */
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import { type ResolvedConfig } from './config.js';
/**
 * The tools whose command text this detector can read. `terminal_send` types
 * into a persistent shell, so its `text` is command text when the call submits
 * it; `run_code` is deliberately absent — its program can assemble any request
 * at runtime, exactly like `python -c`, and the module docs own that limit.
 */
export declare const SHELL_TOOL_NAMES: ReadonlySet<string>;
/** One detected write attempt, ready to become an approval request. */
interface ShellWriteAttempt {
    /**
     * The audit and fallback reason. It travels into `approval/asked`, and it is
     * what the model reads when no approval channel exists at all, so it names
     * the sanctioned route as well as what was detected.
     */
    readonly reason: string;
    /** The localized text the approval panel shows instead of {@link reason}. */
    readonly displayReason: {
        readonly en: string;
        readonly zh: string;
    };
}
/**
 * Decide whether one tool call is a shell write against Zotero's own API.
 *
 * Total and synchronous by contract: it runs inside the `tools/pre-execute`
 * waterfall before every tool body, so anything but a plain value return would
 * fail calls it was never meant to touch. Non-shell tools, missing or
 * non-string commands, and every read-only shape answer `undefined`.
 * @param config - the live config fields the rule reads.
 * @param execution - the call about to run; only its name and arguments are read.
 * @param aliases - the owner's alias cache; a caller without one recomputes.
 * @returns the detected attempt, or `undefined` to leave the call alone.
 */
export declare function detectShellWrite(config: Pick<ResolvedConfig, 'baseUrl'>, execution: Pick<ToolExecution, 'name' | 'arguments'>, aliases?: Map<string, readonly string[]>): ShellWriteAttempt | undefined;
export {};
//# sourceMappingURL=shell-write-detector.d.ts.map