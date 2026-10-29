/**
 * The library panel's inspector: the selected row's detail, restyled after
 * the reference reader's hierarchy — an eyebrow + title + creators + origin
 * head with the action row (read, copy, ask, add-to-chat), then abstract,
 * note, the info table, collection/tag chips, and the three child listings
 * (attachments, notes, annotations). The chat actions ride the session-scope
 * input face, so they render only where a composer is reachable (the right
 * sidebar tab); the main panel stays read-only.
 * @module dsh-zotero/client/components/library/LibraryInspector
 */

import { useState } from 'react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  Button,
  FileTypeIcon,
  IconChevronDownOutlineRegular,
  IconCopyOutlineRegular,
  IconFolderCloseMedium,
  IconInspectOutlineMedium,
  IconNewChatOutlineRegular,
  IconPlusOutlineRegular,
  IconQuestionOutlineRegular,
  Tag,
  type FileTypeKind,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroAnnotationRowView,
  ZoteroAttachmentLocationView,
  ZoteroAttachmentRowView,
  ZoteroChildListingKind,
  ZoteroNoteRowView,
} from '../../../contract.ts'
import { getAttachmentResolver } from '../../actions/attachment-resolver.ts'
import { formatCreatorsList } from '../../../creators.ts'
import { HTML_CONTENT_TYPE, PDF_CONTENT_TYPE } from '../../../media-types.ts'
import { CopyButton } from '../CopyButton.tsx'
import { PdfReadButton } from '../open/PdfReadButton.tsx'
import { LibraryCitationActions } from './LibraryCitationActions.tsx'
import { ListingPager } from './ListingPager.tsx'
import { pdfAttachmentOf, type LibraryItemState } from './library-model.ts'
import type { ChildKind, ChildLoadState, LibraryExportItem } from './library-feed-types.ts'
import css from './library.module.css'

interface LibraryInspectorProps {
  readonly t: TranslateNS<'zotero'>
  readonly inspector: LibraryItemState | undefined
  readonly retry: () => void
  readonly pageChild: (kind: ZoteroChildListingKind, offset: number) => void
  readonly childStates: Partial<Record<ChildKind, ChildLoadState>>
  readonly retryChild: (kind: ChildKind) => void
  /** The session's input face; present on this session-scope placement. */
  readonly inputActions: InputActions | undefined
  /** Opens a local file in the right sidebar reader; undefined when no session can anchor it. */
  readonly openFile: ((path: string) => void) | undefined
  readonly resolveAttachment:
    ((ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>) | undefined
  /** The panel's export face; the citation-copy controls stay wire-disabled without it. */
  readonly exportItem?: LibraryExportItem
}

/** One label/value row of the metadata table. */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={css.metaRow}>
      <dt className={css.metaLabel}>{label}</dt>
      <dd className={css.metaValue}>{value}</dd>
    </div>
  )
}

/** The short badge label for an attachment's content type. */
function attachmentKindOf(contentType: string): string {
  if (contentType === PDF_CONTENT_TYPE) return 'PDF'
  if (contentType === HTML_CONTENT_TYPE) return 'HTML'
  const subtype = contentType.split('/')[1]
  return (subtype ?? contentType).toUpperCase()
}

/** Maps attachment content-type and filename to an official FileTypeKind. */
function fileTypeKindFor(contentType: string, filename: string): FileTypeKind {
  if (contentType === PDF_CONTENT_TYPE) return 'pdf'
  if (contentType === HTML_CONTENT_TYPE) return 'html'
  if (contentType.includes('markdown') || filename.toLowerCase().endsWith('.md')) return 'markdown'
  return 'other'
}

const DSH_SUPPORTED_MIMES = [
  'application/pdf',
  'text/',
  'image/',
  'application/json',
  'application/xml',
]

const DSH_SUPPORTED_EXTS = new Set([
  'pdf',
  'md',
  'markdown',
  'txt',
  'text',
  'html',
  'htm',
  'json',
  'xml',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
])

function isDshSupportedAttachment(contentType: string, title: string): boolean {
  if (DSH_SUPPORTED_MIMES.some((mime) => contentType.startsWith(mime))) return true
  const ext = title.split('.').pop()?.toLowerCase()
  return ext !== undefined && DSH_SUPPORTED_EXTS.has(ext)
}

