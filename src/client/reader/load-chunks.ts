import type { mountPdf } from './pdf-runtime.ts'
import type * as ReaderUi from './ReaderTab.tsx'

interface ReaderChunks {
  './client.reader-pdf.js': { readonly mountPdf: typeof mountPdf }
  './client.reader-ui.js': typeof ReaderUi
}
declare const require:
  | {
      readonly async?: <Path extends keyof ReaderChunks>(path: Path) => Promise<ReaderChunks[Path]>
    }
  | undefined

export function loadReaderPdf() {
  return typeof require === 'undefined' ? undefined : require.async?.('./client.reader-pdf.js')
}

export function loadReaderTab() {
  return typeof require === 'undefined' ? undefined : require.async?.('./client.reader-ui.js')
}
