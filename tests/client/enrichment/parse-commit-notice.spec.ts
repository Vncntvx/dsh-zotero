/** Completed explicit operations invalidate prepared resources exactly once per generation. */
import { afterEach, expect, it, vi } from 'vitest'
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import { createDocumentParseSurface } from '../../../src/client/enrichment/parse-surface.tsx'
import { fakeScope } from '../helpers/fake-scope.ts'
import {
  observable,
  parseJobs,
  parseReceipt,
  parseRemote,
  PARSE_SELECTION,
} from './support/parse-ports.ts'

const owned: Array<{ dispose(): void }> = []
afterEach(() => {
  for (const port of owned.splice(0)) port.dispose()
})
function fixture() {
  const remote = parseRemote()
  const committed = vi.fn()
  const port = createDocumentParseSurface(
    {
      remote: { zotero: remote },
      jobs: parseJobs().jobs,
      connection: { state: observable<ConnectionState>('connected') },
      configForms: {
        whileServed: (_namespaces, mount) => mount(new Set(['enrichment'])),
      },
    },
    {
      form: fakeScope(),
      onCommitted: committed,
      // The commit notice drives this fixture; the management endpoints stay
      // the real wire stubs the surface forwards to.
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
    },
  )
  owned.push(port)
  return { port, remote, committed }
}
const request = (operationId: string) => ({
  ...PARSE_SELECTION,
  operationId,
  action: 'parse' as const,
})

it('reports a terminal start response and coalesces its later receipt', async () => {
  const { port, remote, committed } = fixture()
  const receipt = parseReceipt()
  remote.startDocumentParse.mockResolvedValue({
    ok: true,
    value: {
      operationId: receipt.operationId,
      generation: receipt.generation,
      jobId: 'j1',
      status: 'completed',
      receipt,
    },
  })
  remote.documentParseReceipt.mockResolvedValue({ ok: true, value: { kind: 'completed', receipt } })
  await port.remote.startDocumentParse(request(receipt.operationId))
  await port.remote.documentParseReceipt({
    sessionId: PARSE_SELECTION.sessionId,
    operationId: receipt.operationId,
  })
  expect(committed).toHaveBeenCalledOnce()
  expect(committed).toHaveBeenCalledWith(PARSE_SELECTION.sessionId, PARSE_SELECTION.target)
})

it('ignores unknown receipts and late completions after disposal', async () => {
  const { port, remote, committed } = fixture()
  const receipt = parseReceipt()
  remote.documentParseReceipt.mockResolvedValue({ ok: true, value: { kind: 'completed', receipt } })
  await port.remote.documentParseReceipt({
    sessionId: PARSE_SELECTION.sessionId,
    operationId: 'unknown',
  })
  expect(committed).not.toHaveBeenCalled()
  await port.remote.startDocumentParse(request(receipt.operationId))
  port.dispose()
  await port.remote.documentParseReceipt({
    sessionId: PARSE_SELECTION.sessionId,
    operationId: receipt.operationId,
  })
  expect(committed).not.toHaveBeenCalled()
})

it('retains bounded generation deduplication while admitting later documents', async () => {
  const { port, remote, committed } = fixture()
  for (let index = 0; index < 130; index++) {
    const receipt = parseReceipt({ operationId: `op-${index}`, generation: `generation-${index}` })
    remote.startDocumentParse.mockResolvedValueOnce({
      ok: true,
      value: {
        operationId: receipt.operationId,
        generation: receipt.generation,
        jobId: `j${index}`,
        status: 'completed',
        receipt,
      },
    })
    await port.remote.startDocumentParse(request(receipt.operationId))
  }
  expect(committed).toHaveBeenCalledTimes(130)
})