function AttachmentItem({
  t,
  attachment,
  openFile,
  resolveAttachment,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly attachment: ZoteroAttachmentRowView
  readonly openFile: ((path: string) => void) | undefined
  readonly resolveAttachment:
    ((ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>) | undefined
}) {
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supported = isDshSupportedAttachment(attachment.contentType, attachment.title)
  const canOpen = supported && (openFile !== undefined || resolveAttachment !== undefined)

  const handleOpen = async () => {
    if (!canOpen || resolving) return
    setError(null)
    setResolving(true)
    try {
      const resolver = resolveAttachment ?? getAttachmentResolver()
      if (!resolver) return
      const res = await resolver(attachment.ref)
      if (res.ok) {
        if (res.value.kind === 'file' && res.value.path) {
          if (openFile) openFile(res.value.path)
        } else if (res.value.kind === 'url' && res.value.url) {
          window.open(res.value.url, '_blank', 'noopener,noreferrer')
        }
      } else {
        setError(res.error.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setResolving(false)
    }
  }

  const content = (
    <>
      <div className={css.childInfo}>
        <FileTypeIcon
          kind={fileTypeKindFor(attachment.contentType, attachment.title)}
          size={18}
          className={css.childFileIcon}
        />
        <span className={css.childTitle} title={error ?? attachment.title}>
          {resolving ? `${attachment.title} (${t('libraryLoading')})` : attachment.title}
        </span>
      </div>
      <span className={css.childKind}>{attachmentKindOf(attachment.contentType)}</span>
    </>
  )

  if (canOpen) {
    return (
      <li>
        <button
          type="button"
          className={clsx(css.childRow, css.childRowClickable)}
          onClick={handleOpen}
          disabled={resolving}
          aria-label={attachment.title}
          title={error ?? (supported ? t('readPdfInSidebar') : attachment.title)}
        >
          {content}
        </button>
      </li>
    )
  }

  return <li className={css.childRow}>{content}</li>
}

function NoteItem({
  t,
  note,
  inputActions,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly note: ZoteroNoteRowView
  readonly inputActions: InputActions | undefined
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = note.truncated || note.text.length > 180 || note.text.split('\n').length > 4

  const handleInsert = () => {
    if (!inputActions) return
    const span = inputActions.captureInsertion()
    if (span !== undefined) {
      inputActions.insertText(note.text, span)
    }
  }

  return (
    <li className={css.noteCard}>
      <div className={clsx(css.noteText, isLong && !expanded && css.cardClamped)}>{note.text}</div>
      {note.truncated && !expanded && (
        <span className={css.truncatedHint}>{t('libraryAbstractTruncated')}</span>
      )}
      <div className={css.cardFooter}>
        {isLong ? (
          <button
            type="button"
            className={css.cardToggle}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <span>{expanded ? t('libraryCollapse') : t('libraryExpand')}</span>
            <IconChevronDownOutlineRegular
              size={12}
              className={clsx(css.toggleChevron, expanded && css.toggleChevronOpen)}
            />
          </button>
        ) : (
          <span />
        )}
        <div className={css.cardActions}>
          <CopyButton
            value={note.text}
            label={t('copy')}
            copiedLabel={t('copied')}
            className={css.cardActionBtn}
            icon={<IconCopyOutlineRegular size={11} />}
            title={t('libraryCopyNote')}
          />
          {inputActions !== undefined && (
            <button
              type="button"
              className={css.cardActionBtn}
              onClick={handleInsert}
              title={t('libraryInsertNote')}
              aria-label={t('libraryInsertNote')}
            >
              <IconNewChatOutlineRegular size={11} />
              <span>{t('libraryInsertNote')}</span>
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

function AnnotationItem({
  t,
  annotation,
  inputActions,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly annotation: ZoteroAnnotationRowView
  readonly inputActions: InputActions | undefined
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = annotation.text.length > 180 || annotation.text.split('\n').length > 4

  const handleInsert = () => {
    if (!inputActions) return
    const span = inputActions.captureInsertion()
    if (span !== undefined) {
      const pageInfo = annotation.pageLabel ? ` (P. ${annotation.pageLabel})` : ''
      const quote = `> "${annotation.text}"${pageInfo}\n\n`
      inputActions.insertText(quote, span)
    }
  }

  return (
    <li className={css.annotationCard}>
      <div className={css.annotationHeader}>
        {annotation.pageLabel !== undefined ? (
          <span className={css.pageBadge}>
            {t('libraryAnnotationPageBadge', { page: annotation.pageLabel })}
          </span>
        ) : (
          <span />
        )}
        <div className={css.cardActions}>
          <CopyButton
            value={annotation.text}
            label={t('copy')}
            copiedLabel={t('copied')}
            className={css.cardActionBtn}
            icon={<IconCopyOutlineRegular size={11} />}
            title={t('libraryCopyQuote')}
          />
          {inputActions !== undefined && (
            <button
              type="button"
              className={css.cardActionBtn}
              onClick={handleInsert}
              title={t('libraryInsertQuote')}
              aria-label={t('libraryInsertQuote')}
            >
              <IconNewChatOutlineRegular size={11} />
              <span>{t('libraryInsertQuote')}</span>
            </button>
          )}
        </div>
      </div>

      {annotation.text !== '' && (
        <blockquote className={clsx(css.annotationQuote, isLong && !expanded && css.cardClamped)}>
          {annotation.text}
        </blockquote>
      )}

      {isLong && (
        <button
          type="button"
          className={css.cardToggle}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span>{expanded ? t('libraryCollapse') : t('libraryExpand')}</span>
          <IconChevronDownOutlineRegular
            size={12}
            className={clsx(css.toggleChevron, expanded && css.toggleChevronOpen)}
          />
        </button>
      )}

      {annotation.comment !== undefined && annotation.comment !== '' && (
        <div className={css.annotationComment}>
          <span className={css.commentIcon} aria-hidden="true">
            💬
          </span>
          <p className={css.commentText}>{annotation.comment}</p>
        </div>
      )}
    </li>
  )
}

export function LibraryInspector({
  t,
  inspector,
  inputActions,
  openFile,
  resolveAttachment,
  retry,
  pageChild,
  childStates,
  retryChild,
  exportItem,
}: LibraryInspectorProps) {
  // The abstract's expand state resets with the selection: the section
  // remounts through the inspector's key when another row is picked.
  const [abstractOpen, setAbstractOpen] = useState(false)
  if (inspector === undefined) {
    return (
      <aside className={css.inspector} aria-label={t('libraryInspector')}>
        <div className={css.inspectorEmpty}>
          <div className={css.emptyStateWrapper}>
            <IconInspectOutlineMedium className={css.emptyStateIcon} />
            <p className={css.emptyStateTitle}>{t('libraryNoSelection')}</p>
          </div>
        </div>
      </aside>
    )
  }
  if (inspector.phase === 'loading') {
    return (
      <aside className={css.inspector} aria-label={t('libraryInspector')}>
        <p className={css.listNote} role="status">
          {t('libraryLoading')}
        </p>
      </aside>
    )
  }
  if (inspector.phase === 'error') {
    return (
      <aside className={css.inspector} aria-label={t('libraryInspector')}>
        <p className={css.listError} role="alert">
          {inspector.message}
        </p>
        <Button
          variant="outline"
          size="sm"
          aria-label={`${t('libraryInspector')}: ${t('libraryRetry')}`}
          onClick={retry}
        >
          {t('libraryRetry')}
        </Button>
      </aside>
    )
  }
  const detail = inspector.detail
  const creators = formatCreatorsList(detail.creators)
  const origin = [detail.venue, detail.date].filter(Boolean).join(' · ')
  const pdfAttachment = pdfAttachmentOf(detail)
  const citeLine = t('libraryCiteLine', { title: detail.title, ref: detail.ref })
  const askInChat = () => {
    inputActions?.setDraft(t('libraryAskTemplate', { title: detail.title, ref: detail.ref }))
  }
  const addToChat = () => {
    const span = inputActions?.captureInsertion()
    if (span !== undefined) inputActions?.insertText(citeLine, span)
  }
  return (
    <aside className={css.inspector} aria-label={t('libraryInspector')}>
      <header className={css.inspectorHead}>
        <p className={css.inspectorEyebrow}>{detail.itemType}</p>
        <h3 className={css.inspectorTitle}>{detail.title}</h3>
        {creators !== '' && <p className={css.inspectorCreators}>{creators}</p>}
        {origin !== '' && <p className={css.inspectorOrigin}>{origin}</p>}
        <div className={css.inspectorActions}>
          {pdfAttachment !== undefined && (
            <PdfReadButton
              attachmentRef={pdfAttachment.ref}
              onOpenFile={openFile}
              resolveAttachment={resolveAttachment}
              requireSessionForResolvedFile={openFile === undefined}
              emphasis="primary"
              t={t}
            />
          )}
          {inputActions !== undefined && (
            <>
              <Button
                variant="outline"
                size="sm"
                icon={<IconQuestionOutlineRegular size={14} />}
                onClick={askInChat}
              >
                {t('libraryAskInChat')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={<IconPlusOutlineRegular size={14} />}
                onClick={addToChat}
              >
                {t('libraryAddToChat')}
              </Button>
            </>
          )}
          <LibraryCitationActions detail={detail} exportItem={exportItem} t={t} />
          <CopyButton
            value={detail.ref}
            label={t('copyRef')}
            copiedLabel={t('copied')}
            title={t('copyZoteroLinkTooltip')}
            icon={<IconCopyOutlineRegular size={14} />}
            asButton
          />
        </div>
      </header>

      {detail.abstract !== undefined && (
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('libraryMetaAbstract')}</h4>
          <p
            className={clsx(
              css.abstract,
              detail.abstractTruncated && !abstractOpen && css.abstractClamped,
            )}
          >
            {detail.abstract}
          </p>
          {detail.abstractTruncated && (
            <button
              type="button"
              className={css.abstractToggle}
              aria-expanded={abstractOpen}
              onClick={() => setAbstractOpen((open) => !open)}
            >
              <span>{abstractOpen ? t('libraryCollapse') : t('libraryExpand')}</span>
              <IconChevronDownOutlineRegular
                size={12}
                className={clsx(css.toggleChevron, abstractOpen && css.toggleChevronOpen)}
              />
            </button>
          )}
        </section>
      )}

      {detail.noteBody !== undefined && (
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('libraryMetaNote')}</h4>
          <p className={css.abstract}>{detail.noteBody.text}</p>
          {detail.noteBody.truncated && (
            <p className={css.listNote}>{t('libraryAbstractTruncated')}</p>
          )}
        </section>
      )}

      {(detail.venue !== undefined ||
        detail.date !== undefined ||
        detail.doi !== undefined ||
        detail.url !== undefined ||
        detail.extra !== undefined) && (
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('libraryInfoTitle')}</h4>
          <dl className={css.metaTable}>
            {detail.venue !== undefined && (
              <MetaRow label={t('libraryMetaVenue')} value={detail.venue} />
            )}
            {detail.date !== undefined && (
              <MetaRow label={t('libraryMetaDate')} value={detail.date} />
            )}
            {detail.doi !== undefined && (
              <div className={css.metaRow}>
                <dt className={css.metaLabel}>{t('libraryMetaDoi')}</dt>
                <dd className={css.metaValue}>
                  <CopyButton
                    value={detail.doi}
                    label={detail.doi}
                    copiedLabel={t('copied')}
                    className={css.copyInline}
                  />
                </dd>
              </div>
            )}
            {detail.url !== undefined && (
              <div className={css.metaRow}>
                <dt className={css.metaLabel}>{t('libraryMetaUrl')}</dt>
                <dd className={css.metaValue}>
                  <CopyButton
                    value={detail.url}
                    label={detail.url}
                    copiedLabel={t('copied')}
                    className={css.copyInline}
                  />
                </dd>
              </div>
            )}
            {detail.extra !== undefined && (
              <MetaRow label={t('libraryMetaExtra')} value={detail.extra} />
            )}
          </dl>
        </section>
      )}

      {detail.collections.length > 0 && (
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('libraryMetaCollections')}</h4>
          <div className={css.chipRow}>
            {detail.collections.map((collection) => (
              <Tag key={collection.ref} tone="outline" className={css.chip}>
                <IconFolderCloseMedium size={11} className={css.chipIcon} />
                <span>{collection.name ?? collection.ref}</span>
              </Tag>
            ))}
          </div>
        </section>
      )}

      {detail.tags.length > 0 && (
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('libraryMetaTags')}</h4>
          <div className={css.chipRow}>
            {detail.tags.map((tag) => (
              <Tag key={tag} tone="outline" className={css.chip}>
                <span>{tag}</span>
              </Tag>
            ))}
          </div>
        </section>
      )}

      {detail.attachments !== undefined && detail.attachments.total > 0 && (
        <ChildSection
          t={t}
          title={t('libraryAttachmentsTitle', { count: detail.attachments.total })}
          page={detail.attachments}
          state={childStates.attachments}
          retry={() => retryChild('attachments')}
          pageTo={(offset) => pageChild('attachments', offset)}
        >
          {detail.attachments.items.map((attachment) => (
            <AttachmentItem
              key={attachment.ref}
              t={t}
              attachment={attachment}
              openFile={openFile}
              resolveAttachment={resolveAttachment}
            />
          ))}
        </ChildSection>
      )}

      {detail.notes !== undefined && detail.notes.total > 0 && (
        <ChildSection
          t={t}
          title={t('libraryNotesTitle', { count: detail.notes.total })}
          page={detail.notes}
          state={childStates.notes}
          retry={() => retryChild('notes')}
          pageTo={(offset) => pageChild('notes', offset)}
        >
          {detail.notes.items.map((note) => (
            <NoteItem key={note.ref} t={t} note={note} inputActions={inputActions} />
          ))}
        </ChildSection>
      )}

      {detail.annotations !== undefined && detail.annotations.total > 0 && (
        <ChildSection
          t={t}
          title={t('libraryAnnotationsTitle', { count: detail.annotations.total })}
          page={detail.annotations}
          state={childStates.annotations}
          retry={() => retryChild('annotations')}
          pageTo={(offset) => pageChild('annotations', offset)}
        >
          {detail.annotations.items.map((annotation) => (
            <AnnotationItem
              key={annotation.ref}
              t={t}
              annotation={annotation}
              inputActions={inputActions}
            />
          ))}
        </ChildSection>
      )}
    </aside>
  )
}

/** One child listing: its title, its rows, and the page control underneath. */
function ChildSection({
  t,
  title,
  page,
  state,
  retry,
  pageTo,
  children,
  defaultOpen = true,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly title: string
  readonly page: {
    readonly total: number
    readonly returned: number
    readonly offset: number
    readonly limit: number
    readonly nextOffset?: number
  }
  readonly state: ChildLoadState | undefined
  readonly retry: () => void
  readonly pageTo: (offset: number) => void
  readonly children: ReactNode
  readonly defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={css.section}>
      <button
        type="button"
        className={css.sectionHeaderBtn}
        aria-expanded={open}
        aria-label={
          open ? t('librarySectionCollapse', { title }) : t('librarySectionExpand', { title })
        }
        onClick={() => setOpen((prev) => !prev)}
      >
        <h4 className={css.sectionTitle}>{title}</h4>
        <IconChevronDownOutlineRegular
          size={12}
          className={clsx(css.toggleChevron, open && css.toggleChevronOpen)}
        />
      </button>
      {open && (
        <>
          <ul className={css.childList}>{children}</ul>
          <ChildPager
            t={t}
            label={title}
            offset={page.offset}
            limit={page.limit}
            total={page.total}
            returned={page.returned}
            nextOffset={page.nextOffset}
            setOffset={pageTo}
            state={state}
            retry={retry}
          />
        </>
      )}
    </section>
  )
}

function ChildPager({
  t,
  label,
  offset,
  limit,
  total,
  returned,
  nextOffset,
  setOffset,
  state,
  retry,
}: {
  readonly state: ChildLoadState | undefined
  readonly retry: () => void
  readonly t: TranslateNS<'zotero'>
  readonly label: string
  readonly offset: number
  readonly limit: number
  readonly total: number
  readonly returned: number
  readonly nextOffset: number | undefined
  readonly setOffset: (offset: number) => void
}) {
  if (offset === 0 && nextOffset === undefined && state === undefined) return null
  return (
    <div className={css.childPager}>
      <ListingPager
        t={t}
        status={state}
        retry={retry}
        pager={{ label, offset, limit, total, returned, nextOffset }}
        onPage={setOffset}
      />
    </div>
  )
}
