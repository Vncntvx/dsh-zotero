// @vitest-environment jsdom
/**
 * The enrichment section's model panel: status badge, download/verify/force
 * actions, progress, the component-unavailable note, and token masking.
 * Rendering-only; controller behavior lives in
 * enrichment-model-controller.spec.ts.
 * @module tests/client/enrichment/enrichment-model-form
 */

import { fireEvent } from '@testing-library/react'
import {
  semanticModelActionsOf,
  type EnrichmentFormActions,
  type SemanticModelActionInput,
} from '../../../src/client/EnrichmentSettingsForm.tsx'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ZoteroSemanticModelDeleteResultView } from '../../../src/contract.ts'
import { deferred } from '../../helpers/sync.js'
import { cleanup, screen } from './support.tsx'
import { mountHarness, modelPortOf, zh } from './support.tsx'

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

  it('masks a configured token, accepts a replacement, and keeps the MinerU link visible', async () => {
    mountHarness({}, 'page', undefined, {
      describe: async () => ({
        ok: true,
        value: { MINERU_API_TOKEN: { configured: true, writable: true } },
      }),
      set: async () => ({ ok: true, value: undefined }),
    })
    const input = screen.getByLabelText(zh.enrichmentToken) as HTMLInputElement
    await vi.waitFor(() => {
      expect(input.placeholder).toBe('************')
    })
    expect(input.value).toBe('')
    const link = screen.getByRole('link', { name: zh.enrichmentTokenVisitMineru })
    expect(link.getAttribute('href')).toBe('https://mineru.net')
    expect(screen.queryByText('向 MinerU 发送文档')).toBeNull()
    fireEvent.change(input, { target: { value: 'replacement-token' } })
    expect((screen.getByLabelText(zh.enrichmentToken) as HTMLInputElement).value).toBe(
      'replacement-token',
    )
  })

  it('asks for confirmation before deleting a ready model', async () => {
    const deleteSemanticModel = vi.fn(async () => ({
      ok: true as const,
      value: {
        success: true,
        model: 'balanced',
        path: '/mock/path',
        removed: true,
        removedFiles: 2,
        removedBytes: 10,
      },
    }))
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
        deleteSemanticModel,
      }),
    )
    const trigger = await screen.findByRole('button', { name: zh.semanticModelDeleteAction })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: zh.semanticModelDeleteTitle })).toBeDefined()
    expect(screen.getByText(zh.semanticModelDeleteDescription)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh.semanticModelDeleteCancel }))
    expect(deleteSemanticModel).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: zh.semanticModelDeleteConfirm }))
    await vi.waitFor(() => expect(deleteSemanticModel).toHaveBeenCalled())
  })

  it('offers delete for a failed bundle and shows the deleting phase', async () => {
    const deletion = deferred<RemoteResult<ZoteroSemanticModelDeleteResultView>>()
    const deleteSemanticModel = vi.fn(() => deletion.promise)
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
            path: '/mock/path',
            downloadedBytes: 3,
            totalBytes: 100,
            percent: 3,
            error: 'the commit marker is missing',
          },
        }),
        deleteSemanticModel,
      }),
    )
    const trigger = await screen.findByRole('button', { name: zh.semanticModelDeleteAction })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: zh.semanticModelDeleteConfirm }))
    expect(await screen.findByText(zh.semanticModelStatusDeleting)).toBeDefined()
    deletion.resolve({
      ok: true,
      value: {
        success: true,
        model: 'balanced',
        path: '/mock/path',
        removed: true,
        removedFiles: 3,
        removedBytes: 9,
      },
    })
    await vi.waitFor(() => expect(deleteSemanticModel).toHaveBeenCalled())
  })

  it('keeps download, redownload, and verify available for a failed bundle', async () => {
    const downloadSemanticModel = vi.fn(async () => ({
      ok: true as const,
      value: { success: true, model: 'balanced', status: 'started' as const, path: '/mock/path' },
    }))
    const verifySemanticModel = vi.fn(async () => ({
      ok: true as const,
      value: {
        model: 'balanced',
        ready: false,
        downloading: false,
        path: '/mock/path',
        downloadedBytes: 3,
        totalBytes: 100,
        percent: 3,
        error: 'the commit marker is missing',
      },
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
            downloading: false,
            path: '/mock/path',
            downloadedBytes: 3,
            totalBytes: 100,
            percent: 3,
            error: 'the commit marker is missing',
          },
        }),
        downloadSemanticModel,
        verifySemanticModel,
      }),
    )
    await screen.findByRole('button', { name: zh.semanticModelDeleteAction })
    fireEvent.click(screen.getByRole('button', { name: zh.semanticModelDownloadAction }))
    await vi.waitFor(() => expect(downloadSemanticModel).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole('button', { name: zh.semanticModelRedownloadAction }))
    await vi.waitFor(() => expect(downloadSemanticModel).toHaveBeenCalledTimes(2))
    fireEvent.click(await screen.findByRole('button', { name: zh.semanticModelVerifyAction }))
    await vi.waitFor(() => expect(verifySemanticModel).toHaveBeenCalledTimes(1))
  })

  it('shows the downloading notice in the semantic warning box', async () => {
    mountHarness(
      { value: { enableSemanticSearch: true } },
      'page',
      modelPortOf({
        semanticModelStatus: async () => ({
          ok: true as const,
          value: {
            model: 'balanced',
            ready: false,
            downloading: true,
            path: '/mock/path',
            downloadedBytes: 10,
            totalBytes: 100,
            percent: 10,
            currentFile: 'onnx/model.onnx',
          },
        }),
      }),
    )
    await vi.waitFor(() => {
      expect(screen.getByText(zh.semanticModelDownloadingNotice)).toBeDefined()
    })
  })

  it('offers no delete action for a model that was never downloaded', async () => {
    mountHarness()
    expect(screen.queryByRole('button', { name: zh.semanticModelDeleteAction })).toBeNull()
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

describe('the semantic model action table', () => {
  const input: SemanticModelActionInput = {
    downloading: false,
    ready: false,
    failed: false,
    canDelete: true,
    disabled: false,
    checking: false,
    cancelling: false,
    deleting: false,
    actions: {} as EnrichmentFormActions,
    confirmDelete: () => {},
  }

  const idsOf = (overrides: Partial<SemanticModelActionInput>): string[] =>
    semanticModelActionsOf({ ...input, ...overrides }).map((action) => action.id)

  it('offers cancel alone while a download runs', () => {
    expect(idsOf({ downloading: true })).toEqual(['cancel'])
  })

  it('offers verify, redownload and delete for a ready bundle', () => {
    expect(idsOf({ ready: true })).toEqual(['verify', 'redownload', 'delete'])
    expect(idsOf({ ready: true, canDelete: false })).toEqual(['verify', 'redownload'])
  })

  it('adds download for a failed bundle', () => {
    expect(idsOf({ failed: true })).toEqual(['download', 'redownload', 'verify', 'delete'])
    expect(idsOf({ failed: true, canDelete: false })).toEqual(['download', 'redownload', 'verify'])
  })

  it('offers download alone before the first download', () => {
    expect(idsOf({})).toEqual(['download'])
  })

  it('disables delete while a verification holds the model', () => {
    const actions = semanticModelActionsOf({ ...input, ready: true, checking: true })
    expect(actions.find((action) => action.id === 'delete')?.disabled).toBe(true)
    expect(actions.find((action) => action.id === 'verify')?.disabled).toBe(true)
  })
})
