// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { findParsedPassage, findParsedRegion } from '../../../src/client/reader/parsed-passage.ts'
import type {
  ZoteroArtifactLocationView,
  ZoteroArtifactMetadataView,
} from '../../../src/contract.ts'

const location = (pageIndex: number, box?: readonly number[]): ZoteroArtifactLocationView =>
  ({ pageIndex, ...(box && { box }) }) as ZoteroArtifactLocationView

const metadata = {
  fingerprint: 'fingerprint',
  sourceRef: 'zotero://user/0/attachment/ABCD1234',
} as ZoteroArtifactMetadataView

it('matches only a unique region that agrees with the artifact identity', () => {
  expect(findParsedRegion([location(1, [10, 20, 30, 40])], { pageIndex: 1 })).toBeUndefined()
  expect(
    findParsedRegion([location(1, [30, 40, 10, 20])], { pageIndex: 1, box: [0, 0, 10, 10] }),
  ).toBeUndefined()
  expect(
    findParsedRegion([location(1, [10, 20, 30, 40])], { pageIndex: 2, box: [0, 0, 10, 10] }),
  ).toBeUndefined()
  expect(
    findParsedRegion([location(1, [0, 0, 10, 10]), location(1, [20, 30, 40, 50])], {
      pageIndex: 1,
      box: [10, 20, 30, 40],
    }),
  ).toBeUndefined()
  expect(
    findParsedRegion([location(1, [10, 20, 30, 40])], { pageIndex: 1, box: [10, 20, 30, 40] }),
  ).toBe(0)
  expect(
    findParsedRegion([location(1, [10, 20, 30, 40])], { pageIndex: 1, box: [11, 21, 31, 41] }),
  ).toBe(0)
})

it('reports identity and quote failures before searching the body', () => {
  const body = document.createElement('div')
  body.innerHTML = '<p>Methods and results</p>'
  expect(
    findParsedPassage(body, metadata, {
      quote: 'Methods',
      fingerprint: metadata.fingerprint,
      attachmentRef: metadata.sourceRef,
    }),
  ).toMatchObject({ status: 'parsedPassageFound' })
  expect(
    findParsedPassage(body, metadata, {
      quote: 'Methods',
      fingerprint: 'different',
      attachmentRef: metadata.sourceRef,
    }),
  ).toEqual({ status: 'parsedPassageChanged' })
  expect(
    findParsedPassage(body, metadata, {
      quote: 'x'.repeat(2_001),
      fingerprint: metadata.fingerprint,
      attachmentRef: metadata.sourceRef,
    }),
  ).toEqual({ status: 'parsedPassageMissing' })
})

it('finds one leaf block, rejects nested candidates, and reports duplicates as ambiguous', () => {
  const body = document.createElement('div')
  body.innerHTML =
    '<article><p><span>Methods and results</span></p><p>Methods and results</p><p>Only one match</p></article>'
  expect(
    findParsedPassage(body, metadata, {
      quote: 'Only one match',
      fingerprint: metadata.fingerprint,
      attachmentRef: metadata.sourceRef,
    }),
  ).toMatchObject({
    status: 'parsedPassageFound',
  })
  expect(
    findParsedPassage(body, metadata, {
      quote: 'Methods and results',
      fingerprint: metadata.fingerprint,
      attachmentRef: metadata.sourceRef,
    }),
  ).toEqual({
    status: 'parsedPassageAmbiguous',
  })
  expect(
    findParsedPassage(body, metadata, {
      quote: '',
      fingerprint: metadata.fingerprint,
      attachmentRef: metadata.sourceRef,
    }),
  ).toEqual({
    status: 'parsedPassageMissing',
  })
})
