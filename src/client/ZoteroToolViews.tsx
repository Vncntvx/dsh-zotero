/**
 * The five Zotero tool cards, registered under the keyed
 * `tool.call.toolview` slot by wire tool name. Each view derives everything
 * from the frozen call block through the shared presenters (truth ladder:
 * callView → resultView → meta → content) and renders through the shared
 * ZoteroToolRow chrome. Interactive affordances (Copy, Inspect) live in the
 * expanded body, never inside the row toggle.
 * @module dsh-zotero/client/ZoteroToolViews
 */

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  CodeBlock,
  IconBrowseOutline16,
  IconCopyOutline16,
  IconSearchOutline16,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroLocaleKey } from './locales.ts'
import {
  argsOf,
  displayRefOf,
  errorSummaryOf,
  evidenceCountOf,
  evidenceItemsOf,
  evidenceSourcesOf,
  evidenceTruncatedOf,
  interpolate,
  metaOf,
  previewsOf,
  queryOf,
  rawInputOf,
  resultTextOf,
  resultTitleOf,
  rowStateOf,
  scopeFactOf,
  searchCountsOf,
  searchRowsOf,
  shortKeyOf,
  stringField,
  titleOf,
  type ChildPreviewView,
  type EvidenceItemView,
  type SearchRowView,
} from './presenters.ts'
import { ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './ZoteroToolViews.module.css'

type RowProps = { readonly block: ToolCallBlock; readonly t: TranslateNS<'zotero'> }

interface SharedProps {
  readonly block: RowProps['block']
  readonly t: RowProps['t']
}

/** A small copy button bound to one value (one-shot feedback, timer cleaned on unmount). */
function CopyValue({ value, t }: { readonly value: string; readonly t: RowProps['t'] }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current)
    },
    [],
  )
  const onCopy = async (): Promise<void> => {
    if (!(await writeClipboard(value))) return
    setCopied(true)
    timer.current = setTimeout(() => {
      setCopied(false)
    }, 1000)
  }
  return (
    <button
      type="button"
      className={css.copyButton}
      onClick={() => {
        void onCopy()
      }}
      aria-label={t('copy')}
    >
      <IconCopyOutline16 size={14} />
      {copied ? t('copied') : t('copy')}
    </button>
  )
}

/** The degraded body: the durable content text when meta is absent or malformed. */
function FallbackBody({ text }: { readonly text: string }) {
  return <pre className={css.fallback}>{text}</pre>
}

/** One search result row: title · creator · year · type, with a copyable ref. */
function SearchResultRow({ row, t }: { readonly row: SearchRowView; readonly t: RowProps['t'] }) {
  const creator = row.creatorSummary === '' ? '' : ` · ${row.creatorSummary}`
  const year = row.year === undefined ? '' : ` · ${row.year}`
  return (
    <div className={css.resultRow}>
      <span className={css.resultText} title={row.title}>
        {row.title}
        {creator}
        {year} · {row.itemType}
      </span>
      <CopyValue value={row.ref} t={t} />
    </div>
  )
}

/** One personal note/annotation preview, kept visually apart from item metadata. */
function ChildPreviewRow({
  preview,
  label,
  t,
}: {
  readonly preview: ChildPreviewView
  readonly label: string
  readonly t: RowProps['t']
}) {
  const page =
    preview.pageLabel === undefined
      ? ''
      : ` ${t('pageLabel').replace('{label}', preview.pageLabel)}`
  return (
    <div className={css.previewRow}>
      <span className={css.previewLabel}>
        {label}
        {page}
      </span>
      <span className={css.previewText}>{preview.preview}</span>
      <CopyValue value={preview.ref} t={t} />
    </div>
  )
}

/** One evidence passage: source kind, page label when owned, expandable preview. */
function EvidenceRow({ item, t }: { readonly item: EvidenceItemView; readonly t: RowProps['t'] }) {
  const [open, setOpen] = useState(false)
  const sourceLabel = t(sourceKeyOf(item.source))
  const page =
    item.pageLabel === undefined ? '' : ` · ${t('pageLabel').replace('{label}', item.pageLabel)}`
  return (
    <div className={css.evidenceRow}>
      <div className={css.evidenceHead}>
        <span className={css.evidenceSource}>
          {sourceLabel}
          {page}
        </span>
        <span className={css.evidenceRef} title={item.sourceRef}>
          {shortKeyOf(item.sourceRef) ?? item.sourceRef}
        </span>
        {item.previewTruncated && <span className={css.evidenceFlag}>{t('truncatedPreview')}</span>}
        <button
          type="button"
          className={css.expandButton}
          aria-expanded={open}
          aria-label={open ? t('evidenceCollapseLabel') : t('evidenceExpandLabel')}
          onClick={() => {
            setOpen((value) => !value)
          }}
        >
          {open ? '▾' : '▸'}
        </button>
      </div>
      <span className={clsx(css.evidenceText, !open && css.evidenceTextClamped)}>
        {item.preview}
      </span>
    </div>
  )
}

