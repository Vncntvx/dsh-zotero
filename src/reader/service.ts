/** Cordis service for the optional Zotero Reader component. */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  ZOTERO_READER_SERVICE_KEY,
  ZOTERO_SETTINGS_NAMESPACE,
  type ZoteroItemDetailView,
  type ZoteroLibraryWriteResultView,
  type ZoteroReaderAnnotationsRequest,
  type ZoteroReaderAnnotationsView,
  type ZoteroReaderCreateAnnotationsRequest,
  type ZoteroReaderCreateAnnotationsView,
  type ZoteroReaderDeleteAnnotationRequest,
  type ZoteroReaderDetailsRequest,
  type ZoteroReaderNoteRequest,
  type ZoteroReaderNoteView,
  type ZoteroReaderSuggestAnnotationRequest,
  type ZoteroReaderTranslateRequest,
  type ZoteroReaderWriteNoteRequest,
  type ZoteroReaderUpdateAnnotationRequest,
} from '../contract.js'
import {
  domainCall,
  ZOTERO_INVALID_ARGUMENT,
  ZoteroError,
  ZOTERO_NOT_FOUND,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
  requireNonBlank,
} from '../errors.js'
import { ZOTERO_CHILD_PAGE_ROWS, ZOTERO_READER_NOTE_TEXT_CHARS } from '../constants.js'
import { childPageViewOf, itemRequestOf, itemViewOf } from '../library-views.js'
import { executeZoteroSessionWrite, requireZoteroWriteSession } from '../library-write.js'
import { noteTextRuns } from '../local/note-text-edits.js'
import { parseSupportedRef, requireWritableRef } from '../refs.js'
import { requireZoteroService } from '../service.js'
import { WRITE_PLAN_LIBRARY_LINE } from '../write-approval.js'
import { planValue } from '../write-plan.js'
import { suggestAnnotation, translateExcerpt } from './translation.js'
import {
  ReaderConfigSchema,
  resolveReaderConfig,
  type ReaderConfig,
  type ResolvedReaderConfig,
} from './config.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    reader: ReaderService
  }
}

function requireReaderAccess(
  ctx: Context,
  sessionId: string,
  method:
    | 'readerAnnotations'
    | 'readerDetails'
    | 'readerNote'
    | 'readerTranslate'
    | 'readerSuggestAnnotation',
) {
  if (ctx.get('remoteAccess')?.allows({ kind: 'session', id: SessionId(sessionId) })) return
  throw new RemoteError('remote-access/denied', 'Zotero Reader is unavailable in this session.', {
    action: `zotero/${method}`,
    reason: 'no-allow',
  })
}

export class ReaderService extends TypertRemoteService {
  static readonly Config = ReaderConfigSchema
  static readonly inject = ['zotero']

  constructor(
    ctx: Context,
    public config: ReaderConfig = {},
  ) {
    super(ctx, ZOTERO_READER_SERVICE_KEY, { namespace: ZOTERO_SETTINGS_NAMESPACE })
  }

  get currentConfig(): ResolvedReaderConfig {
    return resolveReaderConfig(this.config)
  }

  async readerDetails(
    { sessionId, ref, offset, notesOffset = 0 }: ZoteroReaderDetailsRequest,
    signal: AbortSignal,
  ): Promise<ZoteroItemDetailView> {
    return await domainCall(async () => {
      signal.throwIfAborted()
      requireReaderAccess(this.ctx, sessionId, 'readerDetails')
      const core = requireZoteroService(this.ctx, signal)
      const attachment = await core.get(
        { ref: parseSupportedRef(ref, ['attachment']), include: new Set(), includeParentRef: true },
        signal,
      )
      if (!attachment.parentRef) return itemViewOf(attachment)
      const parent = parseSupportedRef(attachment.parentRef, ['item'])
      const item = itemViewOf(
        await core.get(
          itemRequestOf({
            ref: attachment.parentRef,
            include: ['attachments', 'notes'],
            childPages: {
              attachments: { offset, limit: ZOTERO_CHILD_PAGE_ROWS },
              notes: { offset: notesOffset, limit: ZOTERO_CHILD_PAGE_ROWS },
            },
          }),
          signal,
        ),
      )
      return {
        ...item,
        ...(core.config.writeEnabled === true &&
        parent.library.type === 'user' &&
        parent.library.id === 0
          ? { noteWriteEnabled: true }
          : {}),
      }
    })
  }

