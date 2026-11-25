// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ZoteroRemoteContract } from '../../../src/contract.ts'
import { DEFAULT_JOURNAL_METRIC_LIST } from '../../../src/journal-metrics.ts'
import { createLibraryPreferenceSource } from '../../../src/client/library-preferences.tsx'
import { zh } from '../../../src/client/locales.ts'
import { deferred } from '../../helpers/sync.ts'
import { fakeScope } from '../helpers/fake-scope.ts'
import { ITEM_DETAIL, mountPanel, searchPage } from '../helpers/library-panel-harness.tsx'
import { zoteroClientStub } from '../helpers/zotero-client.ts'
import libraryCss from '../../../src/client/components/library/library.module.css'

const journal = 'Sample Journal & Science'
const metrics = {
  status: 'ready',
  fetchedAt: Date.UTC(2024, 0, 1),
  official: [
    { field: 'sci', value: 'Q1' },
    { field: 'sciif', value: '5.2' },
    { field: 'ccf', value: 'B' },
  ],
  custom: [{ id: '1', label: 'DUFE', value: 'A' }],
} as const
const fixtures = () => ({
  search: vi.fn(async () => ({
    ok: true,
    value: searchPage({
      items: searchPage().items.map((item) => ({
        ...item,
        itemType: 'journalArticle',
        publicationTitle: journal,
      })),
    }),
  })),
  item: vi.fn(async () => ({
    ok: true,
    value: {
      ...ITEM_DETAIL,
      itemType: 'journalArticle',
      date: '2020-11',
      publicationTitle: journal as string | undefined,
    },
  })),
})

beforeEach(() => localStorage.clear())
afterEach(cleanup)

it('updates list and information metrics independently without new queries', async () => {
  const key = deferred<Awaited<ReturnType<ZoteroRemoteContract['journalMetrics']>>>()
  const read = vi.fn<ZoteroRemoteContract['journalMetrics']>(() => key.promise)
  const settings = fakeScope({ value: { journalMetricsEnabled: true } })
  const source = createLibraryPreferenceSource(settings, fakeScope())
  const { view } = mountPanel(fixtures(), undefined, {
    preferenceSource: source,
    journalMetrics: read,
  })
  const title = await screen.findByText('FlashAttention-2')
  expect(screen.queryByText('JCR Q1')).toBeNull()
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  await act(async () => key.resolve({ ok: true, value: metrics }))
  expect(screen.getAllByText('JCR Q1')).toHaveLength(2)
  fireEvent.click(title)
  const info = await screen.findByRole('region', { name: zh.libraryInfoTitle })
  const details = within(info)
  expect(details.queryByText('DUFE')).toBeNull()
  expect(details.queryByText('CCF')).toBeNull()
  expect(details.getByText(zh['journalMetric.sciif']).closest('dl')).toBe(
    details.getByText(zh.libraryMetaDate).closest('dl'),
  )
  expect(details.queryByText(zh.journalMetrics)).toBeNull()
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  act(() =>
    settings.publish({ value: { journalMetricsEnabled: true, journalMetricListOrder: ['ccf'] } }),
  )
  expect(screen.getAllByText('CCF B')).toHaveLength(2)
  expect(screen.queryByText('JCR Q1')).toBeNull()
  act(() =>
    settings.publish({
      value: {
        journalMetricsEnabled: true,
        journalMetricListOrder: ['ccf'],
        journalMetricDetailFields: ['custom', 'ccf', 'sci'],
      },
    }),
  )
  const terms = details.getAllByRole('term').map((term) => term.textContent)
  expect(terms.slice(-3)).toEqual([zh['journalMetric.sci'], zh['journalMetric.ccf'], 'DUFE'])
  expect(details.queryByText(zh['journalMetric.sciif'])).toBeNull()
  expect(screen.getAllByText('CCF B')).toHaveLength(2)
  expect(read).toHaveBeenCalledTimes(2)
  view.unmount()
  source.dispose()
})

