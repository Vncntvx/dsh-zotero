// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ZoteroBatchParseView } from '../../../src/contract.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { en } from '../../../src/client/locales.ts'
import { BatchParseDialog } from '../../../src/client/enrichment/BatchParseDialog.tsx'
import { useBatchParseStatus } from '../../../src/client/enrichment/use-batch-parse-status.ts'
import { deferred } from '../../helpers/sync.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'
import { CATALOG, maintenance, pdfs } from './support/document-maintenance.ts'
import { SESSION, world } from './support/parsed-manager-world.tsx'
import type { ComponentProps } from 'react'

afterEach(cleanup)

function Dialog(props: Omit<ComponentProps<typeof BatchParseDialog>, 'status'>) {
  return (
    <BatchParseDialog
      {...props}
      status={useBatchParseStatus(props.remote, props.sessionId, props.deployment.connected)}
    />
  )
}

it('selects all pages with a single exclusion and sends nothing until confirmed', async () => {
  const remote = maintenance()
  world({ maintenance: remote })
  fireEvent.click(screen.getByRole('button', { name: en.batchTitle }))
  const dialog = await screen.findByRole('dialog', { name: en.batchTitle })
  const ui = within(dialog)
  fireEvent.click(await ui.findByRole('button', { name: 'Select all 51 PDFs in this library' }))
  fireEvent.click(ui.getByRole('button', { name: en.batchNext }))
  fireEvent.click(await ui.findByRole('checkbox', { name: 'PDF 51' }))
  expect(ui.getByText('A. Li · Journal of Hydrology · 2023')).toBeTruthy()
  expect(ui.queryByText('50 PDFs selected')).not.toBeNull()
  fireEvent.click(ui.getByRole('button', { name: en.batchReview }))
  expect(ui.getByText(/sent to MinerU/)).toBeTruthy()
  expect(ui.getByText('Up to 50 MB and 100 pages per PDF.')).toBeTruthy()
  expect(remote.startBatchParse).not.toHaveBeenCalled()
  fireEvent.click(ui.getByRole('button', { name: 'Submit 50 PDFs to MinerU' }))
  await ui.findByText(/0\/50 processed/)
  expect(remote.startBatchParse).toHaveBeenCalledExactlyOnceWith({
    sessionId: SESSION,
    catalogId: CATALOG,
    operationId: expect.any(String),
    selection: { all: true, refs: [pdfs[50]!.ref] },
  })
})

it('retains manual selections across pages and retries an ambiguous submit with its original operation id', async () => {
  const remote = maintenance()
  remote.startBatchParse.mockResolvedValueOnce({
    ok: false,
    error: new RemoteError('gateway/internal', 'Connection lost', {}),
  })
  world({ maintenance: remote })
  fireEvent.click(screen.getByRole('button', { name: en.batchTitle }))
  const ui = within(await screen.findByRole('dialog', { name: en.batchTitle }))
  fireEvent.click(await ui.findByRole('checkbox', { name: 'PDF 1' }))
  fireEvent.click(ui.getByRole('button', { name: en.batchClear }))
  expect(ui.queryByText('0 PDFs selected')).not.toBeNull()
  fireEvent.click(ui.getByRole('checkbox', { name: 'PDF 1' }))
  fireEvent.click(ui.getByRole('button', { name: en.batchNext }))
  fireEvent.click(await ui.findByRole('checkbox', { name: 'PDF 51' }))
  fireEvent.click(ui.getByRole('button', { name: en.batchPrevious }))
  const first = await ui.findByRole<HTMLInputElement>('checkbox', { name: 'PDF 1' })
  expect(first.checked).toBe(true)
  fireEvent.click(ui.getByRole('button', { name: en.batchReview }))
  fireEvent.click(ui.getByRole('button', { name: en.batchBack }))
  await ui.findByRole('checkbox', { name: 'PDF 1' })
  fireEvent.click(ui.getByRole('button', { name: en.batchReview }))
  const submit = ui.getByRole('button', { name: 'Submit 2 PDFs to MinerU' })
  fireEvent.click(submit)
  await ui.findByRole('alert')
  fireEvent.click(submit)
  await ui.findByText(en.parseRunning)
  expect(remote.startBatchParse).toHaveBeenCalledTimes(2)
  expect(remote.startBatchParse.mock.calls[0]).toEqual(remote.startBatchParse.mock.calls[1])
  expect(remote.startBatchParse.mock.calls[0]?.[0].selection).toEqual({
    all: false,
    refs: [pdfs[0]!.ref, pdfs[50]!.ref],
  })
})

