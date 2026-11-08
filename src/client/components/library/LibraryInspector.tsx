import { useLibraryPreferences, useLibraryScroll } from '../../library-preferences.tsx'
import type { LibrarySection } from '../../../library-preferences.ts'
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
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconCopyOutlineRegular,
  IconFolderCloseMedium,
  IconInspectOutlineMedium,
  IconLinkOutlineRegular,
  IconNewChatOutlineRegular,
  IconPlusOutlineRegular,
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
import { parseRefIdentity, pdfUrlOf, selectUrlOf } from '../../actions/open-zotero.ts'
import { formatCreatorsList } from '../../../creators.ts'
import { HTML_CONTENT_TYPE, PDF_CONTENT_TYPE, isPdfContentType } from '../../../media-types.ts'
import { isObjectKey } from '../../../json.ts'
import { CopyButton } from '../CopyButton.tsx'
import { IconButton } from '../IconButton.tsx'
import { useCopyFeedback } from '../useCopyFeedback.ts'
import { CommentIcon } from '../CommentIcon.tsx'
import { PdfReadButton } from '../open/PdfReadButton.tsx'
import { LibraryCitationActions, itemInfoTextOf } from './LibraryCitationActions.tsx'
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
  /** Host-backed protocol launcher from the shared client face. */
  readonly openProtocol?: (url: string) => Promise<boolean>
  /** The panel's export face; the citation-copy controls stay wire-disabled without it. */
  readonly readPdf?: (ref: string) => Promise<void>
  readonly exportItem?: LibraryExportItem
}

/** One label/value row of the metadata table. */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={css.metaRow}>
      <dt className={clsx(css.caption, css.metaLabel)}>{label}</dt>
      <dd className={css.metaValue}>{value}</dd>
    </div>
  )
}

/** One copyable label/value row of the metadata table (DOI, URL). */
function CopyableMetaRow({
  label,
  value,
  openUrl,
  t,
}: {
  readonly label: string
  readonly value: string
  readonly openUrl?: string
  readonly t: TranslateNS<'zotero'>
}) {
  const { phase, copyText } = useCopyFeedback(value)
  const copied = phase === 'done'

  return (
    <div className={css.metaRow}>
      <dt className={clsx(css.caption, css.metaLabel)}>{label}</dt>
      <dd className={css.metaValue}>
        <div className={css.metaCopyRow}>
          <span className={css.metaText}>{value}</span>
          <div className={css.metaCopyActions}>
            <IconButton
              size="sm"
              shape="square"
              icon={
                copied ? (
                  <IconCheckOutlineRegular size={12} />
                ) : (
                  <IconCopyOutlineRegular size={12} />
                )
              }
              aria-label={value}
              title={copied ? t('copied') : `${value} (${t('copy')})`}
              onClick={(e) => {
                e.stopPropagation()
                copyText(value)
              }}
              className={css.metaCopyBtn}
            />
            {openUrl !== undefined && (
              <IconButton
                size="sm"
                shape="square"
                icon={<IconLinkOutlineRegular size={12} />}
                aria-label={`${openUrl} (${t('openInZotero')})`}
                title={openUrl}
                onClick={(e) => {
                  e.stopPropagation()
                  window.open(openUrl, '_blank', 'noopener,noreferrer')
                }}
                className={css.metaCopyBtn}
              />
            )}
          </div>
        </div>
      </dd>
    </div>
  )
}

