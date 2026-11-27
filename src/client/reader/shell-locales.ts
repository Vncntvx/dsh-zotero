export const readerShellEn = {
  title: 'Zotero Reader',
  loading: 'Opening PDF…',
  unavailable: 'The PDF is unavailable in this session.',
  turnCitations: 'PDF citations ({count})',
  turnReaderCitations: 'Reader citations ({count})',
  turnCitationPage: '{title} · page {page}',
  turnResultNote: 'Save response to Zotero',
  turnResultNoteUnavailable: 'A writable Zotero parent item is unavailable for this citation.',
}

export const readerShellZh: typeof readerShellEn = {
  title: 'Zotero 阅读器',
  loading: '正在打开 PDF…',
  unavailable: '当前会话无法读取此 PDF',
  turnCitations: 'PDF 引用（{count}）',
  turnReaderCitations: '阅读引用（{count}）',
  turnCitationPage: '{title} · 第 {page} 页',
  turnResultNote: '将回答保存到 Zotero',
  turnResultNoteUnavailable: '该引用没有可写入的 Zotero 父条目',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    zoteroReaderShell: keyof typeof readerShellEn
  }
}