  async readerNote(
    { sessionId, ref }: ZoteroReaderNoteRequest,
    signal: AbortSignal,
  ): Promise<ZoteroReaderNoteView> {
    return await domainCall(async () => {
      signal.throwIfAborted()
      requireReaderAccess(this.ctx, sessionId, 'readerNote')
      const core = requireZoteroService(this.ctx, signal)
      const item = parseSupportedRef(ref, ['item'])
      const note = await core.get({ ref: item, include: new Set(), includeNoteHtml: true }, signal)
      if (note.itemType !== 'note')
        throw new ZoteroError('The target item is not a Zotero note.', ZOTERO_INVALID_ARGUMENT)
      const text = note.noteBody?.text ?? ''
      const runs =
        core.config.writeEnabled &&
        item.library.type === 'user' &&
        item.library.id === 0 &&
        note.version !== undefined &&
        note.noteHtml !== undefined
          ? noteTextRuns(note.noteHtml).map(({ offset, text }) => ({ offset, text }))
          : []
      return {
        ref: note.ref,
        title: note.title,
        ...(note.noteHtml === undefined ? {} : { html: note.noteHtml }),
        ...(note.version === undefined ? {} : { version: note.version }),
        ...(runs.length === 0 ? {} : { editableRuns: runs }),
        text: text.slice(0, ZOTERO_READER_NOTE_TEXT_CHARS),
        truncated: note.noteBody?.truncated === true || text.length > ZOTERO_READER_NOTE_TEXT_CHARS,
      }
    })
  }

  async readerTranslate(
    request: ZoteroReaderTranslateRequest,
    signal: AbortSignal,
  ): Promise<string> {
    return await domainCall(async () => {
      signal.throwIfAborted()
      requireReaderAccess(this.ctx, request.sessionId, 'readerTranslate')
      return await translateExcerpt(this.ctx, request, signal)
    })
  }

  async readerSuggestAnnotation(
    request: ZoteroReaderSuggestAnnotationRequest,
    signal: AbortSignal,
  ): Promise<string> {
    return await domainCall(async () => {
      signal.throwIfAborted()
      requireReaderAccess(this.ctx, request.sessionId, 'readerSuggestAnnotation')
      return await suggestAnnotation(this.ctx, request, signal)
    })
  }

  async readerWriteNote(
    request: ZoteroReaderWriteNoteRequest,
    signal: AbortSignal,
  ): Promise<ZoteroLibraryWriteResultView> {
    return await domainCall<ZoteroLibraryWriteResultView>(async () => {
      const { sessionId, ref, operation } = request
      const { agent, service } = await requireZoteroWriteSession(
        this.ctx,
        sessionId,
        'zotero/readerWriteNote',
        signal,
      )
      const item = requireWritableRef(parseSupportedRef(ref, ['item']), ['item'])
      const exec = { agent, signal, name: `zotero_reader_${operation}_note` }
      try {
        const result =
          operation === 'create'
            ? await service.createNote(
                { parentItem: item, markdown: requireNonBlank('markdown', request.markdown) },
                {
                  exec,
                  plan: [
                    '**Create a linked Zotero note**',
                    WRITE_PLAN_LIBRARY_LINE,
                    `- Parent: ${planValue(ref)}`,
                    `- Markdown: ${planValue(request.markdown.trim())}`,
                  ].join('\n'),
                },
              )
            : await service.modifyNote(
                {
                  ...(request.operation === 'edit'
                    ? { operation: request.operation, edits: request.edits }
                    : { operation: request.operation }),
                  expectedVersion: request.expectedVersion,
                  item,
                },
                {
                  exec,
                  ...(operation === 'delete' ? { risk: 'irreversible-delete' as const } : {}),
                  plan: [
                    operation === 'delete'
                      ? '**Permanently delete a Zotero note**'
                      : '**Edit Zotero note text**',
                    WRITE_PLAN_LIBRARY_LINE,
                    `- Note: ${planValue(ref)}`,
                    `- Expected version: ${request.expectedVersion}`,
                    ...(request.operation === 'edit'
                      ? request.edits.map(({ offset, text, format, formatRange, formatting }) => {
                          const formats =
                            formatting?.map(({ format: name, range }) =>
                              range
                                ? `${name}[${range.start}, ${range.end}): ${planValue(text.slice(range.start, range.end))}`
                                : name,
                            ) ??
                            (format === undefined
                              ? []
                              : [
                                  formatRange
                                    ? `${format}[${formatRange.start}, ${formatRange.end}): ${planValue(text.slice(formatRange.start, formatRange.end))}`
                                    : format,
                                ])
                          const summary = formats.length === 0 ? '' : ` (${formats.join(', ')})`
                          return `- Text at offset ${offset}${summary}: ${planValue(text)}`
                        })
                      : []),
                  ].join('\n'),
                },
              )
        if (result.kind === 'declined')
          return { kind: 'declined', message: 'Note write was declined.' }
        if (result.kind === 'committed-unverified')
          return {
            kind: 'committed-unverified',
            message: `Check the note in Zotero before submitting another write. ${result.ref ?? ref}`,
          }
        return {
          kind: 'applied',
          message: `${operation === 'delete' ? 'Deleted' : 'Saved'} ${result.ref}.`,
        }
      } catch (error) {
        if (
          error instanceof ZoteroError &&
          (error.code === ZOTERO_WRITE_CONFLICT || error.code === ZOTERO_NOT_FOUND)
        )
          return { kind: 'failed', code: error.code, message: error.message }
        throw error
      }
    })
  }