function sourceKeyOf(source: string): ZoteroLocaleKey {
  switch (source) {
    case 'annotation':
      return 'sourceAnnotation'
    case 'note':
      return 'sourceNote'
    case 'abstract':
      return 'sourceAbstract'
    case 'fulltext':
      return 'sourceFulltext'
    default:
      return 'sourceFulltext'
  }
}

/** Safe plain-text preview of the (HTML) bibliography content; never injected as DOM. */
function plainTextOf(html: string, cap: number): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const text = doc.body.textContent ?? ''
  return text.length <= cap ? text : `${text.slice(0, cap)}…`
}

interface ExportBodyProps {
  /** The format claim from meta; absent for degraded bodies. */
  readonly format: string | undefined
  /** The flattened result text; the row only mounts the body when non-null. */
  readonly text: string
  readonly t: RowProps['t']
}

/** Body split: human formats render as plain text, machine formats as code. */
function ExportBody({ format, text, t }: ExportBodyProps) {
  if (format === 'citation' || format === 'bibliography') {
    return <pre className={css.fallback}>{plainTextOf(text, 600)}</pre>
  }
  return (
    <CodeBlock
      code={text}
      lang={
        format === 'bibtex' || format === 'biblatex' ? 'bibtex' : format === 'ris' ? 'text' : 'json'
      }
      copyLabel={t('copy')}
      copiedLabel={t('copied')}
      className={css.codeBlock}
    />
  )
}

/** `zotero_search`: pending scope facts; settled bounded rows with copyable refs. */
export function ZoteroSearchRow({ block, t }: SharedProps) {
  const state = rowStateOf(block)
  const args = argsOf(block)
  const meta = metaOf(block)
  const rows = meta === null ? null : searchRowsOf(meta)
  const counts = meta === null ? null : searchCountsOf(meta)
  const query = args === null ? '' : queryOf(args)
  const scope = args === null ? undefined : scopeFactOf(args)
  const summary =
    resultTitleOf(block) ??
    (counts !== null
      ? interpolate(t('resultsCount'), { count: counts.displayed })
      : query !== ''
        ? query
        : t('browse'))
  const facts: string[] = []
  if (state === 'running' && scope !== undefined) {
    // scopeFactOf always yields `kind:name`; the name keeps any inner colons.
    const parts = scope.split(':')
    const kind = parts.shift()!
    const name = parts.join(':')
    facts.push(
      kind === 'collection' || kind === 'savedSearch'
        ? interpolate(t(kind === 'collection' ? 'scopeCollection' : 'scopeSavedSearch'), {
            name,
          })
        : kind === 'library' && name === 'everything'
          ? t('scopeLibraryEverything')
          : t('scopeLibraryMetadata'),
    )
  }
  if (state === 'error' && 'error' in block && block.error?.code === 'ZOTERO_SERVER_MISMATCH') {
    facts.push(t('referenceMismatch'))
  }
  const omitted = counts?.omitted ?? 0
  return (
    <ZoteroToolRow
      state={state}
      title={titleOf(block, t('toolSearchTitle'))}
      summary={summary}
      icon={<IconSearchOutline16 size={14} />}
      facts={facts}
      errorSummary={errorSummaryOf(block)}
      expandable={state !== 'running' && (rows !== null || resultTextOf(block) !== null)}
      inspectLabel={t('inspectLabel')}
      runningLabel={t('checking')}
      errorLabel={t('statusUnavailable')}
      stoppedLabel={t('statusUnavailable')}
    >
      {rows !== null ? (
        <div className={css.rows}>
          {rows.map((row) => (
            <SearchResultRow key={row.ref} row={row} t={t} />
          ))}
          {omitted > 0 && (
            <span className={css.omitted}>{interpolate(t('moreOmitted'), { count: omitted })}</span>
          )}
        </div>
      ) : (
        resultTextOf(block) !== null && <FallbackBody text={resultTextOf(block)!} />
      )}
    </ZoteroToolRow>
  )
}

