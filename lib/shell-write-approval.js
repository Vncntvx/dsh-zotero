/**
 * @module dsh-zotero/shell-write-approval
 */
import { detectShellWrite, SHELL_TOOL_NAMES } from './shell-write-detector.js';
export function installShellWriteApproval(ctx, config, diagnostics) {
    // The alias cache lives with the registration: it dies with the fiber and
    // never accumulates addresses across plugin lifetimes.
    const aliases = new Map();
    ctx.on('tools/pre-execute', async (execution, next) => {
        if (!SHELL_TOOL_NAMES.has(execution.name))
            return next();
        const attempt = detectShellWrite(config(), execution, aliases);
        if (attempt === undefined)
            return next();
        diagnostics.sink.warn('shell.intercepted', attempt.reason, { tool: execution.name });
        return {
            kind: 'ask',
            reason: attempt.reason,
            displayReason: attempt.displayReason,
        };
    });
}
//# sourceMappingURL=shell-write-approval.js.map