/** Standalone locale additions; the composition root merges these into its locale map. */
export const parseEn = {
  parseTitle: 'Parse document with MinerU',
  parseClose: 'Close',
  parseTarget: 'Selected document',
  parseUrl: 'Public PDF URL',
  parseUrlHint: 'Public HTTP(S) PDF URL.',
  parseInvalid: 'Choose a PDF attachment or a public PDF URL.',
  parseMode: 'Submission mode',
  parseModeFree: 'Agent Lightweight Parse',
  parseModePro: 'Precision Extract',
  parseProvider: 'External service',
  // The provider's product name is not translated; it names who receives the
  // document.
  parseProviderValue: 'MinerU (mineru.net)',
  parseLimits: 'Up to {size} and {pages} pages per PDF.',
  parseConfirm: 'Submit PDF to MinerU',
  parseReparse: 'Submit a new parse',
  parseRetry: 'Retry this parse',
  parseCancel: 'Cancel parsing',
  parseCancelRequested: 'Cancelling…',
  parseInProgress: 'Parsing in progress',
  parseCloseHint:
    'Parsing is in progress in the background. To stop, please click "Cancel Parsing".',
  parseChecking: 'Checking existing artifacts…',
  parseSubmitting: 'Submitting…',
  parseRunning: 'Parsing',
  parseStopping: 'Cancelling',
  parseCompleted: 'Completed',
  parseFailed: 'Failed',
  parseKilled: 'Cancelled',
  parseWaiting: 'Waiting to start',
  parseReconnect: 'Refresh status',
  parseReconnectHint: 'Connection lost. Refresh to see the result.',
  parseArtifactReady: 'An artifact is available.',
  parseArtifactExpired: 'The source changed; submit again to parse it.',
  parseCached: 'Reused artifact',
  parseFresh: 'New artifact',
  parseCharacters: 'Characters',
  parsePages: 'Pages',
  parsePagesUnknown: 'Not reported',
  parsePreview: 'Markdown preview',
  parseUnavailable: 'Enable the document parsing component and its jobs service to parse here.',
  parsePermission: 'This session does not have permission for this parsing action.',
  parseReadPermission:
    'This session does not have permission to inspect artifacts or parse receipts.',
  parseOffline: 'Reconnect to the host to inspect or submit a parse.',
} as const

export const parseZh: Record<keyof typeof parseEn, string> = {
  parseTitle: '使用 MinerU 解析文档',
  parseClose: '关闭',
  parseTarget: '所选文档',
  parseUrl: '公开 PDF URL',
  parseUrlHint: '公开 HTTP(S) PDF 地址。',
  parseInvalid: '请选择 PDF 附件或公开 PDF URL。',
  parseMode: '提交模式',
  parseModeFree: 'Agent 轻量解析',
  parseModePro: '精准解析',
  parseProvider: '外部服务',
  parseProviderValue: 'MinerU (mineru.net)',
  parseLimits: '单文件上限 {size}、{pages} 页。',
  parseConfirm: '提交 PDF 到 MinerU',
  parseReparse: '重新提交解析',
  parseRetry: '重试本次解析',
  parseCancel: '取消解析',
  parseCancelRequested: '正在取消…',
  parseInProgress: '正在解析',
  parseCloseHint: '解析正在后台进行，如需停止请点击「取消解析」。',
  parseChecking: '正在检查已有产物…',
  parseSubmitting: '正在提交…',
  parseRunning: '解析中',
  parseStopping: '正在取消',
  parseCompleted: '已完成',
  parseFailed: '解析失败',
  parseKilled: '已取消',
  parseWaiting: '等待开始',
  parseReconnect: '刷新状态',
  parseReconnectHint: '连接已断开，刷新可查看结果。',
  parseArtifactReady: '已有解析产物。',
  parseArtifactExpired: '来源已变化，请重新提交解析。',
  parseCached: '复用已有产物',
  parseFresh: '本次新产物',
  parseCharacters: '字符数',
  parsePages: '页数',
  parsePagesUnknown: '未报告',
  parsePreview: 'Markdown 预览',
  parseUnavailable: '启用文档解析组件及其任务服务后即可在此解析。',
  parsePermission: '当前会话没有执行此解析操作的权限。',
  parseReadPermission: '当前会话没有查看产物或解析回执的权限。',
  parseOffline: '重新连接宿主后即可查看或提交解析。',
}

export const parseLocales = { zh: parseZh, en: parseEn }
export type ParseLocaleKey = keyof typeof parseEn
export type ParseTranslate = (
  key: ParseLocaleKey,
  parameters?: Readonly<Record<string, string | number>>,
) => string

export function parseTranslate(locale: keyof typeof parseLocales): ParseTranslate {
  return (key, parameters) =>
    parseLocales[locale][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      String(parameters?.[name] ?? placeholder),
    )
}