/** `zotero_get`: the item header line, counts, and bounded personal previews. */
export function ZoteroGetRow({ block, t }: SharedProps) {
  const state = rowStateOf(block)
  const meta = metaOf(block)
  const summary =
    state === 'running'
      ? displayRefOf(rawInputOf(block))
      : (stringField(meta ?? {}, 'title') ?? displayRefOf(rawInputOf(block)))
  const creators = stringField(meta ?? {}, 'creators') ?? ''
  const yearValue = meta === null ? undefined : (meta['year'] as number | undefined)
  const year = typeof yearValue === 'number' ? String(yearValue) : ''
  const venue = stringField(meta ?? {}, 'venue') ?? ''
  const notes = previewsOf(meta ?? {}, 'notesPreview')
  const annotations = previewsOf(meta ?? {}, 'annotationsPreview')
  const facts: string[] = []
  if (state !== 'running') {
    const header = [creators, year === '' ? '' : year, venue]
      .filter((part) => part !== '')
      .join(' · ')
    if (header !== '') facts.push(header)
    const notesTotal =
      meta === null ? undefined : (meta['notes'] as { total?: unknown } | undefined)?.total
    const annotationsTotal =
      meta === null ? undefined : (meta['annotations'] as { total?: unknown } | undefined)?.total
    const pdf =
      stringField(meta ?? {}, 'bestAttachmentContentType') === 'application/pdf' ? 'PDF' : ''
    const counts = [
      typeof notesTotal === 'number' ? `${notesTotal} ${t('personalNotes').toLowerCase()}` : '',
      typeof annotationsTotal === 'number'
        ? `${annotationsTotal} ${t('personalAnnotations').toLowerCase()}`
        : '',
      pdf,
    ].filter((part) => part !== '')
    if (counts.length > 0) facts.push(counts.join(' · '))
  }
  const hasBody =
    (notes !== null && notes.length > 0) ||
    (annotations !== null && annotations.length > 0) ||
    resultTextOf(block) !== null
  return (
    <ZoteroToolRow
      state={state}
      title={titleOf(block, t('toolGetTitle'))}
      summary={summary}
      icon={<IconBrowseOutline16 size={14} />}
      facts={facts}
      errorSummary={errorSummaryOf(block)}
      expandable={state !== 'running' && hasBody}
      inspectLabel={t('inspectLabel')}
      runningLabel={t('checking')}
      errorLabel={t('statusUnavailable')}
      stoppedLabel={t('statusUnavailable')}
    >
      {notes === null && annotations === null ? (
        resultTextOf(block) !== null && <FallbackBody text={resultTextOf(block)!} />
      ) : (
        <div className={css.rows}>
          {notes !== null && notes.length > 0 && (
            <>
              <span className={css.previewGroupLabel}>{t('personalNotes')}</span>
              {notes.map((note) => (
                <ChildPreviewRow key={note.ref} preview={note} label={t('personalNotes')} t={t} />
              ))}
            </>
          )}
          {annotations !== null && annotations.length > 0 && (
            <>
              <span className={css.previewGroupLabel}>{t('personalAnnotations')}</span>
              {annotations.map((annotation) => (
                <ChildPreviewRow
                  key={annotation.ref}
                  preview={annotation}
                  label={t('personalAnnotations')}
                  t={t}
                />
              ))}
            </>
          )}
        </div>
      )}
    </ZoteroToolRow>
  )
}

/** `zotero_retrieve`: the flagship evidence card with per-source rows. */
export function ZoteroRetrieveRow({ block, t }: SharedProps) {
  const state = rowStateOf(block)
  const args = argsOf(block)
  const meta = metaOf(block)
  const items = meta === null ? null : evidenceItemsOf(meta)
  const count = meta === null ? null : evidenceCountOf(meta)
  const sources = meta === null ? [] : evidenceSourcesOf(meta)
  const truncated = meta === null ? false : evidenceTruncatedOf(meta)
  const query = args === null ? '' : queryOf(args)
  const summary =
    state === 'running'
      ? query !== ''
        ? `"${query}"`
        : t('browse')
      : count !== null
        ? interpolate(t('evidencePassages'), { count })
        : (resultTitleOf(block) ?? t('toolRetrieveTitle'))
  const facts: string[] = []
  if (state === 'running') {
    const key = shortKeyOf(String(args?.['ref'] ?? ''))
    if (key !== null) facts.push(key)
  } else if (sources.length > 0) {
    facts.push(interpolate(t('evidenceSources'), { sources: sources.join(', ') }))
  }
  const hasBody = items !== null || resultTextOf(block) !== null
  return (
    <ZoteroToolRow
      state={state}
      title={titleOf(block, t('toolRetrieveTitle'))}
      summary={summary}
      icon={<IconSearchOutline16 size={14} />}
      facts={facts}
      errorSummary={errorSummaryOf(block)}
      expandable={state !== 'running' && hasBody}
      inspectLabel={t('inspectLabel')}
      runningLabel={t('checking')}
      errorLabel={t('statusUnavailable')}
      stoppedLabel={t('statusUnavailable')}
    >
      {items !== null ? (
        <div className={css.rows}>
          {items.map((item, index) => (
            <EvidenceRow key={`${item.sourceRef}-${index}`} item={item} t={t} />
          ))}
          {truncated && <span className={css.omitted}>{t('truncatedMore')}</span>}
        </div>
      ) : (
        resultTextOf(block) !== null && <FallbackBody text={resultTextOf(block)!} />
      )}
    </ZoteroToolRow>
  )
}

