/** Standalone locale additions; the composition root merges these into its locale map. */
export const parseEn = {
  parseTitle: 'Parse document with MinerU',
  parseClose: 'Close',
  parseTarget: 'Selected document',
  parseUrl: 'Public PDF URL',
  parseUrlHint:
    'Choose one public HTTP(S) PDF URL. Credentials and private addresses are refused. The host checks the address and PDF on submission.',
  parseInvalid: 'Choose a valid PDF attachment or public PDF URL before submitting.',
  parseMode: 'Committed mode',
  parseModeFree: 'Free',
  parseModePro: 'Precise',
  parseProvider: 'External service',
  parseUploadMeaning:
    'Submission lets the host read this PDF and send its bytes to MinerU (mineru.net) for parsing. The host downloads a public URL first.',
  parseLimits:
    'Maximum {bytes} bytes per PDF; MinerU accepts up to {pages} pages in this mode. The host enforces the byte limit; MinerU enforces the page limit. Page count is shown only when reported.',
  parseNoSemantic: 'Parsing does not require a local semantic model.',
  parseConfirm: 'Submit PDF to MinerU',
  parseReparse: 'Submit a new parse',
  parseRetry: 'Retry this parse',
  parseCancel: 'Cancel parsing',
  parseCancelRequested: 'Cancellation requested. Waiting for the host job to clean up.',
  parseCloseHint:
    'Closing releases this view. The host job continues; use Cancel parsing to stop it.',
  parseChecking: 'Checking existing artifact or parse receipt…',
  parseSubmitting: 'Submitting the selected document…',
  parseRunning: 'Parsing',
  parseStopping: 'Stopping and cleaning up',
  parseCompleted: 'Completed',
  parseFailed: 'Failed',
  parseKilled: 'Cancelled',
  parseWaiting: 'Waiting for the host job state',
  parseReconnect: 'Refresh status',
  parseReconnectHint:
    'Observation disconnected. Refreshing reads the existing operation without submitting another parse.',
  parseReceiptPending: 'Waiting for the bounded parse receipt.',
  parseArtifactReady: 'An existing artifact is available.',
  parseArtifactMissing: 'No current artifact is available.',
  parseArtifactExpired: 'The source changed. A new parse requires your submission.',
  parseCached: 'Reused artifact',
  parseFresh: 'New artifact',
  parseCharacters: 'Characters',
  parsePages: 'Reported pages',
  parsePagesUnknown: 'Not reported',
  parseFingerprint: 'Fingerprint',
  parseArtifact: 'Artifact revision',
  parseGeneration: 'Parse generation',
  parsePreview: 'Bounded Markdown preview',
  parseUnavailable:
    'Document parsing is not available. Enable the document parsing component and its jobs service.',
  parsePermission: 'This session does not have permission for this parsing action.',
  parseReadPermission:
    'This session does not have permission to inspect artifacts or parse receipts.',
  parseOffline: 'The host is disconnected. Reconnect to inspect or submit a parse.',
} as const

export const parseZh: Record<keyof typeof parseEn, string> = {
  parseTitle: '使用 MinerU 解析文档',
  parseClose: '关闭',
  parseTarget: '所选文档',
  parseUrl: '公开 PDF URL',
  parseUrlHint: '选择一个公开 HTTP(S) PDF URL。不接受凭据或私有地址；提交时由宿主检查地址与 PDF。',
  parseInvalid: '请选择有效的 PDF 附件或公开 PDF URL 后再提交。',
  parseMode: '已提交模式',
  parseModeFree: '免费',
  parseModePro: '精准',
  parseProvider: '外部服务',
  parseUploadMeaning:
    '提交后宿主读取此 PDF，并把文档字节发送给 MinerU（mineru.net）解析。公开 URL 由宿主先下载。',
  parseLimits:
    '每份 PDF 最大 {bytes} 字节；当前模式下 MinerU 最多接受 {pages} 页。宿主执行大小限制，MinerU 执行页数限制；仅在服务报告页数时显示。',
  parseNoSemantic: '主动解析不需要本地语义模型。',
  parseConfirm: '提交 PDF 到 MinerU',
  parseReparse: '提交新一代解析',
  parseRetry: '重试本次解析',
  parseCancel: '取消解析',
  parseCancelRequested: '已请求取消，等待宿主任务完成清理。',
  parseCloseHint: '关闭只释放当前视图，宿主任务继续运行；停止请用「取消解析」。',
  parseChecking: '正在查询已有产物或解析回执…',
  parseSubmitting: '正在提交所选文档…',
  parseRunning: '解析中',
  parseStopping: '正在停止并清理',
  parseCompleted: '已完成',
  parseFailed: '解析失败',
  parseKilled: '已取消',
  parseWaiting: '等待宿主任务状态',
  parseReconnect: '刷新状态',
  parseReconnectHint: '观察已断开。刷新只读取已有操作，不重新提交解析。',
  parseReceiptPending: '等待有界解析回执。',
  parseArtifactReady: '已有可用解析产物。',
  parseArtifactMissing: '没有当前有效产物。',
  parseArtifactExpired: '来源已变化，重新解析需再次提交。',
  parseCached: '复用产物',
  parseFresh: '新解析产物',
  parseCharacters: '字符数',
  parsePages: '已报告页数',
  parsePagesUnknown: '未报告',
  parseFingerprint: '指纹',
  parseArtifact: '产物修订',
  parseGeneration: '解析代次',
  parsePreview: '有界 Markdown 预览',
  parseUnavailable: '文档解析不可用，请启用文档解析组件及其任务服务。',
  parsePermission: '当前会话没有执行此解析操作的权限。',
  parseReadPermission: '当前会话没有查看产物或解析回执的权限。',
  parseOffline: '宿主已断开，重新连接后才能查看或提交解析。',
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