it('skips page lookups with empty presets and still queries enabled details', async () => {
  const read = vi.fn<ZoteroRemoteContract['journalMetrics']>(async () => ({
    ok: true,
    value: metrics,
  }))
  const journalMetricListOrder = {
    ...DEFAULT_JOURNAL_METRIC_LIST,
    international: [],
    chineseCore: [],
  }
  const value = { journalMetricsEnabled: true, journalMetricListOrder }
  const settings = fakeScope({ value: { ...value, journalMetricDetailFields: [] } })
  const source = createLibraryPreferenceSource(settings, fakeScope())
  const { view } = mountPanel(fixtures(), undefined, {
    preferenceSource: source,
    journalMetrics: read,
  })
  try {
    const item = await screen.findByText('FlashAttention-2')
    expect(read).not.toHaveBeenCalled()
    act(() => settings.publish({ value: { ...value, journalMetricDetailFields: ['sci'] } }))
    fireEvent.click(item)
    await screen.findByText('Q1', { exact: true })
    expect(read.mock.calls.map(([request]) => request)).toEqual([
      { publicationName: journal, priority: 'detail' },
    ])
  } finally {
    view.unmount()
    source.dispose()
  }
})

it('starts when enabled and discards the previous generation when the key rotates or lookup is disabled', async () => {
  const old = deferred<Awaited<ReturnType<ZoteroRemoteContract['journalMetrics']>>>()
  const next = deferred<Awaited<ReturnType<ZoteroRemoteContract['journalMetrics']>>>()
  const read = vi
    .fn<ZoteroRemoteContract['journalMetrics']>()
    .mockReturnValueOnce(old.promise)
    .mockReturnValue(next.promise)
  const settings = fakeScope({ value: {} })
  const source = createLibraryPreferenceSource(settings, fakeScope())
  const { view } = mountPanel(fixtures(), undefined, {
    preferenceSource: source,
    journalMetrics: read,
  })
  await screen.findByText('FlashAttention-2')
  expect(read).not.toHaveBeenCalled()
  act(() => settings.publish({ value: { journalMetricsEnabled: true } }))
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  act(() => source.journalCredentialChanged('EASYSCHOLAR_SECRET_KEY'))
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  expect(read.mock.calls[0]?.[1]?.aborted).toBe(true)
  await act(async () => old.resolve({ ok: true, value: metrics }))
  expect(screen.queryByText('JCR Q1')).toBeNull()
  await act(async () => next.resolve({ ok: true, value: metrics }))
  expect(screen.getAllByText('JCR Q1')).toHaveLength(2)
  act(() => settings.publish({ value: { journalMetricsEnabled: false } }))
  expect(screen.queryByText('JCR Q1')).toBeNull()
  view.unmount()
  source.dispose()
})

it('looks up journals without results when a new metric is saved', async () => {
  const otherJournal = 'Another Journal'
  const data = fixtures()
  data.search.mockResolvedValue({
    ok: true,
    value: searchPage({
      items: searchPage().items.map((item, index) => ({
        ...item,
        itemType: 'journalArticle',
        publicationTitle: index === 0 ? journal : otherJournal,
      })),
    }),
  })
  const read = vi
    .fn<ZoteroRemoteContract['journalMetrics']>()
    .mockImplementation(async ({ publicationName }) => ({
      ok: true,
      value: publicationName === journal ? metrics : { status: 'unavailable' },
    }))
  const settings = fakeScope({ value: { journalMetricsEnabled: true } })
  const source = createLibraryPreferenceSource(settings, fakeScope())
  const notifySurface = vi.fn()
  const client = zoteroClientStub({ notifySurface })
  const { view } = mountPanel(data, undefined, {
    preferenceSource: source,
    journalMetrics: read,
    useZoteroClient: () => client,
  })
  try {
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(screen.getByText('JCR Q1')).toBeTruthy()
    expect(notifySurface).not.toHaveBeenCalled()
    const list = within(screen.getByRole('region', { name: zh.libraryItemList }))
    expect(list.queryByRole('status')).toBeNull()
    expect(list.queryByRole('button', { name: zh.libraryRetry })).toBeNull()
    read.mockClear()
    read.mockResolvedValue({ ok: true, value: metrics })
    act(() =>
      settings.publish({
        value: {
          journalMetricsEnabled: true,
          journalMetricDetailFields: ['sci', 'sciif', 'sciUp', 'ccf'],
        },
      }),
    )
    await waitFor(() => expect(screen.getAllByText('JCR Q1')).toHaveLength(2))
    expect(read).toHaveBeenCalledExactlyOnceWith(
      { publicationName: otherJournal, priority: 'list' },
      expect.any(AbortSignal),
    )
  } finally {
    view.unmount()
    source.dispose()
  }
})