it('shows catalog errors and allows a refresh before choosing another library', async () => {
  const remote = maintenance()
  remote.batchPdfCatalog.mockResolvedValueOnce({
    ok: false,
    error: new RemoteError('gateway/internal', 'Zotero unreachable', {}),
  })
  remote.batchPdfCatalog.mockResolvedValueOnce({
    ok: true,
    value: {
      kind: 'libraries',
      libraries: [
        { library: { type: 'user', id: 0 }, name: 'My Library' },
        { library: { type: 'group', id: 12 }, name: 'Lab papers' },
      ],
    },
  })
  world({ maintenance: remote })
  fireEvent.click(screen.getByRole('button', { name: en.batchTitle }))
  const ui = within(await screen.findByRole('dialog', { name: en.batchTitle }))
  await ui.findByText('Zotero unreachable')
  fireEvent.click(ui.getByRole('button', { name: en.parseReconnect }))
  await ui.findByRole('checkbox', { name: 'PDF 1' })
  fireEvent.click(ui.getByRole('button', { name: en.batchLibrary }))
  fireEvent.click(await screen.findByText('Lab papers'))
  await vi.waitFor(() =>
    expect(remote.batchPdfCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ source: { library: { type: 'group', id: 12 } } }),
      expect.any(AbortSignal),
    ),
  )
  await ui.findByRole('checkbox', { name: 'PDF 1' })
  const search = ui.getByRole('searchbox', { name: en.batchFind })
  await act(async () => {
    fireEvent.change(search, { target: { value: 'acidification' } })
  })
  await vi.waitFor(() =>
    expect(remote.batchPdfCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'acidification' }),
      expect.any(AbortSignal),
    ),
  )
})

it('reloads an expired selection snapshot before submitting another selection', async () => {
  const remote = maintenance()
  world({ maintenance: remote })
  fireEvent.click(screen.getByRole('button', { name: en.batchTitle }))
  const ui = within(await screen.findByRole('dialog', { name: en.batchTitle }))
  fireEvent.click(await ui.findByRole('checkbox', { name: 'PDF 1' }))
  remote.batchPdfCatalog.mockResolvedValueOnce({
    ok: false,
    error: new RemoteError('gateway/internal', 'The PDF listing expired', {}),
  })
  fireEvent.click(ui.getByRole('button', { name: en.batchNext }))
  await ui.findByText('The PDF listing expired')
  fireEvent.click(ui.getByRole('button', { name: en.batchReload }))
  await ui.findByRole('checkbox', { name: 'PDF 1' })
  expect(ui.queryByText('0 PDFs selected')).not.toBeNull()
  expect(remote.batchPdfCatalog).toHaveBeenLastCalledWith(
    {
      sessionId: SESSION,
      kind: 'pdfs',
      offset: 0,
      query: '',
      source: { library: { type: 'user', id: 0 } },
    },
    expect.any(AbortSignal),
  )
  expect(remote.startBatchParse).not.toHaveBeenCalled()
})

it('reconnects to a failed batch and shows skipped work and the failure reason', async () => {
  const remote = maintenance()
  remote.batchParseStatus
    .mockResolvedValueOnce({
      ok: false,
      error: new RemoteError('gateway/internal', 'Lost connection', {}),
    })
    .mockResolvedValueOnce({
      ok: true,
      value: {
        operationId: CATALOG,
        state: 'failed',
        total: 4,
        parsed: 1,
        reused: 0,
        failed: 1,
        skipped: 2,
        error: 'Quota exhausted',
        failures: [],
      },
    })
  world({ maintenance: remote })
  fireEvent.click(screen.getByRole('button', { name: en.batchTitle }))
  const ui = within(await screen.findByRole('dialog', { name: en.batchTitle }))
  await ui.findByText('Lost connection')
  fireEvent.click(ui.getByRole('button', { name: en.parseReconnect }))
  await ui.findByText('Quota exhausted')
  expect(ui.queryByText(en.batchResultFailed)).not.toBeNull()
  expect(ui.queryByText(/2 skipped/)).not.toBeNull()
  expect(remote.startBatchParse).not.toHaveBeenCalled()
})

