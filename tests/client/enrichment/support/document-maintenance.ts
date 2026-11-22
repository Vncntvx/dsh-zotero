import { vi } from 'vitest'
import type {
  ZoteroBatchParseView,
  ZoteroDocumentMaintenanceRemote,
} from '../../../../src/contract.ts'

export const CATALOG = '62a78497-41ab-48bf-bbe4-5a89754006fb'
export const pdfs = Array.from({ length: 51 }, (_, index) => ({
  ref: `zotero://user/0/attachment/${String(index).padStart(8, '0')}?server=local`,
  title: `PDF ${index + 1}`,
  ...(index === 50 ? { authors: 'A. Li', venue: 'Journal of Hydrology', year: 2023 } : {}),
}))

export function maintenance() {
  let indexed = 2
  let rebuilt = false
  let batch: ZoteroBatchParseView | null = null
  return {
    parsedIndexStatus: vi.fn<ZoteroDocumentMaintenanceRemote['parsedIndexStatus']>(async () => ({
      ok: true,
      value: {
        indexed,
        total: 4,
        unreadable: 1,
        obsolete: 0,
        ...(rebuilt && { rebuild: { jobId: 'index-1', state: 'completed' } }),
      },
    })),
    rebuildParsedIndex: vi.fn<ZoteroDocumentMaintenanceRemote['rebuildParsedIndex']>(async () => {
      indexed = 4
      rebuilt = true
      return { ok: true, value: { jobId: 'index-1' } }
    }),
    batchPdfCatalog: vi.fn<ZoteroDocumentMaintenanceRemote['batchPdfCatalog']>(async (request) => ({
      ok: true,
      value:
        request.kind === 'libraries'
          ? {
              kind: 'libraries',
              libraries: [{ library: { type: 'user', id: 0 }, name: 'My Library' }],
            }
          : {
              kind: 'pdfs',
              catalogId: CATALOG,
              rows: pdfs.slice(request.offset, request.offset + 50),
              total: 51,
              matching: 51,
            },
    })),
    batchParseStatus: vi.fn<ZoteroDocumentMaintenanceRemote['batchParseStatus']>(async () => ({
      ok: true,
      value: batch,
    })),
    startBatchParse: vi.fn<ZoteroDocumentMaintenanceRemote['startBatchParse']>(async (request) => {
      batch = {
        operationId: request.operationId,
        state: 'running',
        total: 50,
        parsed: 0,
        reused: 0,
        failed: 0,
        skipped: 0,
        failures: [],
      }
      return { ok: true, value: batch }
    }),
    cancelBatchParse: vi.fn<ZoteroDocumentMaintenanceRemote['cancelBatchParse']>(),
  }
}