it('notifies when the key is missing and resumes when it is saved', async () => {
  const read = vi
    .fn<ZoteroRemoteContract['journalMetrics']>()
    .mockResolvedValueOnce({ ok: true, value: { status: 'credential' } })
    .mockResolvedValue({ ok: true, value: metrics })
  const settings = fakeScope({ value: { journalMetricsEnabled: true } })
  const source = createLibraryPreferenceSource(settings, fakeScope())
  const notifySurface = vi.fn()
  const client = zoteroClientStub({ notifySurface })
  const { view } = mountPanel(fixtures(), undefined, {
    preferenceSource: source,
    journalMetrics: read,
    useZoteroClient: () => client,
  })
  await waitFor(() =>
    expect(notifySurface).toHaveBeenCalledExactlyOnceWith(zh.journalMetricsCredential),
  )
  expect(screen.queryByText(zh.journalMetricsCredential)).toBeNull()
  act(() => source.journalCredentialChanged('EASYSCHOLAR_SECRET_KEY'))
  await waitFor(() => expect(screen.getAllByText('JCR Q1')).toHaveLength(2))
  view.unmount()
  source.dispose()
})

it('keeps Zotero details available while metrics are unavailable and supports retry', async () => {
  const read = vi
    .fn<ZoteroRemoteContract['journalMetrics']>()
    .mockResolvedValue({ ok: true, value: { status: 'rateLimited' } })
  const settings = fakeScope({ value: { journalMetricsEnabled: true } })
  const source = createLibraryPreferenceSource(settings, fakeScope())
  const { view } = mountPanel(fixtures(), undefined, {
    preferenceSource: source,
    journalMetrics: read,
  })
  fireEvent.click(await screen.findByText('FlashAttention-2'))
  const detail = await screen.findByRole('region', { name: zh.libraryInfoTitle })
  const retry = await within(detail).findByRole('button', { name: zh.journalMetricsRetry })
  const message = within(detail).getByText(zh.journalMetricsRateLimited)
  expect(retry.closest('dd')).toBe(message.closest('dd'))
  const response = deferred<Awaited<ReturnType<ZoteroRemoteContract['journalMetrics']>>>()
  read.mockReturnValue(response.promise)
  fireEvent.click(retry)
  expect((retry as HTMLButtonElement).disabled).toBe(true)
  await act(async () => response.resolve({ ok: true, value: metrics }))
  await waitFor(() => expect(within(detail).getByText(zh['journalMetric.sci'])).toBeTruthy())
  view.unmount()
  source.dispose()
})

it('refreshes the open panel and shows saved metrics alongside a refresh failure', async () => {
  const read = vi.fn<ZoteroRemoteContract['journalMetrics']>().mockResolvedValue({
    ok: true,
    value: metrics,
  })
  const source = createLibraryPreferenceSource(
    fakeScope({ value: { journalMetricsEnabled: true } }),
    fakeScope(),
  )
  const notifySurface = vi.fn()
  const client = zoteroClientStub({ notifySurface })
  const { view } = mountPanel(fixtures(), undefined, {
    preferenceSource: source,
    journalMetrics: read,
    useZoteroClient: () => client,
  })
  try {
    fireEvent.click(await screen.findByText('FlashAttention-2'))
    const info = within(await screen.findByRole('region', { name: zh.libraryInfoTitle }))
    await info.findByText(zh['journalMetric.sci'])
    read.mockResolvedValue({ ok: true, value: { ...metrics, refreshFailure: 'quotaExceeded' } })
    act(() => source.journalRefreshFinished())
    expect(await info.findByText(zh.journalMetricsQuotaExceeded)).toBeTruthy()
    expect(info.getByText('Q1')).toBeTruthy()
    expect(screen.getAllByText('JCR Q1')).toHaveLength(2)
    expect(notifySurface).toHaveBeenCalledExactlyOnceWith(zh.journalMetricsQuotaExceeded)
  } finally {
    view.unmount()
    source.dispose()
  }
})

