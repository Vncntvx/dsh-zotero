// @vitest-environment jsdom
/**
 * The enrichment section's model panel: status badge, download/verify/force
 * actions, progress, the component-unavailable note, and the data-egress
 * switch. Rendering-only; controller behavior lives in
 * enrichment-model-controller.spec.ts.
 * @module tests/client/enrichment/enrichment-model-form
 */

import { fireEvent } from '@testing-library/react'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from './support.tsx'
import { mountHarness, modelPortOf, zh } from './support.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('../helpers/primitives-stub.ts')
  const original = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return {
    ...original,
    ...(await primitivesWithRealForm(importOriginal)),
  }
})

afterEach(() => {
  cleanup()
})

describe('EnrichmentSettingsSection model panel', () => {
  it('renders model status badge and download button', () => {
    mountHarness()
    expect(screen.getByText(zh.semanticModelStatus)).toBeDefined()
    expect(screen.getByText(zh.semanticModelStatusNotDownloaded)).toBeDefined()
    expect(screen.getByRole('button', { name: zh.semanticModelDownloadAction })).toBeDefined()
  })

  it('triggers download when download button is clicked', async () => {
    const downloadSemanticModel = vi.fn(async () => ({
      ok: true as const,
      value: {
        success: true,
        model: 'balanced',
        status: 'started' as const,
        path: '/mock',
      },
    }))
    const port = modelPortOf({ downloadSemanticModel })
    mountHarness({}, 'page', port)

    const button = await screen.findByRole('button', { name: zh.semanticModelDownloadAction })
    fireEvent.click(button)
    await vi.waitFor(() => expect(downloadSemanticModel).toHaveBeenCalled())
  })

  it('sends force when the redownload button is used on a ready model', async () => {
    const downloadSemanticModel = vi.fn(async () => ({
      ok: true as const,
      value: { success: true, model: 'balanced', status: 'started' as const, path: '/mock' },
    }))
    const port = modelPortOf({
      semanticModelStatus: async () => ({
        ok: true as const,
        value: {
          model: 'balanced',
          ready: true,
          downloading: false,
          path: '/mock/path',
          downloadedBytes: 100,
          totalBytes: 100,
          percent: 100,
        },
      }),
      downloadSemanticModel,
    })
    mountHarness({}, 'page', port)
    const redownload = await screen.findByRole('button', { name: zh.semanticModelRedownloadAction })
    fireEvent.click(redownload)
    await vi.waitFor(() =>
      expect(downloadSemanticModel).toHaveBeenCalledWith(
        expect.objectContaining({ force: true }),
        expect.any(AbortSignal),
      ),
    )
  })

  it('renders the verify action on a ready model and shows its result', async () => {
    const verifySemanticModel = vi.fn(async () => ({
      ok: true as const,
      value: {
        model: 'balanced',
        ready: true,
        downloading: false,
        path: '/mock/path',
        downloadedBytes: 100,
        totalBytes: 100,
        percent: 100,
        error: undefined,
      },
    }))
    const port = modelPortOf({
      semanticModelStatus: async () => ({
        ok: true as const,
        value: {
          model: 'balanced',
          ready: true,
          downloading: false,
          path: '/mock/path',
          downloadedBytes: 100,
          totalBytes: 100,
          percent: 100,
        },
      }),
      verifySemanticModel,
    })
    mountHarness({}, 'page', port)
    const verify = await screen.findByRole('button', { name: zh.semanticModelVerifyAction })
    fireEvent.click(verify)
    await vi.waitFor(() => expect(verifySemanticModel).toHaveBeenCalled())
  })

  it('renders the component-unavailable note instead of download controls', async () => {
    mountHarness(
      {},
      'page',
      modelPortOf({
        semanticModelStatus: async () => ({
          ok: false as const,
          error: new RemoteError('gateway/service-unavailable', 'not composed', {
            endpoint: 'zotero/semanticModelStatus',
          }),
        }),
      }),
    )
    await vi.waitFor(() => {
      expect(screen.getByText(zh.semanticModelUnavailable)).toBeDefined()
    })
  })

  it('renders the data-egress switch for the MinerU upload authorization', () => {
    mountHarness({ value: { allowDocumentUpload: true } }, 'page')
    const toggle = screen.getByLabelText(zh.allowDocumentUpload) as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })

  it('renders downloading state with progress bar and cancel button', async () => {
    const cancelSemanticModelDownload = vi.fn(async () => ({
      ok: true as const,
      value: { cancelled: true },
    }))
    mountHarness(
      {},
      'page',
      modelPortOf({
        semanticModelStatus: async () => ({
          ok: true as const,
          value: {
            model: 'balanced',
            ready: false,
            downloading: true,
            path: '/mock/path',
            downloadedBytes: 45000000,
            totalBytes: 100000000,
            percent: 45,
            currentFile: 'onnx/model.onnx',
          },
        }),
        cancelSemanticModelDownload,
      }),
    )

    await vi.waitFor(() => {
      expect(screen.getByText(new RegExp(zh.semanticModelStatusDownloading))).toBeDefined()
    })
    expect(screen.getByRole('progressbar')).toBeDefined()
    expect(screen.getAllByText(/45%/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/onnx\/model\.onnx/)).toBeDefined()

    const cancelBtn = screen.getByRole('button', { name: zh.semanticModelCancelAction })
    fireEvent.click(cancelBtn)
    expect(cancelSemanticModelDownload).toHaveBeenCalled()
  })

  it('renders ready state with badge and re-download button', async () => {
    mountHarness(
      {},
      'page',
      modelPortOf({
        semanticModelStatus: async () => ({
          ok: true as const,
          value: {
            model: 'balanced',
            ready: true,
            downloading: false,
            path: '/mock/path',
            downloadedBytes: 100,
            totalBytes: 100,
            percent: 100,
          },
        }),
      }),
    )

    await vi.waitFor(() => {
      expect(screen.getByText(zh.semanticModelStatusReady)).toBeDefined()
    })
    const redownloadBtn = screen.getByRole('button', { name: zh.semanticModelRedownloadAction })
    expect(redownloadBtn).toBeDefined()
    fireEvent.click(redownloadBtn)
  })

  it('renders error message when present', async () => {
    mountHarness(
      {},
      'page',
      modelPortOf({
        semanticModelStatus: async () => ({
          ok: true as const,
          value: {
            model: 'balanced',
            ready: false,
            downloading: false,
            path: '',
            downloadedBytes: 0,
            totalBytes: 100,
            percent: 0,
            error: 'Connection reset by peer',
          },
        }),
      }),
    )

    await vi.waitFor(() => {
      expect(screen.getByText('Connection reset by peer')).toBeDefined()
    })
  })

  it('renders a warning box when semantic search is enabled but model is not downloaded', async () => {
    mountHarness(
      {
        value: {
          enableSemanticSearch: true,
        },
      },
      'page',
      modelPortOf({
        semanticModelStatus: async () => ({
          ok: true as const,
          value: {
            model: 'balanced',
            ready: false,
            downloading: false,
            path: '',
            downloadedBytes: 0,
            totalBytes: 100,
            percent: 0,
          },
        }),
      }),
    )

    await vi.waitFor(() => {
      expect(screen.getByText(zh.semanticModelNotReadyWarningTitle)).toBeDefined()
      expect(screen.getByText(zh.semanticModelNotReadyWarningTag)).toBeDefined()
      expect(screen.getByText(zh.semanticModelNotReadyWarningDesc)).toBeDefined()
      expect(screen.getByText(zh.semanticModelNotDownloadedWarningNotice)).toBeDefined()
    })
  })
})
