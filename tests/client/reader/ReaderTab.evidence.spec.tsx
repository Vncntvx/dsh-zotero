// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderTab } from '../../../src/client/reader/ReaderTab.tsx'
import type { PdfEvidenceLocation } from '../../../src/client/reader/pdf-runtime.ts'
import type { PdfEvidenceQuote } from '../../../src/reader/evidence.ts'
import { deferred } from '../../helpers/sync.ts'
import { pdfRuntime, propsOf, t } from './support/reader-tab.ts'

afterEach(() => cleanup())

const quote = { quote: 'The observed effect', sourceType: 'semantic' } as const

function propsForEvidence(runtime: ReturnType<typeof pdfRuntime>) {
  const props = propsOf({ load: async () => runtime })
  return (evidenceQuote: PdfEvidenceQuote, revision: number) => ({
    ...props,
    useTabInfo: () => {
      const info = props.useTabInfo()
      return {
        ...info,
        tab: {
          ...info.tab,
          navigation: { ...info.tab.navigation, revision, params: { evidenceQuote } },
        },
      }
    },
  })
}

it('lets the reader choose a physical page when a retrieved passage repeats', async () => {
  const runtime = pdfRuntime(undefined, { count: 6 })
  runtime.controls.locateEvidence.mockResolvedValue({ kind: 'ambiguous', pages: [2, 5] })
  render(<ReaderTab {...propsForEvidence(runtime)(quote, 1)} />)

  const pages = await screen.findByRole('combobox', { name: t('evidenceChoosePage') })
  expect(runtime.controls.locateEvidence).toHaveBeenCalledExactlyOnceWith(
    quote,
    expect.any(AbortSignal),
  )
  expect(runtime.controls.goTo).not.toHaveBeenCalled()
  fireEvent.change(pages, { target: { value: '6' } })
  expect(runtime.controls.goTo).toHaveBeenCalledExactlyOnceWith(6)
  expect(runtime.controls.setEvidence).toHaveBeenCalledExactlyOnceWith(undefined)
})

it('reopens the current bytes and drops earlier results when the same tab is retargeted', async () => {
  const runtime = pdfRuntime()
  const previous = deferred<PdfEvidenceLocation>()
  runtime.controls.locateEvidence
    .mockReturnValueOnce(previous.promise)
    .mockResolvedValueOnce({ kind: 'missing' })
  const makeProps = propsForEvidence(runtime)
  const { rerender } = render(<ReaderTab {...makeProps(quote, 1)} />)
  await screen.findByText(t('evidenceLocating'))
  const firstSignal = runtime.controls.locateEvidence.mock.calls[0]![1]

  rerender(<ReaderTab {...makeProps({ ...quote, quote: 'Later projection' }, 2)} />)
  await screen.findByText(t('evidenceMissing'))
  expect(firstSignal.aborted).toBe(true)
  expect(runtime.mountPdf).toHaveBeenCalledTimes(2)
  await act(async () => previous.resolve({ kind: 'ambiguous', pages: [0] }))
  expect(screen.queryByRole('combobox', { name: t('evidenceChoosePage') })).toBeNull()
})

it('cancels the search when the reader dismisses progress', async () => {
  const runtime = pdfRuntime()
  const request = deferred<PdfEvidenceLocation>()
  runtime.controls.locateEvidence.mockReturnValue(request.promise)
  render(<ReaderTab {...propsForEvidence(runtime)(quote, 1)} />)

  fireEvent.click(await screen.findByRole('button', { name: t('cancel') }))
  expect(runtime.controls.locateEvidence.mock.calls[0]![1].aborted).toBe(true)
  await act(async () => request.resolve({ kind: 'incomplete' }))
  expect(screen.queryByText(t('evidenceIncomplete'))).toBeNull()
})

it('reports the verified page range when the text spans physical pages', async () => {
  const runtime = pdfRuntime(undefined, { count: 4 })
  runtime.controls.locateEvidence.mockResolvedValue({ kind: 'page', pageIndex: 1, endPageIndex: 2 })
  render(<ReaderTab {...propsForEvidence(runtime)(quote, 1)} />)
  await screen.findByText(t('evidencePageSpan', { first: 2, last: 3 }))
  expect(screen.queryByRole('combobox', { name: t('evidenceChoosePage') })).toBeNull()
})

it('shows a version warning and skips location for a parsed passage from an older PDF', async () => {
  const runtime = pdfRuntime(undefined, { fingerprint: `sha256:${'b'.repeat(64)}` })
  render(
    <ReaderTab
      {...propsForEvidence(runtime)(
        {
          ...quote,
          sourceType: 'mineru',
          contentFingerprint: `sha256:${'a'.repeat(64)}`,
        },
        1,
      )}
    />,
  )
  await screen.findByText(t('quoteAttachmentChanged'))
  expect(runtime.controls.locateEvidence).not.toHaveBeenCalled()
})

it('preserves paging after the PDF text layer rejects an evidence search', async () => {
  const runtime = pdfRuntime(undefined, { count: 3 })
  runtime.controls.locateEvidence.mockRejectedValueOnce(new Error('Text layer unavailable'))
  render(<ReaderTab {...propsForEvidence(runtime)(quote, 1)} />)
  expect(await screen.findByText(t('evidenceFailed'))).toBeTruthy()
  expect(runtime.controls.setEvidence).toHaveBeenCalledWith(undefined)
  fireEvent.click(screen.getByRole('button', { name: t('next') }))
  expect(runtime.controls.goTo).toHaveBeenCalledExactlyOnceWith(2)
})

it('rechecks the current PDF on every parsed region jump before displaying geometry', async () => {
  const fingerprint = `sha256:${'a'.repeat(64)}`
  const artifactRegion = { pageIndex: 1, box: [100, 200, 500, 600] } as const
  const position = { pageIndex: 1, rects: [{ x: 16, y: 40, width: 64, height: 40 }] }
  const original = pdfRuntime(undefined, { fingerprint, count: 2 })
  original.controls.artifactPosition.mockResolvedValueOnce(position)
  const changed = pdfRuntime(undefined, { fingerprint: `sha256:${'b'.repeat(64)}`, count: 2 })
  const props = propsOf({
    load: vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(changed),
  })
  const info = props.useTabInfo()
  const artifactEvidence = { artifactRegion, contentFingerprint: fingerprint }
  const seat = (revision: number) => ({
    ...props,
    useTabInfo: () => ({
      ...info,
      tab: {
        ...info.tab,
        navigation: { ...info.tab.navigation, revision, params: { artifactEvidence } },
      },
    }),
  })
  const view = render(<ReaderTab {...seat(1)} />)
  await screen.findByText(t('evidenceArtifactRegion'))
  expect(original.controls.setEvidence).toHaveBeenLastCalledWith(position)
  expect(original.controls.artifactPosition).toHaveBeenCalledExactlyOnceWith(
    artifactRegion,
    expect.any(AbortSignal),
  )
  view.rerender(<ReaderTab {...seat(2)} />)
  await screen.findByText(t('quoteAttachmentChanged'))
  expect(changed.mountPdf).toHaveBeenCalledOnce()
  expect(changed.controls.artifactPosition).not.toHaveBeenCalled()
  expect(changed.controls.setEvidence).toHaveBeenCalledExactlyOnceWith(undefined)
})
