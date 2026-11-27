import { expect, it } from 'vitest'
import { loadReaderPdf, loadReaderTab } from '../../../src/client/reader/load-chunks.ts'

it('leaves the native host path available when the package loader is absent', () => {
  expect(loadReaderPdf()).toBeUndefined()
  expect(loadReaderTab()).toBeUndefined()
})