/** `zotero_attachment`: the resolved location with a copyable path/URL. */
export function ZoteroAttachmentRow({ block, t }: SharedProps) {
  const state = rowStateOf(block)
  const meta = metaOf(block)
  const kind = stringField(meta ?? {}, 'kind')
  const title = stringField(meta ?? {}, 'title')
  const contentType = stringField(meta ?? {}, 'contentType')
  const path = stringField(meta ?? {}, 'path')
  const url = stringField(meta ?? {}, 'url')
  const target = kind === 'file' ? path : url
  const summary =
    state === 'running'
      ? displayRefOf(rawInputOf(block))
      : title !== undefined && title !== ''
        ? title
        : displayRefOf(rawInputOf(block))
  const facts =
    state === 'running' || meta === null
      ? []
      : [kind === 'file' ? t('localFile') : t('linkedUrl'), contentType ?? ''].filter(
          (fact) => fact !== '',
        )
  const hasBody = target !== undefined || resultTextOf(block) !== null
  return (
    <ZoteroToolRow
      state={state}
      title={titleOf(block, t('toolAttachmentTitle'))}
      summary={summary}
      icon={<IconBrowseOutline16 size={14} />}
      facts={facts}
      errorSummary={errorSummaryOf(block)}
      expandable={state !== 'running' && hasBody}
      inspectLabel={t('inspectLabel')}
      runningLabel={t('checking')}
      errorLabel={t('statusUnavailable')}
      stoppedLabel={t('statusUnavailable')}
    >
      {target !== undefined ? (
        <div className={css.targetRow}>
          <code className={css.targetText} title={target}>
            {target}
          </code>
          <CopyValue value={target} t={t} />
        </div>
      ) : (
        resultTextOf(block) !== null && <FallbackBody text={resultTextOf(block)!} />
      )}
    </ZoteroToolRow>
  )
}

/** `zotero_export`: counts by format; text previews stay plain text, machine formats use code blocks. */
export function ZoteroExportRow({ block, t }: SharedProps) {
  const state = rowStateOf(block)
  const args = argsOf(block)
  const meta = metaOf(block)
  const format = stringField(meta ?? {}, 'format')
  const count = meta === null ? undefined : (meta['count'] as number | undefined)
  const requested = meta === null ? undefined : (meta['requested'] as number | undefined)
  const refs = Array.isArray(args?.['refs']) ? (args?.['refs'] as unknown[]).length : undefined
  const text = resultTextOf(block)
  const summary =
    state === 'running'
      ? `${refs ?? ''} refs · ${String(args?.['format'] ?? '')}`.trim()
      : format === 'citation' && typeof count === 'number'
        ? interpolate(t('citationsCount'), { count })
        : typeof requested === 'number'
          ? interpolate(t('refsRequested'), { count: requested })
          : (resultTitleOf(block) ?? t('toolExportTitle'))
  const facts: string[] = []
  if (state !== 'running') {
    const style = stringField(meta ?? {}, 'style')
    const locale = stringField(meta ?? {}, 'locale')
    facts.push([style ?? '', locale ?? ''].filter((part) => part !== '').join(' · '))
  }
  return (
    <ZoteroToolRow
      state={state}
      title={titleOf(block, t('toolExportTitle'))}
      summary={summary}
      icon={<IconBrowseOutline16 size={14} />}
      facts={facts.filter((fact) => fact !== '')}
      errorSummary={errorSummaryOf(block)}
      expandable={state !== 'running' && text !== null}
      inspectLabel={t('inspectLabel')}
      runningLabel={t('checking')}
      errorLabel={t('statusUnavailable')}
      stoppedLabel={t('statusUnavailable')}
    >
      {text !== null && <ExportBody format={format} text={text} t={t} />}
    </ZoteroToolRow>
  )
}
