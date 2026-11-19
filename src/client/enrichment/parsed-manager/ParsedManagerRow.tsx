import clsx from 'clsx'
import {
  Checkbox,
  IconEyeOutlineRegular,
  IconLinkOutlineRegular,
  IconPaperclipOutlineRegular,
  IconSparkleRegular,
  IconTrashOutlineRegular,
  Tag,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroParsedDocumentRowView } from '../../../contract.ts'
import { formatDateTime } from '../../../sources/presenters.js'
import { IconButton } from '../../components/IconButton.tsx'
import { BROKEN_LABELS, STATE_LABELS, STATE_TONES, metaOf, titleOf } from './types.ts'
import css from '../parsed-manager.module.css'
import tipCss from '../../components/tip.module.css'

export interface ParsedManagerRowProps {
  row: ZoteroParsedDocumentRowView
  isSelected: boolean
  discardAllowed: boolean
  busy: boolean
  now: number
  sessionId: string
  reparseDisabled: boolean
  onToggle: (artifactId: string, selected: boolean) => void
  onOpen: (sessionId: string, artifactId: string, title: string) => void
  onReparse?: (artifactId: string, title: string) => void
  onDelete: (artifactId: string, title: string) => void
  t: TranslateNS<'zotero'>
}

export function ParsedManagerRow(props: ParsedManagerRowProps) {
  const {
    row,
    isSelected,
    discardAllowed,
    busy,
    now,
    sessionId,
    reparseDisabled,
    onToggle,
    onOpen,
    onReparse,
    onDelete,
    t,
  } = props

  const title = titleOf(row)
  const meta = metaOf(row, now, t)

  return (
    <li className={clsx(css.row, { [css.rowSelected]: isSelected })}>
      <div className={css.rowHead}>
        {/* Tooltip shows the full title when the checkbox label is clipped. */}
        <Tooltip label={title} side="bottom" delayMs={500} portal onlyWhenClipped>
          <span className={tipCss.seat}>
            <Checkbox
              className={css.rowSelect}
              checked={isSelected}
              disabled={!discardAllowed || busy}
              label={title}
              onChange={(next) => onToggle(row.artifactId, next)}
            />
          </span>
        </Tooltip>
        {row.state !== 'indexed' && (
          <Tag tone={STATE_TONES[row.state]}>{t(STATE_LABELS[row.state])}</Tag>
        )}
      </div>
      <div className={css.rowMeta}>
        {meta !== '' && (
          <span className={css.metaText} title={formatDateTime(row.committedAt)}>
            <span className={css.metaIcon} aria-hidden="true">
              {row.sourceKind === 'url' ? (
                <IconLinkOutlineRegular size={12} />
              ) : (
                <IconPaperclipOutlineRegular size={12} />
              )}
            </span>
            <span className={css.metaCopy}>{meta}</span>
          </span>
        )}
        <span className={css.actions}>
          <Tooltip label={t('parsedManagerOpen')} side="bottom" delayMs={500} portal>
            <span className={tipCss.seat}>
              <IconButton
                shape="square"
                icon={<IconEyeOutlineRegular size={14} />}
                aria-label={t('parsedManagerOpen')}
                disabled={!row.actionable || row.state === 'broken'}
                onClick={() => onOpen(sessionId, row.artifactId, title)}
              />
            </span>
          </Tooltip>
          <Tooltip label={t('libraryParsedReparse')} side="bottom" delayMs={500} portal>
            <span className={tipCss.seat}>
              <IconButton
                shape="square"
                icon={<IconSparkleRegular size={14} />}
                aria-label={t('libraryParsedReparse')}
                disabled={!row.actionable || reparseDisabled}
                onClick={() => onReparse?.(row.artifactId, title)}
              />
            </span>
          </Tooltip>
          <Tooltip label={t('parsedManagerDelete')} side="bottom" delayMs={500} portal>
            <span className={tipCss.seat}>
              <IconButton
                shape="square"
                icon={<IconTrashOutlineRegular size={14} />}
                aria-label={t('parsedManagerDelete')}
                disabled={!discardAllowed || busy}
                onClick={() => onDelete(row.artifactId, title)}
              />
            </span>
          </Tooltip>
        </span>
      </div>
      {row.broken !== undefined && (
        <p className={css.broken}>
          {t(BROKEN_LABELS[row.broken.code])}
          {row.broken.detail !== undefined && (
            <span className={css.brokenDetail}>{row.broken.detail}</span>
          )}
        </p>
      )}
    </li>
  )
}
