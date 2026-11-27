// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ClaimEvidence } from '../../../src/client/components/workspace/ClaimEvidence.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { passageOf, sourceOf } from '../helpers/source-fixtures.ts'

const ref = 'zotero://user/0/attachment/ABCD1234?server=zotero'
const original = sourceOf({
  key: 'original',
  evidence: [
    passageOf({
      source: 'fulltext',
      sourceRef: ref,
      matchKind: 'lexical',
      text: 'The measured sample was small.',
      callIds: ['original-retrieval'],
    }),
  ],
})
const conflicting = sourceOf({
  key: 'conflicting',
  evidence: [
    passageOf({
      sourceRef: ref.replace('ABCD1234', 'EFGH1234'),
      text: 'The replication did not detect the effect.',
      callIds: ['replication-retrieval'],
    }),
  ],
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  sessionStorage.clear()
})

it('links multiple sources to a claim, recovers reader reviews, and opens the exact verified passage', async () => {
  const openPdf = vi.fn().mockResolvedValue(undefined)
  const more = { sessionId: 'session', t: mockT, openPdf }
  const first = render(<ClaimEvidence {...more} source={original} />)
  fireEvent.click(screen.getByText(mockT('claimEvidence')))
  fireEvent.change(screen.getByRole('textbox', { name: mockT('claimStatement') }), {
    target: { value: 'The effect needs replication' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: mockT('claimRelation') }), {
    target: { value: 'limits' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: mockT('claimReview') }), {
    target: { value: 'verified' },
  })
  fireEvent.submit(screen.getByRole('form', { name: mockT('claimAddEvidence') }))
  await screen.findByText(mockT('claimSaved'))
  first.unmount()
  const second = render(<ClaimEvidence {...more} source={conflicting} />)
  fireEvent.click(screen.getByText(mockT('claimEvidence')))
  const select = screen.getByRole<HTMLSelectElement>('combobox', { name: mockT('claimChoose') })
  fireEvent.change(select, { target: { value: select.options[1]!.value } })
  fireEvent.change(screen.getByRole('combobox', { name: mockT('claimRelation') }), {
    target: { value: 'refutes' },
  })
  fireEvent.submit(screen.getByRole('form', { name: mockT('claimAddEvidence') }))
  second.unmount()

  render(<ClaimEvidence {...more} source={original} />)
  fireEvent.click(screen.getByText(mockT('claimEvidence')))
  const claim = screen.getByText('The effect needs replication', { selector: 'summary' })
  fireEvent.click(claim)
  const detail = within(claim.parentElement!)
  expect(detail.getByText(`${mockT('claimLimits')} · ${mockT('claimVerified')}`)).toBeTruthy()
  expect(detail.getByText(`${mockT('claimRefutes')} · ${mockT('claimUnreviewed')}`)).toBeTruthy()
  fireEvent.click(detail.getByRole('button', { name: mockT('jumpToPageInSidebar') }))
  expect(openPdf).toHaveBeenCalledExactlyOnceWith(ref, {
    quote: original.evidence[0]!.text,
    sourceType: 'bm25',
  })
})

it('reports a Reader launch failure and selects a verifiable source when allowed', async () => {
  const openPdf = vi.fn().mockRejectedValue(new Error('Reader unavailable'))
  const selectSource = vi.fn()
  render(
    <ClaimEvidence
      sessionId="session"
      t={mockT}
      source={original}
      openPdf={openPdf}
      selectSource={selectSource}
      canSelectSource={() => true}
    />,
  )
  fireEvent.click(screen.getByText(mockT('claimEvidence')))
  fireEvent.change(screen.getByRole('textbox', { name: mockT('claimStatement') }), {
    target: { value: 'The effect needs replication' },
  })
  fireEvent.submit(screen.getByRole('form', { name: mockT('claimAddEvidence') }))
  const claim = screen.getByText('The effect needs replication', { selector: 'summary' })
  fireEvent.click(claim)
  const detail = within(claim.parentElement!)
  await act(async () => {
    fireEvent.click(detail.getByRole('button', { name: mockT('jumpToPageInSidebar') }))
  })
  expect(screen.getByText(mockT('libraryPdfReaderUnavailable'))).toBeTruthy()
  fireEvent.click(detail.getByRole('button', { name: original.evidence[0]!.sourceRef }))
  expect(selectSource).toHaveBeenCalledWith(original.key)
})

it('retains the claim for review when browser storage rejects a save', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage quota', 'QuotaExceededError')
  })
  render(<ClaimEvidence sessionId="session" t={mockT} source={original} />)
  fireEvent.click(screen.getByText(mockT('claimEvidence')))
  const statement = screen.getByRole('textbox', { name: mockT('claimStatement') })
  fireEvent.invalid(statement)
  expect(statement.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByText(mockT('claimStatementRequired'))).toBeTruthy()
  fireEvent.change(statement, { target: { value: 'The effect needs replication' } })
  expect(statement.hasAttribute('aria-invalid')).toBe(false)
  const form = screen.getByRole('form', { name: mockT('claimAddEvidence') })
  fireEvent.submit(form)
  expect(screen.getByRole('status').textContent).toBe(mockT('claimMemoryOnly'))

  fireEvent.change(screen.getByRole('combobox', { name: mockT('claimReview') }), {
    target: { value: 'disputed' },
  })
  fireEvent.submit(form)

  const claim = screen.getByText('The effect needs replication', { selector: 'summary' })
  fireEvent.click(claim)
  const detail = within(claim.parentElement!)
  expect(detail.getByText(`${mockT('claimSupports')} · ${mockT('claimDisputed')}`)).toBeTruthy()
  expect(detail.getAllByText(original.evidence[0]!.text)).toHaveLength(1)
  expect(sessionStorage.length).toBe(0)
})