  async readerAnnotations(
    request: ZoteroReaderAnnotationsRequest,
    signal: AbortSignal,
  ): Promise<ZoteroReaderAnnotationsView> {
    return await domainCall(async () => {
      signal.throwIfAborted()
      requireReaderAccess(this.ctx, request.sessionId, 'readerAnnotations')
      const core = requireZoteroService(this.ctx, signal)
      const ref = parseSupportedRef(request.ref, ['attachment'])
      const children = await core.childPage(
        {
          ref,
          kind: 'annotations',
          includeAnnotationPosition: true,
          offset: request.offset,
          limit: request.limit,
        },
        signal,
      )
      const result = childPageViewOf(children)
      if (result.kind !== 'annotations')
        throw new ZoteroError('Zotero returned an unexpected child listing.', ZOTERO_UNEXPECTED)
      return {
        ...result.page,
        writeEnabled:
          core.config.writeEnabled === true && ref.library.type === 'user' && ref.library.id === 0,
      }
    })
  }

  async readerUpdateAnnotation(
    { sessionId, ...args }: ZoteroReaderUpdateAnnotationRequest,
    signal: AbortSignal,
  ): Promise<ZoteroLibraryWriteResultView> {
    return await domainCall(() => {
      requireWritableRef(parseSupportedRef(args.ref, ['annotation']), ['annotation'])
      return executeZoteroSessionWrite(
        this.ctx,
        sessionId,
        'zotero/readerUpdateAnnotation',
        'zotero_update_item',
        args,
        signal,
      )
    })
  }

  async readerCreateAnnotations(
    { sessionId, ref, ...input }: ZoteroReaderCreateAnnotationsRequest,
    signal: AbortSignal,
  ): Promise<ZoteroReaderCreateAnnotationsView> {
    return await domainCall<ZoteroReaderCreateAnnotationsView>(async () => {
      const { agent, service } = await requireZoteroWriteSession(
        this.ctx,
        sessionId,
        'zotero/readerCreateAnnotations',
        signal,
      )
      const attachment = parseSupportedRef(ref, ['attachment'])
      const result = await service.createAnnotations(
        { ...input, attachment },
        {
          exec: { agent, signal, name: 'zotero_reader_create_annotations' },
          plan: [
            `**Create ${input.pages.length} PDF ${input.type} annotations**`,
            WRITE_PLAN_LIBRARY_LINE,
            `- Attachment: ${planValue(ref)}`,
            `- Color: ${planValue(input.color.toLowerCase())}`,
            ...(input.comment?.trim()
              ? [`- Comment on each annotation: ${planValue(input.comment.trim().normalize())}`]
              : []),
            ...input.pages.map(
              ({ pageIndex, pageLabel, text }) =>
                `- Physical page ${pageIndex + 1} (${planValue(pageLabel.trim().normalize() || String(pageIndex + 1))}): ${planValue(text.trim().normalize())}`,
            ),
          ].join('\n'),
        },
      )
      if ('kind' in result) return { kind: 'declined' }
      return {
        kind: 'settled',
        pages: input.pages.map(({ pageIndex }, index) => {
          const created = result.created.find((entry) => entry.index === index)
          if (created) return { pageIndex, status: 'applied', ref: created.ref }
          const failed = result.failed.find((entry) => entry.index === index)
          if (failed) return { pageIndex, status: 'failed', message: failed.message }
          const unverified = result.unverified.find((entry) => entry.index === index)
          return {
            pageIndex,
            status: 'committed-unverified',
            ...(unverified?.ref ? { ref: unverified.ref } : {}),
          }
        }),
      }
    })
  }

  async readerDeleteAnnotation(
    { sessionId, ref, expectedVersion }: ZoteroReaderDeleteAnnotationRequest,
    signal: AbortSignal,
  ): Promise<ZoteroLibraryWriteResultView> {
    return await domainCall<ZoteroLibraryWriteResultView>(async () => {
      const { agent, service } = await requireZoteroWriteSession(
        this.ctx,
        sessionId,
        'zotero/readerDeleteAnnotation',
        signal,
      )
      const annotation = requireWritableRef(parseSupportedRef(ref, ['annotation']), ['annotation'])
      try {
        const result = await service.deleteAnnotation(
          { annotation, expectedVersion },
          {
            exec: { agent, signal, name: 'zotero_reader_delete_annotation' },
            risk: 'irreversible-delete',
            plan: [
              '**Permanently delete a Zotero PDF annotation**',
              WRITE_PLAN_LIBRARY_LINE,
              `- Annotation: ${planValue(ref)}`,
              `- Expected version: ${expectedVersion}`,
            ].join('\n'),
          },
        )
        if (result.kind === 'declined')
          return { kind: 'declined', message: 'Annotation deletion was declined.' }
        if (result.kind === 'committed-unverified')
          return {
            kind: 'committed-unverified',
            message: `Deletion may have committed. Check the annotation in Zotero before submitting another write. ${result.ref ?? ref}`,
          }
        return { kind: 'applied', message: `Deleted ${result.ref}.` }
      } catch (error) {
        if (
          error instanceof ZoteroError &&
          (error.code === ZOTERO_WRITE_CONFLICT || error.code === ZOTERO_NOT_FOUND)
        )
          return { kind: 'failed', code: error.code, message: error.message }
        throw error
      }
    })
  }
}

export default ReaderService
