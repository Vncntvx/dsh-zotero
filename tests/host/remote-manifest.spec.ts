/** Host and client wire descriptors must expose the same Zotero methods. */
import { describe, expect, it } from 'vitest'
import { ZOTERO_STATUS_SERVICE_KEY } from '../../src/contract.js'
import { TYPERT_MANIFEST } from '../../src/typert.js'
import { setupHostLane } from '../helpers/lanes/host-lane.js'
import { statusView } from '../helpers/status-view.ts'

describe('the zotero typert manifest', () => {
  it('declares the status endpoint under the zotero namespace', () => {
    expect(TYPERT_MANIFEST.package).toBe('dsh-zotero')
    expect(TYPERT_MANIFEST.face).toBe('host')
    expect(TYPERT_MANIFEST.invocations.map((invocation) => invocation.method)).toEqual([
      'parsedIndexStatus',
      'rebuildParsedIndex',
      'batchPdfCatalog',
      'startBatchParse',
      'batchParseStatus',
      'cancelBatchParse',
      'startDocumentParse',
      'documentArtifact',
      'documentParseReceipt',
      'listParsedDocuments',
      'discardParsedDocument',
      'semanticModelStatus',
      'downloadSemanticModel',
      'cancelSemanticModelDownload',
      'deleteSemanticModel',
      'verifySemanticModel',
      'sourcePage',
      'releaseUrlPdf',
      'readUrlPdf',
      'journalMetrics',
      'refreshJournalMetrics',
      'status',
      'resolveAttachment',
      'diagnostics',
      'reportClientError',
      'openProtocol',
      'revokeWriteGrant',
      'collectionPath',
      'browse',
      'search',
      'item',
      'childPage',
      'readerAnnotations',
      'readerDetails',
      'readerNote',
      'readerTranslate',
      'readerSuggestAnnotation',
      'readerWriteNote',
      'readerUpdateAnnotation',
      'readerCreateAnnotations',
      'readerDeleteAnnotation',
      'export',
      'write',
    ])
    for (const invocation of TYPERT_MANIFEST.invocations) {
      expect(invocation.namespace).toBe('zotero')
      if (
        [
          'readerAnnotations',
          'readerDetails',
          'readerNote',
          'readerTranslate',
          'readerSuggestAnnotation',
          'readerWriteNote',
          'readerUpdateAnnotation',
          'readerCreateAnnotations',
          'readerDeleteAnnotation',
        ].includes(invocation.method)
      ) {
        expect(invocation.service).toBe('reader')
      } else if (
        [
          'releaseUrlPdf',
          'readUrlPdf',
          'journalMetrics',
          'refreshJournalMetrics',
          'collectionPath',
          'browse',
          'search',
          'item',
          'childPage',
          'export',
          'write',
        ].includes(invocation.method)
      ) {
        expect(invocation.service).toBe('zoteroLibrary')
      } else if (
        [
          'parsedIndexStatus',
          'rebuildParsedIndex',
          'batchPdfCatalog',
          'startBatchParse',
          'batchParseStatus',
          'cancelBatchParse',
          'startDocumentParse',
          'documentArtifact',
          'documentParseReceipt',
          'listParsedDocuments',
          'discardParsedDocument',
          'semanticModelStatus',
          'downloadSemanticModel',
          'cancelSemanticModelDownload',
          'deleteSemanticModel',
          'verifySemanticModel',
        ].includes(invocation.method)
      ) {
        // The model endpoints answer from the enrichment component, so the
        // capability exists exactly as long as the row is composed.
        expect(invocation.service).toBe('enrichment')
      } else {
        expect(invocation.service).toBe('zoteroRemote')
      }
    }
    const status = TYPERT_MANIFEST.invocations.find((invocation) => invocation.method === 'status')
    expect(status?.result).toMatchObject({
      mode: 'strict',
      typeSymbol: 'dsh-zotero#ZoteroStatusView',
    })
    // Strict codecs carry a lazy factory (TypertCodec.create).
    expect(typeof (status?.result as { create?: unknown } | undefined)?.create).toBe('function')
  })

  it('declares exactly the methods the client contribution mounts', async () => {
    // The host manifest and the browser contribution are two spellings of one
    // endpoint set. Each method is cross-checked below by identity, but that
    // per-method shape would still pass if a method were added to only one
    // side: the set itself is asserted here.
    const { ZOTERO_REMOTE } = await import('../../src/client/remote.ts')
    const hostMethods = TYPERT_MANIFEST.invocations.map((invocation) => invocation.method)
    const clientMethods = ZOTERO_REMOTE.descriptors.map((descriptor) => descriptor.method)
    expect(clientMethods).toEqual(hostMethods)
  })

  it('materializes the host status schema through create()', () => {
    const status = TYPERT_MANIFEST.invocations.find((invocation) => invocation.method === 'status')
    const result = status?.result as
      { create: () => { parse: (value: unknown) => unknown } } | undefined
    expect(result).toBeDefined()
    const schema = result!.create()
    // `diagnosis` is optional on the wire: a connected view carries none, and
    // absence must parse rather than fall over the strict object.
    const valid = schema.parse(statusView())
    expect(valid).toEqual(statusView())
    // A failure view keeps its code-bearing string.
    const failed = schema.parse(
      statusView({ connected: false, diagnosis: 'ZOTERO_NOT_RUNNING: down' }),
    )
    expect(failed).toMatchObject({ diagnosis: 'ZOTERO_NOT_RUNNING: down' })
    expect(() => schema.parse({ providerId: 'local', connected: 'yes' })).toThrow()
  })

  it('carries no live schema beside create', () => {
    // Single-arm strict codec: the host materializes through `create()` and
    // carries no live `schema` property.
    const status = TYPERT_MANIFEST.invocations.find((invocation) => invocation.method === 'status')
    const result = status?.result as { schema?: unknown; create?: unknown } | undefined
    expect(typeof result?.create).toBe('function')
    expect(result).not.toHaveProperty('schema')
  })

  it('matches the client contribution structural identity exactly', async () => {
    const { ZOTERO_REMOTE } = await import('../../src/client/remote.ts')
    const { TYPERT_MANIFEST: host } = await import('../../src/typert.ts')
    const hostStatus = host.invocations.find((invocation) => invocation.method === 'status')
    const clientStatus = ZOTERO_REMOTE.descriptors.find(
      (invocation) => invocation.method === 'status',
    )
    expect(clientStatus).toBeDefined()
    expect(clientStatus).toMatchObject({
      id: hostStatus?.id,
      service: hostStatus?.service,
      namespace: hostStatus?.namespace,
      method: hostStatus?.method,
      invocation: hostStatus?.invocation,
      parameters: [],
    })
    const clientResult = clientStatus?.result as { mode?: string; typeSymbol?: string } | undefined
    expect(clientResult).toMatchObject({
      mode: hostStatus?.result && 'mode' in hostStatus.result ? hostStatus.result.mode : undefined,
      typeSymbol:
        hostStatus?.result && 'typeSymbol' in hostStatus.result
          ? hostStatus.result.typeSymbol
          : undefined,
    })
  })

  it('materializes browser-side status codec', async () => {
    const { ZOTERO_REMOTE } = await import('../../src/client/remote.ts')
    const status = ZOTERO_REMOTE.descriptors.find((invocation) => invocation.method === 'status')
    const result = status?.result as
      { create?: () => { parse: (v: unknown) => unknown } } | undefined
    expect(typeof result?.create).toBe('function')
    const schema = result!.create!()
    expect(schema.parse(statusView())).toMatchObject({
      providerId: 'local',
      connected: true,
    })
    expect(() => schema.parse({ connected: 'not-a-bool' })).toThrow()
  })

  it('materializes and validates the host resolveAttachment codecs', () => {
    const resolve = TYPERT_MANIFEST.invocations.find((inv) => inv.method === 'resolveAttachment')
    expect(resolve).toBeDefined()
    const paramResult = resolve!.parameters[0]?.codec as {
      create: () => { parse: (v: unknown) => unknown }
    }
    const resultResult = resolve!.result as { create: () => { parse: (v: unknown) => unknown } }
    const paramSchema = paramResult.create()
    expect(paramSchema.parse('zotero://user/0/items/ABCD1234')).toBe(
      'zotero://user/0/items/ABCD1234',
    )
    expect(() => paramSchema.parse('')).toThrow()

    const resSchema = resultResult.create()
    const valid = resSchema.parse({
      ref: 'zotero://user/0/items/ABCD1234',
      parentRef: 'zotero://user/0/item/EFGH5678',
      kind: 'file',
      title: 'test.pdf',
      contentType: 'application/pdf',
      path: '/path/to/test.pdf',
    })
    expect(valid).toMatchObject({
      kind: 'file',
      path: '/path/to/test.pdf',
      parentRef: 'zotero://user/0/item/EFGH5678',
    })
    expect(() => resSchema.parse({ ref: 'a', kind: 'other' })).toThrow()
  })

  it('materializes browser-side resolveAttachment codecs', async () => {
    const { ZOTERO_REMOTE } = await import('../../src/client/remote.ts')
    const resolve = ZOTERO_REMOTE.descriptors.find((inv) => inv.method === 'resolveAttachment')
    expect(resolve).toBeDefined()
    const paramCodec = resolve!.parameters[0]?.codec as {
      create?: () => { parse: (v: unknown) => unknown }
    }
    const resultCodec = resolve!.result as {
      create?: () => { parse: (v: unknown) => unknown }
    }
    expect(paramCodec.create!().parse('zotero://user/0/items/ABCD1234')).toBe(
      'zotero://user/0/items/ABCD1234',
    )
    expect(() => paramCodec.create!().parse('')).toThrow()
    expect(
      resultCodec.create!().parse({
        ref: 'zotero://user/0/items/ABCD1234',
        kind: 'file',
        title: 'test.pdf',
        contentType: 'application/pdf',
        path: '/path/to/test.pdf',
      }),
    ).toMatchObject({ kind: 'file', path: '/path/to/test.pdf' })
    expect(() => resultCodec.create!().parse({ ref: 'a', kind: 'other' })).toThrow()
  })

  it('claims the wire endpoint through the typert registry when one composes', async () => {
    const lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:23119/api' }, { typert: true })
    try {
      for (const invocation of TYPERT_MANIFEST.invocations) {
        // The registry keys endpoints as `<namespace>/<method>`.
        expect(lane.ctx.typert.local.get(`zotero/${invocation.method}`)).toMatchObject({
          namespace: 'zotero',
          method: invocation.method,
        })
      }
      const record = lane.ctx.typert.getPackage('dsh-zotero')
      expect(record?.model.services[0]?.key).toBe(ZOTERO_STATUS_SERVICE_KEY)
    } finally {
      await lane.ctx.fiber.dispose()
      await lane.teardown()
    }
  })
})
