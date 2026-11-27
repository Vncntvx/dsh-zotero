import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SidebarRightOpenResourceOptions } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ZoteroAttachmentLocationView } from '../../contract.ts'
import type { PdfEvidenceTarget } from '../../reader/evidence.ts'
import { isPdfContentType } from '../../media-types.ts'
import type { ResolvedReaderConfig } from '../../reader/config.ts'
import { READER_SETTINGS_NAMESPACE } from '../../settings-namespace.ts'
import { readerAddress, readerTarget, READER_TAB_KIND, READER_TAB_PATTERN } from './address.ts'
import { loadReaderPdf, loadReaderTab } from './load-chunks.ts'
import { ReaderTabLoader, ReaderTurnCitationLoader } from './load-tab.tsx'
import { readerShellEn, readerShellZh } from './shell-locales.ts'
import type { ReaderTabFace } from './ReaderTab.tsx'
import type { ReaderReviews } from './ReaderQuote.tsx'
import { createReadingHistory, READING_HISTORY_KEY, type HistoryEntry } from './reading-history.ts'
import type { LibraryPreferenceSource } from '../library-preferences.tsx'
import type { ReaderTurnCitations } from './ReaderTurnCitations.tsx'
import type { HistoricalCitation, HistoricalTextCitation } from './historical-citations.ts'
import { readerTextFormat, TEXT_ATTACHMENT_BYTES } from './text-document.ts'
import { parsedArtifactTabAddress } from '../parsed-tab.ts'

const TAB_ID = 'dsh-zotero#reader'

async function readerValue<T>(pending: Promise<RemoteResult<T>>): Promise<T> {
  const result = await pending
  if (!result.ok) throw result.error
  return result.value
}

