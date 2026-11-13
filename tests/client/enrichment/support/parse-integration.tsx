/** Real panel/parse surface assembly; substitute only accepted config, access, jobs and Remote. */
import { createLibraryViewStore } from '../../../../src/client/components/library/library-view-store.ts'
import { useSyncExternalStore } from 'react'
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import type { ZoteroItemDetailView } from '../../../../src/contract.ts'
import { ENRICHMENT_DEFAULTS } from '../../../../src/enrichment-preferences.ts'
import { LIBRARY_DEFAULTS } from '../../../../src/library-preferences.ts'
import { en } from '../../../../src/client/locales.ts'
import { createDocumentParseSurface } from '../../../../src/client/enrichment/parse-surface.tsx'
import {
  ZoteroLibraryPanel,
  type ZoteroLibraryPanelProps,
} from '../../../../src/client/components/library/ZoteroLibraryPanel.tsx'
import type { DocumentParseRemote } from '../../../../src/client/enrichment/parse-controller.ts'
import { attachmentRef } from '../../../helpers/server/keys.ts'
import { fakeScope } from '../../helpers/fake-scope.ts'
import { ITEM_DETAIL, mountPanel, searchPage } from '../../helpers/library-panel-harness.tsx'
import { makeTranslate } from '../../helpers/mock-translate.ts'
import { observable, parseJobs, parseRemote, PARSE_SESSION } from './parse-ports.ts'
import { vi } from 'vitest'

export const PARSE_ACTIONS = [
  'zotero/startDocumentParse',
  'zotero/documentArtifact',
  'zotero/documentParseReceipt',
  'job/list',
  'job/follow',
  'job/kill',
]
export const CHILD_PDFS = [
  {
    ref: attachmentRef('PDF00001') + '?server=S1',
    title: 'First PDF',
    contentType: 'application/pdf',
  },
  {
    ref: attachmentRef('PDF00002') + '?server=S1',
    title: 'Selected PDF',
    contentType: 'application/pdf',
  },
]
export const PARENT_DETAIL: ZoteroItemDetailView = {
  ...ITEM_DETAIL,
  bestAttachment: CHILD_PDFS[0],
  attachments: {
    offset: 0,
    total: 3,
    returned: 3,
    limit: 50,
    items: [
      ...CHILD_PDFS,
      { ref: attachmentRef('HTML0001'), title: 'Not a PDF', contentType: 'text/html' },
    ],
  },
}
export const TOP_PDF_DETAIL: ZoteroItemDetailView = {
  ...ITEM_DETAIL,
  ref: CHILD_PDFS[1]!.ref.replace('/attachment/', '/item/'),
  title: 'Standalone PDF',
  itemType: 'attachment',
  bestAttachment: CHILD_PDFS[1],
  attachments: undefined,
  notes: undefined,
  annotations: undefined,
}

export function parseIntegrationWorld(overrides: Partial<DocumentParseRemote> = {}) {
  const remote = parseRemote(overrides)
  const boundary = parseJobs()
  const form = fakeScope({ value: { ...ENRICHMENT_DEFAULTS } })
  const connection = observable<ConnectionState>('connected')
  let serving: ((served: ReadonlySet<string>) => () => void) | undefined
  let unmount: (() => void) | undefined
  const port = createDocumentParseSurface(
    {
      remote: { zotero: remote },
      jobs: boundary.jobs,
      connection: { state: connection },
      configForms: {
        whileServed: (_namespaces, register) => {
          serving = register
          unmount = register(new Set(['enrichment']))
          return () => unmount?.()
        },
      },
    },
    form,
  )
  const access = observable<ReadonlySet<string>>(new Set(PARSE_ACTIONS))
  const removed = observable(false)
  const sessions = {
    ids: ['unrelated-session', PARSE_SESSION],
    paneId: PARSE_SESSION,
    byId: {
      'unrelated-session': { running: true },
      [PARSE_SESSION]: { running: false },
    },
  }
  const preferenceSource = { getSnapshot: () => preferences, subscribe: () => () => {} }
  const preferences = {
    preferences: { ...LIBRARY_DEFAULTS, detailExpandedSections: ['attachments' as const] },
  }
  let detail = PARENT_DETAIL
  const item = vi.fn(async () => ({ ok: true, value: detail }))
  const search = vi.fn(async () => ({
    ok: true,
    value: searchPage({
      items: [
        { ref: detail.ref, title: detail.title, itemType: detail.itemType, creatorSummary: '' },
      ],
      total: 1,
      returned: 1,
    }),
  }))
  // One view store for the whole world: in production it lives on the client
  // registration, not on the pane tab body, so a remount reads what the
  // previous body cached.
  const viewStore = createLibraryViewStore()
  // The panel only offers a parsed result when it can open its tab.
  const openParsed = vi.fn()
  const surface: Partial<ZoteroLibraryPanelProps> = {
    parse: port,
    openParsed,
    viewStore,
    t: makeTranslate(en),
    preferenceSource,
    useAccess: (action) => useSyncExternalStore(access.subscribe, access.getSnapshot).has(action),
    useSession: (selector) =>
      selector({
        sessionId: PARSE_SESSION,
        removed: useSyncExternalStore(removed.subscribe, removed.getSnapshot),
        running: false,
      } as Parameters<typeof selector>[0]),
  }
  return {
    port,
    openParsed,
    form,
    connection,
    remote,
    ...boundary,
    access,
    removed,
    mount: (next = PARENT_DETAIL) => {
      detail = next
      return mountPanel({ item, search }, sessions, surface)
    },
    remount: (panel: ReturnType<typeof mountPanel>) => {
      panel.view.unmount()
      return mountPanel({ item, search }, sessions, surface)
    },
    withdraw: () => {
      unmount?.()
      unmount = undefined
    },
    serve: () => {
      unmount = serving?.(new Set(['enrichment']))
    },
    dispose: () => port.dispose(),
  }
}

export { ZoteroLibraryPanel, en, PARSE_SESSION }
