import { describe, expect, it } from 'vitest'
import { ReaderConfigSchema, resolveReaderConfig } from '../../src/reader/config.js'
import {
  documentIdentityKey,
  sameDocument,
  type ReaderDocumentRef,
} from '../../src/reader/identity.js'
import {
  normalizeReadingState,
  readingStateStorageKeyOf,
  type ReadingState,
} from '../../src/reader/reading-state.js'

const documentRef: ReaderDocumentRef = {
  instanceId: 'instance-a',
  libraryRef: 'zotero://user/0/',
  itemRef: 'zotero://user/0/items/ITEM1234',
  attachmentRef: 'zotero://user/0/attachment/ATT1234',
  documentType: 'pdf',
  contentFingerprint: 'sha256:abc',
}

describe('Reader contracts', () => {
  it('keeps document identity scoped to instance, library, attachment, and content', () => {
    const sameAttachment = { ...documentRef }
    const otherInstance = { ...documentRef, instanceId: 'instance-b' }
    expect(documentIdentityKey(documentRef)).toContain('ATT1234')
    expect(sameDocument(documentRef, sameAttachment)).toBe(true)
    expect(sameDocument(documentRef, otherInstance)).toBe(false)
    expect(readingStateStorageKeyOf(documentRef)).toContain('dsh-zotero:reader:state:')
  })

  it('normalizes invalid reading values without changing the attachment identity', () => {
    const state: ReadingState = {
      pageIndex: -1,
      pageOffset: -2,
      zoom: 20,
      fitMode: 'width',
      rotation: 90,
      attachmentRef: documentRef.attachmentRef,
      panels: { outline: true, info: false },
      readingSeconds: -5,
      lastVisitedAt: -1,
    }
    expect(normalizeReadingState(state)).toMatchObject({
      pageIndex: 0,
      pageOffset: 0,
      zoom: 8,
      rotation: 90,
      attachmentRef: documentRef.attachmentRef,
      readingSeconds: 0,
      lastVisitedAt: 0,
    })
  })

  it('uses schema defaults for a mounted Reader component', () => {
    const value = ReaderConfigSchema({})
    expect(resolveReaderConfig(value)).toEqual({
      historyLimit: 50,
      persistReadingState: true,
      defaultTranslationTarget: 'auto',
      captureWatermark: false,
    })
  })

  it('validates the default translation target against supported Reader languages', () => {
    expect(
      resolveReaderConfig(ReaderConfigSchema({ defaultTranslationTarget: 'fr' })),
    ).toMatchObject({ defaultTranslationTarget: 'fr' })
    expect(() => ReaderConfigSchema({ defaultTranslationTarget: 'xx-invalid' as never })).toThrow()
  })
})
