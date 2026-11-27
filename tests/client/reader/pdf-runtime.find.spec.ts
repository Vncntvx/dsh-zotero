// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { bytes, host, lifetime, pdf, sawPage } from './support/pdf-runtime.ts'
import { mountPdf, type PdfFindStatus } from '../../../src/client/reader/pdf-runtime.ts'

it('reports PDF search progress, result counts, and misses from the viewer', async () => {
  const onFindStatus = vi.fn<(status: PdfFindStatus) => void>()
  const controls = await mountPdf(host, bytes, lifetime.signal, sawPage, undefined, {
    onFindStatus,
  })
  pdf.bus?.dispatch('updatefindcontrolstate', {
    state: 3,
    matchesCount: { current: 0, total: 0 },
  })
  expect(onFindStatus).toHaveBeenLastCalledWith({ state: 'pending', current: 0, total: 0 })
  pdf.bus?.dispatch('updatefindmatchescount', {
    matchesCount: { current: 2, total: 5 },
  })
  expect(onFindStatus).toHaveBeenLastCalledWith({ current: 2, total: 5 })
  pdf.bus?.dispatch('updatefindcontrolstate', {
    state: 1,
    matchesCount: { current: 0, total: 0 },
  })
  expect(onFindStatus).toHaveBeenLastCalledWith({ state: 'not-found', current: 0, total: 0 })
  await controls.dispose()
  const calls = onFindStatus.mock.calls.length
  pdf.bus?.dispatch('updatefindmatchescount', {
    matchesCount: { current: 1, total: 1 },
  })
  expect(onFindStatus).toHaveBeenCalledTimes(calls)
})
