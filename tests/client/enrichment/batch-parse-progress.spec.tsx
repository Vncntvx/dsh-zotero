// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroBatchParseView } from '../../../src/contract.ts'
import { en } from '../../../src/client/locales.ts'
import { CATALOG, maintenance, pdfs } from './support/document-maintenance.ts'
import { SESSION, world } from './support/parsed-manager-world.tsx'

afterEach(cleanup)

it('reopens a running batch, cancels, pages failures, and can start a new selection', async () => {
  const remote = maintenance()
  const operationId = CATALOG
  const summary = { operationId, total: 51, parsed: 2, reused: 1, failed: 26, skipped: 0 }
  let state: ZoteroBatchParseView['state'] = 'running'
  const view = (offset: number): ZoteroBatchParseView => ({
    ...summary,
    state,
    skipped: state === 'cancelled' ? 22 : 0,
    ...(state === 'running' ? { current: pdfs[50] } : {}),
    failures: pdfs
      .slice(offset, Math.min(26, offset + 25))
      .map((target) => ({ target, code: 'parse', message: 'Missing PDF' })),
  })
  remote.batchParseStatus.mockImplementation(async ({ offset }) => ({
    ok: true,
    value: view(offset),
  }))
  remote.cancelBatchParse.mockImplementation(async () => {
    state = 'cancelled'
    return { ok: true, value: view(0) }
  })
  world({ maintenance: remote })
  function open() {
    fireEvent.click(screen.getByRole('button', { name: en.batchTitle }))
    return within(screen.getByRole('dialog', { name: en.batchTitle }))
  }
  const first = open()
  await first.findByText('Processing PDF 51')
  fireEvent.click(first.getByText(en.parseClose, { selector: 'button' }))
  fireEvent.click(screen.getByRole('button', { name: en.batchViewProgress }))
  const ui = within(screen.getByRole('dialog', { name: en.batchTitle }))
  await ui.findByText('Processing PDF 51')
  fireEvent.click(ui.getByRole('button', { name: en.parseCancel }))
  await ui.findByText(en.parseKilled)
  expect(remote.cancelBatchParse).toHaveBeenCalledWith({ sessionId: SESSION, operationId })
  fireEvent.click(ui.getByRole('button', { name: en.batchNext }))
  await ui.findByText('PDF 26 · Missing PDF')
  fireEvent.click(ui.getByRole('button', { name: en.batchNew }))
  await ui.findByRole('checkbox', { name: 'PDF 1' })
  expect(remote.startBatchParse).not.toHaveBeenCalled()
})

it('updates batch progress with the dialog closed and refreshes the document list on completion', async () => {
  const remote = maintenance()
  const summary = {
    operationId: CATALOG,
    state: 'running' as const,
    total: 4,
    parsed: 0,
    reused: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  }
  remote.batchParseStatus
    .mockResolvedValueOnce({ ok: true, value: summary })
    .mockResolvedValueOnce({ ok: true, value: { ...summary, parsed: 1, reused: 1 } })
    .mockResolvedValue({
      ok: true,
      value: { ...summary, state: 'completed', parsed: 3, reused: 1 },
    })
  const { management } = world({ maintenance: remote })
  const view = within(await screen.findByRole('region', { name: en.batchProgress }))
  expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
  await view.findByText('Batch parsing · 2/4 processed', {}, { timeout: 3000 })
  expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2')
  const dialog = screen.queryByRole('dialog', { name: en.batchTitle })
  expect(dialog).toBeNull()
  await vi.waitFor(
    () => {
      expect(screen.queryByRole('region', { name: en.batchProgress })).toBeNull()
      expect(management.listParsedDocuments).toHaveBeenCalledTimes(2)
    },
    { timeout: 3000 },
  )
})

it('retains the last progress count when status reads fail and retries from the toolbar', async () => {
  const remote = maintenance()
  const batch = {
    operationId: CATALOG,
    state: 'running' as const,
    total: 4,
    parsed: 1,
    reused: 1,
    failed: 0,
    skipped: 0,
    failures: [],
  }
  remote.batchParseStatus
    .mockResolvedValueOnce({ ok: true, value: batch })
    .mockResolvedValueOnce({
      ok: false,
      error: new RemoteError('gateway/internal', 'Disconnected', {}),
    })
    .mockResolvedValue({ ok: true, value: { ...batch, parsed: 2 } })
  world({ maintenance: remote })
  const view = within(await screen.findByRole('region', { name: en.batchProgress }))
  await view.findByText(en.batchProgressPaused, {}, { timeout: 3000 })
  expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2')
  fireEvent.click(screen.getByRole('button', { name: en.parsedManagerRefresh }))
  await view.findByText('Batch parsing · 3/4 processed')
})
