/**
 * Dedicated toolview cards for Zotero write operations:
 * `zotero_create_note`, `zotero_add_tags`, and `zotero_add_to_collection`.
 * Renders write receipts, tags, and plan-review decline notices.
 * @module dsh-zotero/client/toolviews/WriteToolView
 */

import { useMemo } from 'react'
import {
  IconBranchOutlineRegular,
  IconEditOutlineRegular,
  IconPlusOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ZoteroOpenLink } from '../components/open/ZoteroOpenLink.tsx'
import { selectUrlOf } from '../actions/open-zotero.ts'
import {
  argsOf,
  errorSummaryOf,
  isDeclinedOf,
  resultTextOf,
  rowStateOf,
  shortKeyOf,
  stringField,
} from '../presenters.ts'
import { RunningNotice, RawTextFallback, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

export type WriteToolViewProps = PropsRuntime<
  'tool.call.toolview',
  'zotero_create_note' | 'zotero_add_tags' | 'zotero_add_to_collection'
> &
  PropsLocale<'zotero'>

function noteTitleOf(markdown: string | undefined, defaultTitle: string): string {
  if (!markdown) return defaultTitle
  const firstLine = markdown
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!firstLine) return defaultTitle
  const cleaned = firstLine.replace(/^[#*> \-\t]+/, '').trim()
  return cleaned || defaultTitle
}

export function WriteToolView(props: WriteToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const { icon, title, summary, errorSummary, parentRef, parentSelectUrl, tagsList, rawText } =
    useMemo(() => {
      const args = argsOf(block)
      const raw = (resultTextOf(block) ?? '').trim()

      let ic = <IconEditOutlineRegular size={14} />
      let tit = t('toolTitleCreateNote')
      let sum = ''

      const tags = Array.isArray(args?.['tags'])
        ? (args['tags'].filter((x) => typeof x === 'string') as string[])
        : []

      if (toolName === 'zotero_add_tags') {
        ic = <IconPlusOutlineRegular size={14} />
        tit = t('toolTitleAddTags')
        sum = t('toolSummaryAddTags', { count: tags.length })
      } else if (toolName === 'zotero_add_to_collection') {
        ic = <IconBranchOutlineRegular size={14} />
        tit = t('toolTitleAddToCollection')
        const collectionArg = stringField(args ?? {}, 'collection') ?? ''
        const collectionName = shortKeyOf(collectionArg) ?? collectionArg.trim()
        sum = t('toolSummaryAddToCollection', { name: collectionName })
      } else {
        // zotero_create_note
        const markdown = stringField(args ?? {}, 'markdown')
        const noteTitle = noteTitleOf(markdown, t('toolDefaultNoteTitle'))
        sum = t('toolSummaryCreateNote', { title: noteTitle })
      }

      const errSummary = errorSummaryOf(block, raw)
      const pRef = stringField(args ?? {}, 'parentItem') ?? stringField(args ?? {}, 'ref')
      const pUrl = pRef ? selectUrlOf(pRef) : null

      return {
        icon: ic,
        title: tit,
        summary: sum,
        errorSummary: errSummary,
        parentRef: pRef,
        parentSelectUrl: pUrl,
        tagsList: tags,
        rawText: raw,
      }
    }, [block, t, toolName])

  return (
    <ZoteroToolRow
      toolName={toolName}
      block={block}
      useDisclosure={useDisclosure}
      inspect={inspect}
      t={t}
      icon={icon}
      title={title}
      summary={summary}
      errorSummary={errorSummary}
    >
      {({ isRunning, isDeclined, state }) => {
        if (isRunning) {
          return <RunningNotice text={t('toolRunning')} />
        }
        if (isDeclined) {
          return (
            <div className={css.receiptCard} data-state="declined">
              <span className={css.badge} data-tone="warning">
                {t('toolDeclined')}
              </span>
              <div className={css.itemMeta}>{rawText}</div>
            </div>
          )
        }
        if (state === 'error') {
          return (
            <div className={css.receiptCard}>
              <div className={css.itemHeader}>
                <span className={css.badge} data-tone="danger">
                  {t('toolFailed')}
                </span>
                <span className={css.receiptTitle}>{errorSummary}</span>
              </div>
              {rawText && <RawTextFallback text={rawText} />}
            </div>
          )
        }
        return (
          <div className={css.receiptCard}>
            <div className={css.itemHeader}>
              <span className={css.badge} data-tone="success">
                {t('badgeSuccess')}
              </span>
              <span className={css.receiptTitle}>{summary}</span>
            </div>

            {parentSelectUrl && parentRef && (
              <div className={css.itemActions}>
                <span className={css.itemMeta}>{t('toolParentItem')}:</span>
                <ZoteroOpenLink
                  url={parentSelectUrl}
                  verdict="open"
                  label={parentRef}
                  t={t}
                  className={css.actionLink}
                />
              </div>
            )}

            {tagsList.length > 0 && (
              <div className={css.notesSection}>
                <span className={css.sectionTitle}>{t('toolTags')}</span>
                <div className={css.tagPills}>
                  {tagsList.map((tag) => (
                    <span key={tag} className={css.badge}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {rawText && <RawTextFallback text={rawText} />}
          </div>
        )
      }}
    </ZoteroToolRow>
  )
}
