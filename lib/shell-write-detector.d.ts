/**
 * Detecting a shell command that would write to Zotero's own local API.
 *
 * The plugin's write gate is the `ctx.zotero` seam, and a shell can reach
 * Zotero's write API without ever touching that seam. Nothing inside the
 * plugin can close that hole by itself: `approval/asked` fires only for what
 * the tool pipeline asks about, and the sandbox confines file effects rather
 * than network access. So the plugin does not try to *block* the route; it
 * makes the route ask. A detected command raises the harness's own approval
 * request before the body runs (`tools/pre-execute` → `{kind: 'ask'}`), so the
 * write happens only if the user confirms that one call, and does not happen
 * when they reject it, cancel it, run with the `never` policy (which
 * auto-rejects every ask), or have no approval channel at all.
 *
 * This module is the detector only: pure, synchronous, and total. It reads the
 * command text, which is why it is a detector rather than a guarantee. All of
 * these pass it unseen:
 * - a request written into a script file and then executed (`bash build.sh`);
 * - an interpreter whose command text never spells the endpoint
 *   (`python -c '...'`, `node -e '...'` with the URL assembled at runtime);
 * - the URL carried in an environment variable, a heredoc, or an encoding;
 * - a loopback port other than the configured one, except for writes to the
 *   users path and authorize calls (those are caught on any loopback port;
 *   see {@link USERS_WRITE} and {@link AUTHORIZE_PATH});
 * - any binary of the user's own.
 *
 * The rule is a read-only allow: `GET` probes of the local API, debugging
 * curls, and requests to any other host are not writing, so they are left
 * alone. Five shapes do match, and {@link WRITE_SHAPES} lists them: the
 * authorize endpoint (which exists only to obtain a write key) beside a
 * loopback host; an explicit write method or body flag beside the configured
 * local API address, and only when an HTTP-client invocation is present; a
 * bare method token or a client-library write call beside that address; and a
 * write to the users path beside any loopback host. Anchoring on the client is
 * what keeps an ordinary command that merely names the address, and uses an
 * unrelated flag such as `rm -f`, from asking.
 *
 * Every proximity match is **segment-scoped**: shell separators (`;`, `&&`,
 * `|`, newlines) bound the steps one command runs, and a `POST` in a later
 * step is not a method for the request in an earlier one. `curl -s …?limit=1
 * && echo POST done` is a read followed by an unrelated echo, not a write.
 * @module dsh-zotero/shell-write-detector
 */
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import { type ResolvedConfig } from './config.js';
/** The shell tools whose command text this detector can read. */
export declare const SHELL_TOOL_NAMES: ReadonlySet<string>;
/** One detected write attempt, ready to become an approval request. */
export interface ShellWriteAttempt {
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
 * @returns the detected attempt, or `undefined` to leave the call alone.
 */
export declare function detectShellWrite(config: Pick<ResolvedConfig, 'baseUrl'>, execution: Pick<ToolExecution, 'name' | 'arguments'>): ShellWriteAttempt | undefined;
//# sourceMappingURL=shell-write-detector.d.ts.map