it('blocks confirmation when deployment fails, the connection drops, or the grant is revoked', async () => {
  const remote = maintenance()
  const deployment = {
    mounted: true,
    connected: true,
    mode: 'pro' as const,
    revision: 'ready',
    maxPages: 100,
    maxFileBytes: 50 * 1024 * 1024,
  }
  const props = {
    remote,
    sessionId: SESSION,
    deployment,
    canStart: true,
    canSelect: true,
    canCancel: true,
    onClose: vi.fn(),
    t: makeTranslate(en),
  }
  const { rerender } = render(<Dialog {...props} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'PDF 1' }))
  fireEvent.click(screen.getByRole('button', { name: en.batchReview }))
  expect(screen.getByText(en.parseModePro)).toBeTruthy()
  const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Submit 1 PDFs to MinerU' })
  expect(submit.disabled).toBe(false)
  rerender(<Dialog {...props} deployment={{ ...deployment, error: 'Missing credential' }} />)
  expect(screen.getByRole('alert').textContent).toBe('Missing credential')
  expect(submit.disabled).toBe(true)
  rerender(<Dialog {...props} deployment={{ ...deployment, maxFileBytes: 0 }} />)
  expect(submit.disabled).toBe(true)
  rerender(<Dialog {...props} deployment={{ ...deployment, connected: false }} />)
  expect(screen.getByText(en.parseOffline)).toBeTruthy()
  expect(submit.disabled).toBe(true)
  rerender(<Dialog {...props} canStart={false} />)
  expect(submit.disabled).toBe(true)
  rerender(<Dialog {...props} canStart={false} canSelect={false} />)
  expect(screen.getByText(en.parsePermission)).toBeTruthy()
  expect(submit.isConnected).toBe(false)
  expect(remote.startBatchParse).not.toHaveBeenCalled()
})

it('surfaces a cancellation failure and then waits for a retried cancellation', async () => {
  const remote = maintenance()
  const batch: ZoteroBatchParseView = {
    operationId: CATALOG,
    state: 'running',
    total: 1,
    parsed: 0,
    reused: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  }
  const cancelling = deferred<Awaited<ReturnType<typeof remote.cancelBatchParse>>>()
  remote.batchParseStatus.mockResolvedValue({ ok: true, value: batch })
  remote.cancelBatchParse
    .mockReturnValueOnce(cancelling.promise)
    .mockImplementationOnce(async () => {
      const stopping = { ...batch, state: 'stopping' as const }
      remote.batchParseStatus
        .mockResolvedValueOnce({ ok: true, value: stopping })
        .mockResolvedValue({ ok: true, value: { ...batch, state: 'cancelled', skipped: 1 } })
      return { ok: true, value: stopping }
    })
  world({ maintenance: remote })
  fireEvent.click(screen.getByRole('button', { name: en.batchTitle }))
  const ui = within(await screen.findByRole('dialog', { name: en.batchTitle }))
  const cancel = await ui.findByRole<HTMLButtonElement>('button', { name: en.parseCancel })
  fireEvent.click(cancel)
  expect(cancel.disabled).toBe(true)
  cancelling.resolve({
    ok: false,
    error: new RemoteError('gateway/internal', 'Cannot cancel batch', {}),
  })
  await ui.findByText('Cannot cancel batch')
  fireEvent.click(cancel)
  await ui.findByText(en.parseStopping)
  expect(cancel.disabled).toBe(true)
  await ui.findByText(en.parseKilled, {}, { timeout: 2500 })
  expect(ui.queryByRole('button', { name: en.parseCancel })).toBeNull()
})