/** The short badge label for an attachment's content type. */
function attachmentKindOf(contentType: string, t: TranslateNS<'zotero'>): string {
  if (contentType === PDF_CONTENT_TYPE) return t('badgePdf')
  if (contentType === HTML_CONTENT_TYPE) return t('badgeHtml')
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
  openProtocol,
  readPdf,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly attachment: ZoteroAttachmentRowView
  readonly openFile: ((path: string) => void) | undefined
  readonly resolveAttachment:
    ((ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>) | undefined
  readonly openProtocol?: (url: string) => Promise<boolean>
  readonly readPdf?: (ref: string) => Promise<void>
}) {
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supported = isDshSupportedAttachment(attachment.contentType, attachment.title)
  const canOpen = supported && resolveAttachment !== undefined

  const handleOpen = async () => {
    if (!canOpen || resolving) return
    setError(null)
    setResolving(true)
    try {
      if (isPdfContentType(attachment.contentType) && readPdf) {
        await readPdf(attachment.ref)
        return
      }
      const resolver = resolveAttachment
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
      <span className={css.childKind}>{attachmentKindOf(attachment.contentType, t)}</span>
    </>
  )

  if (canOpen) {
    return (
      <li>
        <Button
          variant="ghost"
          size="sm"
          className={clsx(css.childRow, css.childRowSeat)}
          onClick={handleOpen}
          disabled={resolving}
          aria-label={attachment.title}
          title={error ?? (supported ? t('readPdfInSidebar') : attachment.title)}
        >
          {content}
        </Button>
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
    inputActions.insertQuote(note.text.replace(/\r\n?/gu, '\n'))
  }

  return (
    <li className={css.noteCard}>
      <div className={clsx(css.noteText, isLong && !expanded && css.cardClamped)}>{note.text}</div>
      {note.truncated && !expanded && (
        <span className={css.truncatedHint}>{t('libraryAbstractTruncated')}</span>
      )}
      <div className={css.cardFooter}>
        {isLong ? (
          <Button
            variant="ghost"
            size="sm"
            className={css.toggleSeat}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <span>{expanded ? t('libraryCollapse') : t('libraryExpand')}</span>
            <IconChevronDownOutlineRegular
              size={12}
              className={clsx(css.toggleChevron, expanded && css.toggleChevronOpen)}
            />
          </Button>
        ) : (
          <span />
        )}
        <div className={css.cardActions}>
          <CopyButton
            value={note.text}
            label={t('copy')}
            copiedLabel={t('copied')}
            className={css.actionSeat}
            icon={<IconCopyOutlineRegular size={11} />}
            title={t('libraryCopyNote')}
          />
          {inputActions !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              className={css.actionSeat}
              icon={<IconNewChatOutlineRegular size={11} />}
              onClick={handleInsert}
              title={t('libraryInsertNote')}
              aria-label={t('libraryInsertNote')}
            >
              {t('libraryInsertNote')}
            </Button>
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
  targetAttachmentRef,
  openProtocol,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly annotation: ZoteroAnnotationRowView
  readonly inputActions: InputActions | undefined
  readonly targetAttachmentRef?: string
  readonly openProtocol?: (url: string) => Promise<boolean>
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = annotation.text.length > 180 || annotation.text.split('\n').length > 4

  const handleInsert = () => {
    if (!inputActions) return
    const pageInfo = annotation.pageLabel
      ? t('annotationPageSuffix', { page: annotation.pageLabel })
      : ''
    const quote = `"${annotation.text}"${pageInfo}`
    inputActions.insertQuote(quote)
  }

  const identity = parseRefIdentity(annotation.ref)
  const annotationKey =
    identity &&
    (identity.kind === 'annotation' || identity.kind === 'item') &&
    isObjectKey(identity.key)
      ? identity.key
      : undefined
  const annotationUrl =
    targetAttachmentRef && annotationKey
      ? pdfUrlOf(targetAttachmentRef, { annotation: annotationKey })
      : null

  return (
    <li className={css.annotationCard}>
      <div className={css.annotationHeader}>
        {annotation.pageLabel !== undefined ? (
          <Tag tone="neutral">
            {t('libraryAnnotationPageBadge', { page: annotation.pageLabel })}
          </Tag>
        ) : (
          <span />
        )}
        <div className={css.cardActions}>
          {annotationUrl !== null && (
            <Button
              variant="ghost"
              size="sm"
              className={css.actionSeat}
              icon={<IconLinkOutlineRegular size={11} />}
              onClick={() => {
                if (openProtocol !== undefined) void openProtocol(annotationUrl)
              }}
              title={t('openInZoteroTooltip')}
              aria-label={t('openInZotero')}
            >
              {t('openInZotero')}
            </Button>
          )}
          <CopyButton
            value={annotation.text}
            label={t('copy')}
            copiedLabel={t('copied')}
            className={css.actionSeat}
            icon={<IconCopyOutlineRegular size={11} />}
            title={t('libraryCopyQuote')}
          />
          {inputActions !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              className={css.actionSeat}
              icon={<IconNewChatOutlineRegular size={11} />}
              onClick={handleInsert}
              title={t('libraryInsertQuote')}
              aria-label={t('libraryInsertQuote')}
            >
              {t('libraryInsertQuote')}
            </Button>
          )}
        </div>
      </div>

      {annotation.text !== '' && (
        <blockquote className={clsx(css.annotationQuote, isLong && !expanded && css.cardClamped)}>
          {annotation.text}
        </blockquote>
      )}

      {isLong && (
        <Button
          variant="ghost"
          size="sm"
          className={css.toggleSeat}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span>{expanded ? t('libraryCollapse') : t('libraryExpand')}</span>
          <IconChevronDownOutlineRegular
            size={12}
            className={clsx(css.toggleChevron, expanded && css.toggleChevronOpen)}
          />
        </Button>
      )}

      {annotation.comment !== undefined && annotation.comment !== '' && (
        <div className={css.annotationComment}>
          <CommentIcon size={14} className={css.commentIcon} />
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
  openProtocol,
  retry,
  pageChild,
  childStates,
  retryChild,
  exportItem,
  readPdf,
}: LibraryInspectorProps) {
  // The abstract's expand state resets with the selection: the section
  // remounts through the inspector's key when another row is picked.
  const scroll = useLibraryScroll(
    `inspector:${inspector?.phase === 'ready' ? inspector.detail.ref : ''}`,
    inspector?.phase === 'ready',
  )
  const preferences = useLibraryPreferences()
  const [insertError, setInsertError] = useState<string>()
  if (inspector === undefined) {
    return (
      <aside className={css.inspector} aria-label={t('libraryInspector')} {...scroll}>
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
      <aside className={css.inspector} aria-label={t('libraryInspector')} {...scroll}>
        <p className={css.listNote} role="status">
          {t('libraryLoading')}
        </p>
      </aside>
    )
  }
  if (inspector.phase === 'error') {
    return (
      <aside className={css.inspector} aria-label={t('libraryInspector')} {...scroll}>
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
  const askPrompt = t('libraryAskPrompt', { title: detail.title, ref: detail.ref })
  const askInChat = () => {
    if (!inputActions) return
    const information = [askPrompt, itemInfoTextOf(detail), detail.ref]
    if (preferences.preferences?.chatInsertContent === 'referenceAndAbstract') {
      information.push(
        detail.abstract === undefined
          ? t('libraryAbstractMissing')
          : `${detail.abstractTruncated ? t('libraryInsertedAbstractTruncated') : t('libraryMetaAbstract')}\n${detail.abstract}`,
      )
    }
    if (inputActions.insertQuote(information.join('\n\n'))) {
      inputActions.persistDraft()
      setInsertError(undefined)
    } else setInsertError(t('libraryInsertFailed'))
  }
  return (
    <aside className={css.inspector} aria-label={t('libraryInspector')} {...scroll}>
      {insertError && <p role="alert">{insertError}</p>}
      <header className={css.inspectorHead}>
        <p className={clsx(css.caption, css.inspectorEyebrow)}>{detail.itemType}</p>
        <h3 className={css.inspectorTitle}>{detail.title}</h3>
        {creators !== '' && <p className={css.inspectorCreators}>{creators}</p>}
        {origin !== '' && <p className={css.inspectorOrigin}>{origin}</p>}
        <div className={css.inspectorActions}>
          {pdfAttachment !== undefined && (
            <PdfReadButton
              onReadAttachment={readPdf}
              attachmentRef={pdfAttachment.ref}
              onOpenFile={openFile}
              resolveAttachment={resolveAttachment}
              requireSessionForResolvedFile={openFile === undefined}
              emphasis="primary"
              t={t}
            />
          )}
          {inputActions !== undefined && (
            <Button
              variant="outline"
              size="sm"
              icon={<IconPlusOutlineRegular size={14} />}
              onClick={askInChat}
              title={t('libraryAskInChat')}
            >
              {t('libraryAskInChat')}
            </Button>
          )}
          <LibraryCitationActions detail={detail} exportItem={exportItem} t={t} />
          {selectUrlOf(detail.ref) !== null && (
            <Button
              variant="outline"
              size="sm"
              icon={<IconLinkOutlineRegular size={14} />}
              onClick={() => {
                const url = selectUrlOf(detail.ref)
                if (url && openProtocol !== undefined) void openProtocol(url)
              }}
              title={t('openInZoteroTooltip')}
            >
              {t('openInZotero')}
            </Button>
          )}
        </div>
      </header>

      {detail.abstract !== undefined && (
        <DetailDisclosure
          section="abstract"
          itemRef={detail.ref}
          title={t('libraryMetaAbstract')}
          t={t}
        >
          <p className={css.abstract}>{detail.abstract}</p>
          {detail.abstractTruncated && (
            <p className={css.listNote}>{t('libraryAbstractTruncated')}</p>
          )}
        </DetailDisclosure>
      )}
      {detail.noteBody !== undefined && (
        <DetailDisclosure section="notes" itemRef={detail.ref} title={t('libraryMetaNote')} t={t}>
          <p className={css.abstract}>{detail.noteBody.text}</p>
          {detail.noteBody.truncated && (
            <p className={css.listNote}>{t('libraryAbstractTruncated')}</p>
          )}
        </DetailDisclosure>
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
              <CopyableMetaRow
                label={t('libraryMetaDoi')}
                value={detail.doi}
                openUrl={
                  detail.doi.startsWith('http://') || detail.doi.startsWith('https://')
                    ? detail.doi
                    : `https://doi.org/${encodeURI(detail.doi.trim())}`
                }
                t={t}
              />
            )}
            {detail.url !== undefined && (
              <CopyableMetaRow
                label={t('libraryMetaUrl')}
                value={detail.url}
                openUrl={detail.url}
                t={t}
              />
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
          section="attachments"
          itemRef={detail.ref}
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
              readPdf={readPdf}
              openFile={openFile}
              resolveAttachment={resolveAttachment}
              openProtocol={openProtocol}
            />
          ))}
        </ChildSection>
      )}

      {detail.notes !== undefined && detail.notes.total > 0 && (
        <ChildSection
          t={t}
          title={t('libraryNotesTitle', { count: detail.notes.total })}
          section="notes"
          itemRef={detail.ref}
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
          section="annotations"
          itemRef={detail.ref}
          page={detail.annotations}
          state={childStates.annotations}
          retry={() => retryChild('annotations')}
          pageTo={(offset) => pageChild('annotations', offset)}
        >
          {detail.annotations.items.map((annotation) => {
            const targetAttachmentRef =
              annotation.parentRef ??
              detail.attachments?.items.find((att) => isPdfContentType(att.contentType))?.ref ??
              detail.attachments?.items[0]?.ref
            return (
              <AnnotationItem
                key={annotation.ref}
                t={t}
                annotation={annotation}
                inputActions={inputActions}
                targetAttachmentRef={targetAttachmentRef}
                openProtocol={openProtocol}
              />
            )
          })}
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
  defaultOpen,
  section,
  itemRef,
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
  readonly section: LibrarySection
  readonly itemRef: string
}) {
  const [open, setOpen] = useDisclosure(section, itemRef, defaultOpen)
  return (
    <section className={css.section}>
      <Button
        variant="ghost"
        size="sm"
        className={css.sectionHeaderSeat}
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
      </Button>
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
        pager={{ page: { label, offset, limit, total, returned, nextOffset }, onPage: setOffset }}
      />
    </div>
  )
}

/** Per-item manual choices survive view remounts; accepted defaults affect untouched sections. */
function useDisclosure(
  section: LibrarySection,
  itemRef: string,
  initial?: boolean,
): [boolean, (update: (value: boolean) => boolean) => void] {
  const { preferences, memory } = useLibraryPreferences()
  const [manual, setManual] = useState<{ ref: string; value: boolean }>()
  const override =
    manual?.ref === itemRef
      ? manual.value
      : memory?.disclosure?.ref === itemRef
        ? memory.disclosure.overrides[section]
        : undefined
  const open = override ?? initial ?? preferences?.detailExpandedSections.includes(section) ?? false
  return [
    open,
    (update) => {
      const value = update(open)
      setManual({ ref: itemRef, value })
      if (memory) {
        if (memory.disclosure?.ref !== itemRef) memory.disclosure = { ref: itemRef, overrides: {} }
        memory.disclosure.overrides[section] = value
      }
    },
  ]
}
function DetailDisclosure({
  section,
  itemRef,
  title,
  t,
  children,
}: {
  section: LibrarySection
  itemRef: string
  title: string
  t: TranslateNS<'zotero'>
  children: ReactNode
}) {
  const [open, setOpen] = useDisclosure(section, itemRef)
  return (
    <section className={css.section}>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-label={
          open ? t('librarySectionCollapse', { title }) : t('librarySectionExpand', { title })
        }
        onClick={() => setOpen((v) => !v)}
      >
        {title}
      </Button>
      {open && children}
    </section>
  )
}