export function registerReader(ctx: Context, libraryPreferences?: LibraryPreferenceSource) {
  let open: ReaderOpener | undefined
  let openNote: ReaderNoteOpener | undefined
  const visits = createSnapshotStore<readonly HistoryEntry[]>([])
  ctx.inject(['remote.workspaceFiles'], (scope) => {
    scope.effect(() =>
      scope.configForms.whileServed([READER_SETTINGS_NAMESPACE], () => {
        const t = scope.locale.bind('zoteroReaderShell')
        const config = scope.configForms.get<ResolvedReaderConfig>(READER_SETTINGS_NAMESPACE)
        const translationTarget = createSnapshotStore<
          ResolvedReaderConfig['defaultTranslationTarget']
        >(config.getSnapshot().value?.defaultTranslationTarget ?? 'auto')
        let active = true
        const history = createReadingHistory(
          () =>
            (active ? config.getSnapshot().value : undefined) ?? {
              historyLimit: 50,
              persistReadingState: false,
              defaultTranslationTarget: 'auto',
              captureWatermark: false,
            },
          visits,
        )
        const stopConfig = config.subscribe(() => {
          history.refresh()
          translationTarget.set(config.getSnapshot().value?.defaultTranslationTarget ?? 'auto')
        })
        history.refresh()
        const refreshStorage = (event: StorageEvent) => {
          if (event.key === READING_HISTORY_KEY || event.key === null) history.refresh()
        }
        globalThis.addEventListener?.('storage', refreshStorage)
        let disposeUiLocale: (() => void) | undefined
        const loadUi = async () => {
          const ui = await loadReaderTab()
          if (!active || !ui?.readerEn || !ui.readerZh) return undefined
          disposeUiLocale ??= scope.locale.register('zoteroReader', {
            en: ui.readerEn,
            zh: ui.readerZh,
          })
          return ui
        }
        const face: ReaderTabFace &
          Pick<Parameters<typeof ReaderTabLoader>[0], 'loadUi' | 'shellText'> = {
          loadUi,
          shellText: t,
          translationTarget,
          defaultCaptureWatermark: () => config.getSnapshot().value?.captureWatermark ?? false,
          load: loadReaderPdf,
          history,
          reviews: createSnapshotStore<ReturnType<ReaderReviews['getSnapshot']>>(new Map()),
          async openParsedPassage(sessionId, source, selection, signal) {
            const access = scope.remoteAccess.source(
              'session',
              sessionId,
              'zotero/documentArtifact',
            )
            if (!access.getSnapshot()) return false
            const artifact = await readerValue(
              scope.remote.zotero.documentArtifact(
                {
                  sessionId,
                  op: 'inspect',
                  target: { kind: 'attachment', ref: source.attachmentRef },
                },
                signal,
              ),
            )
            signal.throwIfAborted()
            if (
              !active ||
              !access.getSnapshot() ||
              artifact.kind !== 'ready' ||
              artifact.sourceRef !== source.attachmentRef ||
              `sha256:${artifact.fingerprint}` !== source.fingerprint
            )
              return false
            scope.sidebarRight.openResourceIn(
              sessionId,
              parsedArtifactTabAddress({ sessionId, artifactId: artifact.artifactId }),
              {
                destination: 'sidebar',
                params: {
                  title: source.title,
                  parsedPassage: {
                    ...selection,
                    attachmentRef: source.attachmentRef,
                    fingerprint: artifact.fingerprint,
                  },
                },
              },
            )
            return true
          },
          async readParsedText(sessionId, source, regions, signal) {
            const access = scope.remoteAccess.source(
              'session',
              sessionId,
              'zotero/documentArtifact',
            )
            if (!active || !access.getSnapshot() || !source.fingerprint.startsWith('sha256:'))
              return
            signal.throwIfAborted()
            const fingerprint = source.fingerprint.slice(7)
            const result = await readerValue(
              scope.remote.zotero.documentArtifact(
                {
                  sessionId,
                  op: 'inspect',
                  target: { kind: 'attachment', ref: source.attachmentRef },
                  regionText: { fingerprint, regions },
                },
                signal,
              ),
            )
            signal.throwIfAborted()
            if (
              active &&
              access.getSnapshot() &&
              result.kind === 'ready' &&
              result.sourceRef === source.attachmentRef &&
              result.fingerprint === fingerprint
            )
              return result.regionText
          },
          async openProtocol(url) {
            const result = await scope.remote.zotero.openProtocol(url)
            return result.ok && result.value.success
          },
          annotations: (request, signal) =>
            readerValue(scope.remote.zotero.readerAnnotations(request, signal)),
          details: (request, signal) =>
            readerValue(scope.remote.zotero.readerDetails(request, signal)),
          readNote: (request, signal) =>
            readerValue(scope.remote.zotero.readerNote(request, signal)),
          async readNoteImage(sessionId, noteRef, imageRef, signal) {
            const access = [
              scope.remoteAccess.source('session', sessionId, 'zotero/readerNote'),
              scope.remoteAccess.source('session', sessionId, 'zotero/resolveAttachment'),
              scope.remoteAccess.source('session', sessionId, 'workspaceFiles/readBytes'),
            ]
            const check = () => {
              signal.throwIfAborted()
              if (!active || access.some((grant) => !grant.getSnapshot()))
                throw new Error(t('unavailable'))
            }
            check()
            const file = await readerValue(scope.remote.zotero.resolveAttachment(imageRef))
            check()
            const { kind, path, parentRef, ref, contentType } = file
            if (
              kind !== 'file' ||
              !path ||
              parentRef !== noteRef ||
              ref !== imageRef ||
              !/^image\/(?:apng|avif|bmp|gif|jpeg|png|webp)$/.test(contentType)
            )
              throw new Error(t('unavailable'))
            const length = 2 * 1024 * 1024
            const { data, eof, offset } = await readerValue(
              scope.remote.workspaceFiles.readBytes(sessionId, path, { range: { length } }, signal),
            )
            check()
            if (!eof || offset !== 0 || data.length === 0 || data.length > length)
              throw new Error(t('unavailable'))
            return new Blob([data], { type: contentType })
          },
          translate: (request, signal) =>
            readerValue(scope.remote.zotero.readerTranslate(request, signal)),
          suggestAnnotation: (request, signal) =>
            readerValue(scope.remote.zotero.readerSuggestAnnotation(request, signal)),
          writeNote: (request, signal) =>
            readerValue(scope.remote.zotero.readerWriteNote(request, signal)),
          citationCopy: {
            preferences: libraryPreferences,
            translate: scope.locale.bind('zotero'),
            read: (request, signal) => scope.remote.zotero.export(request, signal),
          },
          ...(libraryPreferences === undefined
            ? {}
            : {
                journalMetrics: {
                  preferences: libraryPreferences,
                  translate: scope.locale.bind('zotero'),
                  read: (request, signal) => scope.remote.zotero.journalMetrics(request, signal),
                },
              }),
          updateAnnotation: (request, signal) =>
            readerValue(scope.remote.zotero.readerUpdateAnnotation(request, signal)),
          createAnnotations: (request, signal) =>
            readerValue(scope.remote.zotero.readerCreateAnnotations(request, signal)),
          deleteAnnotation: (request, signal) =>
            readerValue(scope.remote.zotero.readerDeleteAnnotation(request, signal)),
          async resolve(ref, signal) {
            signal.throwIfAborted()
            const resolved = await scope.remote.zotero.resolveAttachment(ref)
            signal.throwIfAborted()
            if (!resolved.ok) throw resolved.error
            const { kind, path, contentType, ref: resolvedRef, parentRef } = resolved.value
            if (kind !== 'file' || !path || !isPdfContentType(contentType) || resolvedRef !== ref)
              throw new Error(t('unavailable'))
            return { path, ref: resolvedRef, ...(parentRef === undefined ? {} : { parentRef }) }
          },
          async read(sessionId, path, signal) {
            const result = await scope.remote.workspaceFiles.readBytes(sessionId, path, {}, signal)
            signal.throwIfAborted()
            if (!result.ok) throw result.error
            if (!result.value.eof || result.value.offset !== 0) throw new Error(t('unavailable'))
            return result.value.data
          },
          async readTextAttachment(sessionId, ref, signal) {
            signal.throwIfAborted()
            const attachment = await scope.remote.zotero.resolveAttachment(ref)
            signal.throwIfAborted()
            if (!attachment.ok) throw attachment.error
            const { kind, path, ref: resolvedRef, contentType, parentRef } = attachment.value
            const format = readerTextFormat(contentType)
            if (kind !== 'file' || !path || resolvedRef !== ref || !format)
              throw new Error(t('unavailable'))
            const result = await scope.remote.workspaceFiles.readBytes(
              sessionId,
              path,
              { range: { length: TEXT_ATTACHMENT_BYTES } },
              signal,
            )
            signal.throwIfAborted()
            if (!result.ok) throw result.error
            if (result.value.offset !== 0 || result.value.data.length > TEXT_ATTACHMENT_BYTES)
              throw new Error(t('unavailable'))
            return { format, parentRef, data: result.value.data, eof: result.value.eof }
          },
        }
        const disposeLocale = scope.locale.register('zoteroReaderShell', {
          en: readerShellEn,
          zh: readerShellZh,
        })
        const disposeTab = scope.sidebarRightTabs.register({
          id: TAB_ID,
          kind: READER_TAB_KIND,
          // Harness opens the plan preview in the sidebar during a Reader write.
          keepMounted: true,
          patterns: [READER_TAB_PATTERN],
          canOpen: (address) => readerTarget(address) !== undefined,
          title: () => t('title'),
        })
        const disposeBody = scope.slots.inject('sidebar.right.pane.tab', () =>
          scope.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: TAB_ID,
              locale: 'zoteroReader',
              inject: () => face,
            },
            ReaderTabLoader,
          ),
        )
        const disposeTitle = scope.slots.inject('sidebar.right.pane.tab.title', () =>
          scope.slots.register(
            {
              name: 'sidebar.right.pane.tab.title',
              key: TAB_ID,
              locale: 'zoteroReaderShell',
            },
            (props) => props.useTabInfo().tab.navigation.params?.title ?? props.t('title'),
          ),
        )
        open = async (
          sessionId,
          location,
          destination,
          signal,
          evidence,
          expectedFingerprint,
          textCitation,
        ) => {
          if (location.kind !== 'file' || !location.path) return false
          const pdf = isPdfContentType(location.contentType)
          if (!pdf && (!readerTextFormat(location.contentType) || evidence || expectedFingerprint))
            return false
          if (textCitation && readerTextFormat(location.contentType) !== textCitation.documentType)
            return false
          const readAccess = scope.remoteAccess.source(
            'session',
            sessionId,
            'workspaceFiles/readBytes',
          )
          const resolveAccess = scope.remoteAccess.source(
            'session',
            sessionId,
            'zotero/resolveAttachment',
          )
          if (!readAccess.getSnapshot() || !resolveAccess.getSnapshot()) return false
          const address = readerAddress(sessionId, location.ref, pdf ? 'attachment' : 'text')
          if (!readerTarget(address)) return false
          try {
            const [runtime, ui] = await Promise.all([pdf ? loadReaderPdf() : undefined, loadUi()])
            signal.throwIfAborted()
            if (
              !active ||
              !readAccess.getSnapshot() ||
              !resolveAccess.getSnapshot() ||
              (pdf && typeof runtime?.mountPdf !== 'function') ||
              typeof ui?.ReaderTab !== 'function'
            )
              return false
            scope.sidebarRight.openResourceIn(sessionId, address, {
              destination,
              params: {
                title: location.title,
                ...(evidence === undefined
                  ? {}
                  : 'artifactRegion' in evidence
                    ? { artifactEvidence: evidence }
                    : 'quote' in evidence
                      ? { evidenceQuote: evidence }
                      : { position: evidence }),
                ...(expectedFingerprint === undefined ? {} : { expectedFingerprint }),
                ...(textCitation && { textCitation }),
              },
            })
            return true
          } catch {
            signal.throwIfAborted()
            return false
          }
        }
        openNote = async (sessionId, ref, title, signal, noteVersion) => {
          const access = scope.remoteAccess.source('session', sessionId, 'zotero/readerNote')
          const address = readerAddress(sessionId, ref, 'note')
          if (!readerTarget(address) || !access.getSnapshot()) return false
          try {
            const ui = await loadUi()
            signal.throwIfAborted()
            if (!active || !access.getSnapshot() || typeof ui?.ReaderTab !== 'function')
              return false
            scope.sidebarRight.openResourceIn(sessionId, address, {
              destination: 'sidebar',
              params: { title, ...(noteVersion !== undefined && { noteVersion }) },
            })
            return true
          } catch {
            signal.throwIfAborted()
            return false
          }
        }
        const openCitation = async (
          sessionId: SessionId,
          citation: HistoricalCitation,
          signal: AbortSignal,
        ) => {
          if ('artifactId' in citation) {
            const access = scope.remoteAccess.source(
              'session',
              sessionId,
              'zotero/documentArtifact',
            )
            if (!active || signal.aborted || !access.getSnapshot()) return false
            const { artifactId, attachmentRef, fingerprint, textRange, textPrefix, title } =
              citation
            scope.sidebarRight.openResourceIn(
              sessionId,
              parsedArtifactTabAddress({ sessionId, artifactId }),
              {
                destination: 'sidebar',
                params: {
                  title,
                  parsedPassage: { attachmentRef, fingerprint, textRange, textPrefix },
                },
              },
            )
            return true
          }
          if ('noteRef' in citation)
            return (
              (await openNote?.(
                sessionId,
                citation.noteRef,
                citation.title,
                signal,
                citation.noteVersion,
              )) ?? false
            )
          const resolveAccess = scope.remoteAccess.source(
            'session',
            sessionId,
            'zotero/resolveAttachment',
          )
          if (signal.aborted || !active || !resolveAccess.getSnapshot()) return false
          const resolved = await scope.remote.zotero.resolveAttachment(citation.attachmentRef)
          if (
            !resolved.ok ||
            resolved.value.ref !== citation.attachmentRef ||
            signal.aborted ||
            !active ||
            !resolveAccess.getSnapshot()
          )
            return false
          if ('textRange' in citation) {
            const { documentType, textRange, fingerprint } = citation
            return (
              (await open?.(sessionId, resolved.value, 'sidebar', signal, undefined, undefined, {
                documentType,
                textRange,
                fingerprint,
              })) ?? false
            )
          }
          return (
            (await open?.(
              sessionId,
              resolved.value,
              'sidebar',
              signal,
              citation.artifactRegion
                ? {
                    artifactRegion: citation.artifactRegion,
                    contentFingerprint: citation.fingerprint,
                  }
                : citation.position,
              citation.fingerprint,
            )) ?? false
          )
        }
        const prepareNote: NonNullable<
          Parameters<typeof ReaderTurnCitations>[0]['prepareNote']
        > = async (sessionId, citation, signal) => {
          const details = scope.remoteAccess.source('session', sessionId, 'zotero/readerDetails')
          const write = scope.remoteAccess.source('session', sessionId, 'zotero/readerWriteNote')
          if (!active || !details.getSnapshot() || !write.getSnapshot()) return
          const item = await face.details(
            { sessionId, ref: citation.attachmentRef, offset: 0 },
            signal,
          )
          if (!item.noteWriteEnabled) return
          const ui = await loadUi()
          signal.throwIfAborted()
          if (!active || !details.getSnapshot() || !write.getSnapshot() || !ui?.ReaderNoteMutation)
            return
          return {
            ref: item.ref,
            title: item.title,
            Editor: ui.ReaderNoteMutation,
            t: scope.locale.bind('zoteroReader'),
            write: face.writeNote,
          }
        }
        const disposeCitations = scope.slots.inject('conversation.chat.turnTail', () =>
          scope.slots.register(
            {
              name: 'conversation.chat.turnTail',
              id: 'zotero.readerCitations',
              locale: 'zoteroReaderShell',
              inject: () => ({
                loadUi,
                openCitation,
                prepareNote,
              }),
            },
            ReaderTurnCitationLoader,
          ),
        )
        return () => {
          active = false
          open = undefined
          openNote = undefined
          stopConfig()
          globalThis.removeEventListener?.('storage', refreshStorage)
          visits.set([])
          disposeCitations()
          disposeTitle()
          disposeBody()
          disposeTab()
          disposeUiLocale?.()
          disposeLocale()
        }
      }),
    )
  })
  const opener: ReaderOpener = async (...args) => (await open?.(...args)) ?? false
  const noteOpener: ReaderNoteOpener = async (...args) => (await openNote?.(...args)) ?? false
  return { open: opener, openNote: noteOpener, visits }
}

export type ReaderOpener = (
  sessionId: SessionId,
  location: ZoteroAttachmentLocationView,
  destination: NonNullable<SidebarRightOpenResourceOptions['destination']>,
  signal: AbortSignal,
  evidence?: PdfEvidenceTarget,
  expectedFingerprint?: string,
  textCitation?: Pick<HistoricalTextCitation, 'documentType' | 'textRange' | 'fingerprint'>,
) => Promise<boolean>

export type ReaderNoteOpener = (
  sessionId: SessionId,
  ref: string,
  title: string,
  signal: AbortSignal,
  noteVersion?: number,
) => Promise<boolean>
