// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { mountPanel, searchPage } from '../helpers/library-panel-harness.tsx'
import type { DocumentParseSurfacePort } from '../../../src/client/enrichment/parse-surface.tsx'
import { zh } from '../../../src/client/locales.ts'

afterEach(cleanup)

it('renders stacked PDF and MD badges when an item has a parsed artifact', async () => {
  const documentArtifact = vi.fn(async (request: { op: string; refs?: readonly string[] }) =>
    request.op === 'probe'
      ? {
          ok: true as const,
          value: {
            kind: 'probed' as const,
            results: (request.refs ?? []).map((ref) => ({ ref, state: 'ready' as const })),
          },
        }
      : { ok: true as const, value: { kind: 'ready' } },
  )
  const deploymentSnapshot = {
    mounted: true,
    connected: true,
    mode: 'local' as const,
    revision: 0,
    maxFileBytes: 1000,
    maxPages: 100,
  }
  mountPanel(
    {
      search: vi.fn(async () => ({
        ok: true,
        value: searchPage({
          items: [
            {
              ref: 'zotero://user/0/item/ITEM0001',
              title: 'Parsed Paper',
              creatorSummary: 'Author',
              year: 2024,
              itemType: 'journalArticle',
              bestAttachmentType: 'application/pdf',
              bestAttachmentRef: 'zotero://user/0/attachment/ATT0001',
            },
          ],
        }),
      })),
    },
    undefined,
    {
      parse: {
        remote: { documentArtifact } as unknown as DocumentParseSurfacePort['remote'],
        jobs: {} as DocumentParseSurfacePort['jobs'],
        deployment: {
          getSnapshot: () => deploymentSnapshot,
          subscribe: () => () => {},
        } as unknown as DocumentParseSurfacePort['deployment'],
        management: {
          listParsedDocuments: async () => ({
            ok: true as const,
            value: { rows: [], total: 0 },
          }),
          discardParsedDocument: async () => ({
            ok: true as const,
            value: { kind: 'discarded' as const, removedAliases: 0, removedReceipts: 0 },
          }),
        },
        recall: () => undefined,
        recentUrl: () => undefined,
        clearSession: () => {},
      },
    },
  )

  expect(await screen.findByText('Parsed Paper')).toBeTruthy()
  expect(await screen.findByText(zh.badgePdf)).toBeTruthy()
  expect(await screen.findByText(zh.badgeMarkdown)).toBeTruthy()
})
