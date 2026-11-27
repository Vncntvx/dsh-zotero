import type * as ParsedDocumentUi from './ParsedDocumentTab.tsx'

declare const require:
  | { readonly async?: (path: './client.parsed-document.js') => Promise<typeof ParsedDocumentUi> }
  | undefined

export function loadParsedDocument() {
  return typeof require === 'undefined' ? undefined : require.async?.('./client.parsed-document.js')
}
