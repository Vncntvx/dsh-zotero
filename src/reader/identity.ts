/** Stable identity shared by Reader state, evidence, and future caches. */

export type ReaderDocumentType = 'pdf' | 'html' | 'markdown' | 'text' | 'note'

export interface ReaderDocumentRef {
  readonly instanceId: string
  readonly libraryRef: string
  readonly itemRef: string
  readonly attachmentRef: string
  readonly documentType: ReaderDocumentType
  readonly contentFingerprint?: string
}

export function documentIdentityKey(ref: ReaderDocumentRef): string {
  return JSON.stringify([
    ref.instanceId,
    ref.libraryRef,
    ref.itemRef,
    ref.attachmentRef,
    ref.documentType,
    ref.contentFingerprint ?? '',
  ])
}

export function sameDocument(left: ReaderDocumentRef, right: ReaderDocumentRef): boolean {
  return documentIdentityKey(left) === documentIdentityKey(right)
}