it('notifies once about quota and retries only the selected journal', async () => {
  const read = vi.fn<ZoteroRemoteContract['journalMetrics']>().mockResolvedValue({
    ok: true,
    value: { status: 'quotaExceeded' },
  })
  const settings = fakeScope({ value: { journalMetricsEnabled: true } })
  const source = createLibraryPreferenceSource(settings, fakeScope())
  const notifySurface = vi.fn()
  const client = zoteroClientStub({ notifySurface })
  const { view } = mountPanel(fixtures(), undefined, {
    preferenceSource: source,
    journalMetrics: read,
    useZoteroClient: () => client,
  })
  try {
    await waitFor(() =>
      expect(notifySurface).toHaveBeenCalledExactlyOnceWith(zh.journalMetricsQuotaExceeded),
    )
    expect(screen.queryByText(zh.journalMetricsQuotaExceeded)).toBeNull()
    fireEvent.click(screen.getByText('FlashAttention-2'))
    const section = await screen.findByRole('region', { name: zh.libraryInfoTitle })
    expect(await within(section).findByText(zh.journalMetricsQuotaExceeded)).toBeTruthy()
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    read.mockClear()
    fireEvent.click(within(section).getByRole('button', { name: zh.journalMetricsRetry }))
    await waitFor(() =>
      expect(read).toHaveBeenCalledExactlyOnceWith(
        { publicationName: journal, priority: 'detail' },
        expect.any(AbortSignal),
      ),
    )
    expect(notifySurface).toHaveBeenCalledTimes(1)
  } finally {
    view.unmount()
    source.dispose()
  }
})

it.each([
  { name: 'empty response', official: [] },
  { name: 'unconfigured metrics', official: [{ field: 'futureMetric', value: 'A' }] },
])('omits the metrics row for $name', async ({ official }) => {
  const ready = deferred<Awaited<ReturnType<ZoteroRemoteContract['journalMetrics']>>>()
  const read = vi.fn<ZoteroRemoteContract['journalMetrics']>(() => ready.promise)
  const settings = fakeScope({ value: { journalMetricsEnabled: true } })
  const source = createLibraryPreferenceSource(settings, fakeScope())
  const { view } = mountPanel(fixtures(), undefined, {
    preferenceSource: source,
    journalMetrics: read,
  })
  try {
    const title = await screen.findByText('FlashAttention-2')
    const row = title.closest('button')
    expect(row?.querySelector(`.${libraryCss.journalSummary}`)).toBeNull()
    await act(async () => ready.resolve({ ok: true, value: { ...metrics, official, custom: [] } }))
    expect(row?.querySelector(`.${libraryCss.journalSummary}`)).toBeNull()
    fireEvent.click(title)
    expect(
      within(await screen.findByRole('region', { name: zh.libraryInfoTitle })).queryByText(
        zh.journalMetrics,
      ),
    ).toBeNull()
  } finally {
    view.unmount()
    source.dispose()
  }
})

it.each([
  [
    'credential error',
    async () => ({ ok: true as const, value: { status: 'credential' as const } }),
    zh.journalMetricsCredential,
  ],
  [
    'provider rejection',
    async () => ({ ok: true as const, value: { status: 'requestRejected' as const } }),
    zh.journalMetricsRequestRejected,
  ],
  [
    'provider format error',
    async () => ({ ok: true as const, value: { status: 'invalidResponse' as const } }),
    zh.journalMetricsInvalidResponse,
  ],
  [
    'transport failure',
    async () => Promise.reject(new Error('offline')),
    zh.journalMetricsUnavailable,
  ],
] as const)('shows %s distinctly in the inspector', async (_name, result, message) => {
  const settings = fakeScope({ value: { journalMetricsEnabled: true } })
  const source = createLibraryPreferenceSource(settings, fakeScope())
  const { view } = mountPanel(fixtures(), undefined, {
    preferenceSource: source,
    journalMetrics: result,
  })
  try {
    fireEvent.click(await screen.findByText('FlashAttention-2'))
    const section = await screen.findByRole('region', { name: zh.libraryInfoTitle })
    expect(await within(section).findByText(message)).toBeTruthy()
  } finally {
    view.unmount()
    source.dispose()
  }
})
