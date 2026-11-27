import { refFieldsOf } from '../../ref-grammar.ts'
import type { PdfArtifactEvidence, PdfEvidenceQuote, PdfPageRegion } from '../../reader/evidence.ts'
import type { HistoricalTextCitation } from './historical-citations.ts'

export const READER_TAB_KIND = 'zotero-reader'
const PREFIX = 'dsh-resource://zotero-reader/'
export const READER_TAB_PATTERN = `${PREFIX}**`
type ReaderTargetKind = 'attachment' | 'note' | 'text'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightResourceParamsMap {
    'zotero-reader': {
      readonly title?: string
      readonly position?: PdfPageRegion
      readonly evidenceQuote?: PdfEvidenceQuote
      readonly artifactEvidence?: PdfArtifactEvidence
      readonly expectedFingerprint?: string
      readonly noteVersion?: number
      readonly textCitation?: Pick<
        HistoricalTextCitation,
        'documentType' | 'textRange' | 'fingerprint'
      >
    }
  }
}

export function readerAddress(
  sessionId: string,
  ref: string,
  kind: ReaderTargetKind = 'attachment',
): string {
  return `${PREFIX}${encodeURIComponent(sessionId)}/${kind === 'attachment' ? '' : `${kind}/`}${encodeURIComponent(ref)}`
}

export function readerTarget(
  address: string,
): { sessionId: string; ref: string; kind: ReaderTargetKind } | undefined {
  if (!address.startsWith(PREFIX)) return undefined
  const segments = address.slice(PREFIX.length).split('/')
  const kind =
    segments.length === 3 && (segments[1] === 'note' || segments[1] === 'text')
      ? segments[1]
      : 'attachment'
  const encodedRef = segments.at(-1)
  if (!segments[0] || !encodedRef) return undefined
  try {
    const sessionId = decodeURIComponent(segments[0])
    const ref = decodeURIComponent(encodedRef)
    if (
      refFieldsOf(ref)?.kind !== (kind === 'note' ? 'item' : 'attachment') ||
      readerAddress(sessionId, ref, kind) !== address
    )
      return undefined
    return { sessionId, ref, kind }
  } catch {
    return undefined
  }
}
