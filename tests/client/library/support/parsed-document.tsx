/** Production provider and component; only remote bytes and framework seats are controlled. */
import { useSyncExternalStore } from 'react'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ResourceSnapshot } from '@deepseek-ai/dsh-client-resources/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  ParsedDocuments,
  type ParsedArtifactRead,
  type ParsedDocumentResource,
} from '../../../../src/client/parsed-documents.ts'
import {
  ParsedDocumentTab,
  ParsedDocumentTitle,
  type ParsedDocumentTabProps,
} from '../../../../src/client/components/library/ParsedDocumentTab.tsx'
import { parsedTabAddress } from '../../../../src/client/parsed-tab.ts'
import { ARTIFACT_READER_DEFAULTS } from '../../../../src/artifact-reader-preferences.ts'
import {
  ZOTERO_ARTIFACT_PAGE_CHARS,
  type ZoteroDocumentArtifactResultView,
} from '../../../../src/contract.ts'
import { attachmentRef } from '../../../helpers/server/keys.ts'
import { mockT } from '../../helpers/mock-translate.ts'
import { observable, parseJobs, parseRemote } from '../../enrichment/support/parse-ports.ts'

export const SESSION = 'parsed-session'
export const REF = attachmentRef('PDF00001')
export const ADDRESS = parsedTabAddress({ sessionId: SESSION, ref: REF, title: '' })
export const LEASE = '11111111-1111-4111-8111-111111111111'
export const METADATA = {
  sourceId: 'a'.repeat(64),
  targetLabel: 'Paper',
  mode: 'free' as const,
  artifactId: 'b'.repeat(64),
  fingerprint: 'c'.repeat(64),
  characterCount: 0,
  images: [],
  pageCount: 18,
}

export function documentRead(
  text: string,
  options: {
    artifactId?: string
    title?: string
    images?: { name: string; mediaType: 'image/png'; bytes: number; base64: string }[]
  } = {},
) {
  const metadata = {
    ...METADATA,
    characterCount: text.length,
    artifactId: options.artifactId ?? METADATA.artifactId,
    images: (options.images ?? []).map(({ base64: _base64, ...image }) => image),
  }
  return vi.fn<ParsedArtifactRead>(async (request) => {
    if (request.op === 'release') return { ok: true, value: { kind: 'released' } }
    if (request.op === 'inspect') return { ok: true, value: { kind: 'ready', ...metadata } }
    if (request.op === 'meta')
      return {
        ok: true,
        value: {
          kind: 'meta',
          ...metadata,
          ...(options.title !== undefined ? { title: options.title } : {}),
        },
      }
    if (request.op === 'probe')
      return {
        ok: true,
        value: {
          kind: 'probed',
          results: request.refs.map((ref) => ({
            ref,
            state: ref === REF ? ('ready' as const) : ('missing' as const),
          })),
        },
      }
    const offset = request.op === 'page' ? request.offset : 0
    const page = {
      offset,
      text: text.slice(offset, offset + ZOTERO_ARTIFACT_PAGE_CHARS),
      totalChars: text.length,
    }
    if (request.op === 'open')
      return {
        ok: true,
        value: {
          kind: 'opened',
          ...metadata,
          lease: LEASE,
          policy: ARTIFACT_READER_DEFAULTS,
          expiresAt: Date.now() + 120_000,
          page,
        },
      }
    if (request.op === 'page')
      return {
        ok: true,
        value: { kind: 'page', artifactId: metadata.artifactId, lease: LEASE, page },
      }
    const image = options.images?.find((image) => image.name === request.name)
    if (!image) throw new Error('No test image')
    return {
      ok: true,
      value: {
        kind: 'image',
        artifactId: metadata.artifactId,
        lease: LEASE,
        name: image.name,
        mediaType: image.mediaType,
        base64: image.base64,
      },
    }
  })
}

export function composer() {
  return {
    insertQuote: vi.fn(() => true),
    persistDraft: vi.fn(),
    captureInsertion: vi.fn(),
    insertText: vi.fn(),
    setDraft: vi.fn(),
  } as unknown as InputActions & {
    insertQuote: ReturnType<typeof vi.fn>
    persistDraft: ReturnType<typeof vi.fn>
  }
}

export function parsedRuntime(
  read: ParsedArtifactRead,
  options?: ConstructorParameters<typeof ParsedDocuments>[3],
) {
  const access = observable(true)
  const failures = vi.fn()
  const documents = new ParsedDocuments(read, () => access, failures, {
    decode: async () => {},
    ...options,
  })
  const abort = new AbortController()
  const source = observable<ResourceSnapshot<ParsedDocumentResource>>({
    status: 'loading',
    value: undefined,
    failure: undefined,
  })
  const iterator = documents.open(ADDRESS, { signal: abort.signal })[Symbol.asyncIterator]()
  const settled = (async () => {
    for (;;) {
      const next = await iterator.next()
      if (next.done) return
      const frame = next.value
      source.publish(
        frame.ok
          ? { status: 'live', value: frame.value, failure: undefined }
          : { status: 'failed', value: source.getSnapshot().value, failure: frame.error },
      )
    }
  })()
  const grants = new Map<string, ReturnType<typeof observable<boolean>>>()
  const grant = (action: string) => {
    let value = grants.get(action)
    if (!value) {
      value = observable(true)
      grants.set(action, value)
    }
    return value
  }
  const bindCommands = vi.fn((_commands: { refresh(): void }) => () => {})
  const props = (
    options: {
      actions?: InputActions
      parse?: boolean
      item?: ParsedDocumentTabProps['item']
      title?: string
      itemRef?: string
      address?: string
    } = {},
  ): ParsedDocumentTabProps =>
    ({
      t: mockT,
      sessionId: SESSION,
      refresh: (address: string) => documents.refresh(address),
      documents,
      item: options.item,
      inputActions: options.actions,
      useResource: () => useSyncExternalStore(source.subscribe, source.getSnapshot),
      useAccess: (action: string) => {
        const value = grant(action)
        return useSyncExternalStore(value.subscribe, value.getSnapshot)
      },
      useSession: (selector: (snapshot: { removed: boolean }) => unknown) =>
        selector({ removed: false }),
      useTabInfo: () => ({
        tab: {
          navigation: {
            address: options.address ?? ADDRESS,
            params: {
              title: options.title ?? 'Paper',
              ...(options.itemRef ? { item: options.itemRef } : {}),
            },
          },
          actions: { bindCommands },
        },
      }),
      ...(options.parse
        ? {
            parse: {
              remote: parseRemote(),
              jobs: parseJobs().jobs,
              deployment: observable({
                mounted: true,
                connected: true,
                mode: 'free',
                maxFileBytes: 1024,
                maxPages: 20,
                error: undefined,
              }),
              recall: () => undefined,
              recentUrl: () => undefined,
              clearSession: () => {},
            },
          }
        : {}),
    }) as unknown as ParsedDocumentTabProps & Parameters<typeof ParsedDocumentTitle>[0]
  return {
    source,
    access,
    documents,
    failures,
    grants,
    grant,
    bindCommands,
    props,
    mount: (options?: Parameters<typeof props>[0]) =>
      render(<ParsedDocumentTab {...props(options)} />),
    async dispose() {
      abort.abort()
      await settled
    },
  }
}

export type ArtifactAnswer = RemoteResult<ZoteroDocumentArtifactResultView>
