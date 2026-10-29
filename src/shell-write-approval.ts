/**
 * @module dsh-zotero/shell-write-approval
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from './config.js'
import type { DiagnosticsRecorder } from './diagnostics.js'
import { detectShellWrite, SHELL_TOOL_NAMES } from './shell-write-detector.js'

export function installShellWriteApproval(
  ctx: Context,
  config: () => ResolvedConfig,
  diagnostics: DiagnosticsRecorder,
): void {
  ctx.on('tools/pre-execute', (execution, next) => {
    if (!SHELL_TOOL_NAMES.has(execution.name)) return next()
    const attempt = detectShellWrite(config(), execution)
    if (attempt === undefined) return next()
    diagnostics.sink.warn('shell.intercepted', attempt.reason, { tool: execution.name })
    return Promise.resolve({
      kind: 'ask',
      reason: attempt.reason,
      displayReason: attempt.displayReason,
    })
  })
}
