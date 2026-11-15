/** Real session/peer ownership with controllable immutable display candidates. */
import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import type { DisplayArtifactCandidate } from '../../../src/enrichment/artifact-reads.ts'
import { ARTIFACT_READER_DEFAULTS } from '../../../src/artifact-reader-preferences.ts'
import type {
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
} from '../../../src/contract.ts'
import { parseJobsFixture, parseSignal, parseRequest } from './enrichment-parse-jobs.ts'

export async function artifactReadsFixture(text = '# Snapshot', imageCount = 1) {
  const reads = vi.fn(async () => text)
  const image = vi.fn(async () => ({
    data: new Uint8Array([137, 80, 78, 71]),
    mediaType: 'image/png' as const,
  }))
  const metadata = {
    sourceId: 'a'.repeat(64),
    targetLabel: 'Selected PDF',
    mode: 'free' as const,
    artifactId: 'b'.repeat(64),
    fingerprint: 'c'.repeat(64),
    characterCount: text.length,
    images: Array.from({ length: imageCount }, (_, index) => ({
      name: `images/f${index}.png`,
      mediaType: 'image/png' as const,
      bytes: 4,
    })),
  }
  const candidate: DisplayArtifactCandidate = {
    metadata,
    markdownBytes: Buffer.byteLength(text),
    read: reads,
    image,
  }
  const lookup = vi.fn(async () => candidate)
  const host = await parseJobsFixture({ displayCandidate: lookup })
  host.grant()
  const peer = host.guestContext('documentArtifact')
  const call = (
    request: ZoteroDocumentArtifactRequestView,
    context = peer,
    signal = parseSignal(),
  ) => host.helper.documentArtifact(request, signal, context)
  const open = async (requestId = randomUUID(), context = peer) => {
    const result = await call(
      { sessionId: 'parse-owner', op: 'open', requestId, target: parseRequest().target },
      context,
    )
    if (result.kind !== 'opened') throw new Error('Expected open')
    return { ...result, requestId }
  }
  const page = (lease: string, offset = 0, context = peer) =>
    call({ sessionId: 'parse-owner', op: 'page', lease, offset }, context)
  const release = (requestId: string, context = peer) =>
    call({ sessionId: 'parse-owner', op: 'release', requestId }, context)
  return {
    ...host,
    reads,
    image,
    candidate,
    lookup,
    peer,
    call,
    open,
    page,
    release,
    limits: (values: Partial<typeof ARTIFACT_READER_DEFAULTS>) => {
      host.config.value = {
        ...host.config.value,
        artifactReader: { ...ARTIFACT_READER_DEFAULTS, ...values },
      }
    },
  }
}
export type ArtifactReadsFixture = Awaited<ReturnType<typeof artifactReadsFixture>>
export function requirePage(result: ZoteroDocumentArtifactResultView): string {
  if (result.kind !== 'page') throw new Error('Expected page')
  return result.page.text
}
