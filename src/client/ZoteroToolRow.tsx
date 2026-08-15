/**
 * Shared Zotero tool-row chrome: the ToolRow geometry replicated per the
 * third-party posture (visual layer only — 24px single line, 16px leading
 * with a 14px glyph, 2×2 separator dot, ellipsized summary, running sweep,
 * StateDot for settled failures) over public primitives. Tool-call cards
 * pass a `tag` (a trajectory-style kind chip) instead of an icon; the tag
 * becomes the row's leading identity and the summary turns into the primary
 * line. The header is one toggle; every other control (copy buttons,
 * Inspect) lives in the expanded body OUTSIDE the toggle, so no interactive
 * control nests inside another. Geometry reference:
 * packages/client/ui-tool/src/client/tool/components/ToolRow.module.css and
 * the trajectory kind-tag cadence (TrajectoryTable.module.css) in the
 * deepseek-harness checkout.
 * @module dsh-zotero/client/ZoteroToolRow
 */

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconChevronDownOutline14,
  IconInspectOutline12,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ZoteroRowState, ZoteroToolTone } from './presenters.ts'
import css from './ZoteroToolRow.module.css'

/** The five wire tools, each with its own kind-tag tone. */
export type ZoteroToolTagKind = ZoteroToolTone

/** The kind tag's contract: a short label plus the tone key. */
export interface ZoteroToolTag {
  readonly label: string
  readonly kind: ZoteroToolTagKind
}

export interface ZoteroToolRowProps {
  readonly state: ZoteroRowState
  readonly title: string
  readonly summary: string
  /** The leading kind chip (tool cards); absent rows keep the icon leading. */
  readonly tag?: ZoteroToolTag
  /** The leading glyph for rows without a tag (corpus records). */
  readonly icon?: ReactNode
  /** Secondary facts joined after the summary (never primary content). */
  readonly facts?: readonly string[]
  /** The failure's first line, shown in the error color on error rows. */
  readonly errorSummary?: string | null
  readonly expandable?: boolean
  readonly inspect?: () => void
  readonly inspectLabel: string
  readonly runningLabel: string
  readonly errorLabel: string
  readonly stoppedLabel: string
  /** Line-end content after the facts (usage badges on corpus rows). */
  readonly trailing?: ReactNode
  /**
   * Interactive line-end actions, rendered OUTSIDE the toggle so no control
   * nests inside the row's button role (corpus rows: copy ref, ask about).
   */
  readonly actions?: ReactNode
  readonly children?: ReactNode
}

/**
 * The row: whole-line toggle (click / Enter / Space), aria-expanded, and a
 * visually hidden state label for assistive tech. Interactive controls only
 * appear in the expanded body.
 */
export function ZoteroToolRow(props: ZoteroToolRowProps) {
  const {
    state,
    title,
    summary,
    tag,
    icon,
    facts = [],
    errorSummary,
    expandable = false,
    inspect,
    inspectLabel,
    runningLabel,
    errorLabel,
    stoppedLabel,
    trailing,
    actions,
    children,
  } = props
  const [expanded, setExpanded] = useState(false)
  const open = expanded && expandable

  const toggle = (): void => {
    setExpanded((value) => !value)
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggle()
  }

  const status =
    state === 'running'
      ? runningLabel
      : state === 'error'
        ? errorLabel
        : state === 'stopped'
          ? stoppedLabel
          : null

  const visibleFacts = facts.filter((fact) => fact !== '')
  const leading = open ? (
    <IconChevronDownOutline14 className={css.chevron} />
  ) : expandable ? (
    <>
      <span className={css.iconIdle}>
        {state === 'error' || state === 'stopped' ? (
          <StateDot state={state === 'error' ? 'error' : 'warning'} />
        ) : (
          icon
        )}
      </span>
      <IconChevronDownOutline14 className={clsx(css.chevron, css.chevronHover)} />
    </>
  ) : state === 'error' || state === 'stopped' ? (
    <StateDot state={state === 'error' ? 'error' : 'warning'} />
  ) : (
    icon
  )

  return (
    <div className={css.card}>
      <div className={css.line}>
        <div
          className={css.root}
          data-tool="zotero"
          data-state={state}
          data-expandable={expandable || undefined}
          data-tag={tag !== undefined || undefined}
          role={expandable ? 'button' : undefined}
          tabIndex={expandable ? 0 : undefined}
          title={title}
          aria-busy={state === 'running'}
          aria-expanded={expandable ? open : undefined}
          onClick={expandable ? toggle : undefined}
          onKeyDown={expandable ? toggleFromKeyboard : undefined}
        >
          {tag !== undefined ? (
            <span className={css.tag} data-kind={tag.kind} data-state={state}>
              {tag.label}
            </span>
          ) : (
            <>
              <span className={css.leading}>{leading}</span>
              <span className={css.title}>{title}</span>
              <span className={css.sep} aria-hidden />
            </>
          )}
          {status !== null && <span className={css.visuallyHidden}>{status}</span>}
          <span
            className={clsx(
              css.summary,
              tag !== undefined && css.summaryPrimary,
              errorSummary != null && css.errorSummary,
            )}
          >
            {errorSummary ?? summary}
          </span>
          {visibleFacts.map((fact, index) => (
            <span key={`${fact}-${index}`} className={css.factGroup}>
              <span className={css.sep} aria-hidden />
              <span className={css.fact}>{fact}</span>
            </span>
          ))}
          {trailing !== undefined && trailing !== null && (
            <span className={css.trailing}>{trailing}</span>
          )}
          {tag !== undefined && expandable && (
            <span className={clsx(css.chevronEnd, open ? css.chevronOpen : css.chevronHover)}>
              <IconChevronDownOutline14 className={css.chevron} />
            </span>
          )}
        </div>
        {actions !== undefined && actions !== null && (
          <span className={css.actions}>{actions}</span>
        )}
      </div>
      {open && (
        <div className={css.bodyWrap}>
          {children}
          {inspect !== undefined && (
            <button type="button" className={css.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              {inspectLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