it('shows an empty library without offering an actionable selection', async () => {
  const remote = maintenance()
  const readCatalog = remote.batchPdfCatalog.getMockImplementation()!
  remote.batchPdfCatalog.mockImplementation((request, signal) =>
    request.kind === 'libraries'
      ? readCatalog(request, signal)
      : Promise.resolve({
          ok: true,
          value: { kind: 'pdfs', catalogId: CATALOG, rows: [], total: 0, matching: 0 },
        }),
  )
  world({ maintenance: remote })
  fireEvent.click(screen.getByRole('button', { name: en.batchTitle }))
  const ui = within(await screen.findByRole('dialog', { name: en.batchTitle }))
  await ui.findByText(en.batchEmpty)
  expect(ui.getByRole<HTMLButtonElement>('button', { name: en.batchReview }).disabled).toBe(true)
  expect(ui.getByRole<HTMLButtonElement>('button', { name: /Select all 0 PDFs/ }).disabled).toBe(
    true,
  )
})

it('returns to a fresh listing after an ambiguous submission and finds a batch completed offscreen', async () => {
  const remote = maintenance()
  remote.startBatchParse.mockResolvedValueOnce({
    ok: false,
    error: new RemoteError('gateway/internal', 'Connection lost', {}),
  })
  world({ maintenance: remote })
  const open = () => fireEvent.click(screen.getByRole('button', { name: en.batchTitle }))
  open()
  const ui = within(await screen.findByRole('dialog', { name: en.batchTitle }))
  fireEvent.click(await ui.findByRole('checkbox', { name: 'PDF 1' }))
  fireEvent.click(ui.getByRole('button', { name: en.batchReview }))
  fireEvent.click(ui.getByRole('button', { name: 'Submit 1 PDFs to MinerU' }))
  await ui.findByText('Connection lost')
  fireEvent.click(ui.getByRole('button', { name: en.batchBack }))
  const checkbox = await ui.findByRole<HTMLInputElement>('checkbox', { name: 'PDF 1' })
  expect(checkbox.checked).toBe(false)
  fireEvent.click(ui.getByText(en.parseClose, { selector: 'button' }))
  remote.batchParseStatus.mockResolvedValue({
    ok: true,
    value: {
      operationId: remote.startBatchParse.mock.calls[0]![0].operationId,
      state: 'completed',
      total: 1,
      parsed: 1,
      reused: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    },
  })
  open()
  await screen.findByText(en.parseCompleted)
  expect(screen.getByText(/1\/1 processed/)).toBeTruthy()
  expect(remote.startBatchParse).toHaveBeenCalledTimes(1)
})

it('discards an obsolete PDF page response when the user changes the title filter', async () => {
  const remote = maintenance()
  const stale = deferred<Awaited<ReturnType<typeof remote.batchPdfCatalog>>>()
  const started = deferred<AbortSignal | undefined>()
  const readCatalog = remote.batchPdfCatalog.getMockImplementation()!
  remote.batchPdfCatalog.mockImplementation((request, signal) => {
    if (request.kind === 'pdfs' && request.offset === 50) {
      started.resolve(signal)
      return stale.promise
    }
    return readCatalog(request, signal)
  })
  world({ maintenance: remote })
  fireEvent.click(screen.getByRole('button', { name: en.batchTitle }))
  const ui = within(await screen.findByRole('dialog', { name: en.batchTitle }))
  await ui.findByRole('checkbox', { name: 'PDF 1' })
  fireEvent.click(ui.getByRole('button', { name: en.batchNext }))
  const signal = await started.promise
  fireEvent.change(ui.getByRole('searchbox', { name: en.batchFind }), {
    target: { value: 'PDF 1' },
  })
  expect(signal?.aborted).toBe(true)
  await act(async () => {
    stale.resolve({
      ok: true,
      value: { kind: 'pdfs', catalogId: CATALOG, rows: [pdfs[50]!], total: 51, matching: 51 },
    })
    await stale.promise
  })
  expect(ui.queryByRole('checkbox', { name: 'PDF 51' })).toBeNull()
})
