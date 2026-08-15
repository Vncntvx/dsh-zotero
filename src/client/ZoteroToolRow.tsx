/**
 * Shared Zotero tool-row chrome: the ToolRow geometry replicated per the
 * third-party posture (visual layer only — 24px single line, 16px leading
 * with a 14px glyph, 2×2 separator dot, ellipsized summary, running sweep,
 * StateDot for settled failures) over public primitives. The header is one
 * toggle; every other control (copy buttons, Inspect) lives in the expanded
 * body OUTSIDE the toggle, so no interactive control nests inside another.
 * Geometry reference: packages/client/ui-tool/src/client/tool/components/
 * ToolRow.module.css (deepseek-harness checkout), checked at Phase 2.
 * @module dsh-zotero/client/ZoteroToolRow
 */

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconChevronDownOutline14,
  IconInspectOutline12,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ZoteroRowState } from './presenters.ts'
import css from './ZoteroToolRow.module.css'

export interface ZoteroToolRowProps {
  readonly state: ZoteroRowState
  readonly title: string
  readonly summary: string
  readonly icon: ReactNode
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
    icon,
    facts = [],
    errorSummary,
    expandable = false,
    inspect,
    inspectLabel,
    runningLabel,
    errorLabel,
    stoppedLabel,
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
      <div
        className={css.root}
        data-tool="zotero"
        data-state={state}
        data-expandable={expandable || undefined}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-busy={state === 'running'}
        aria-expanded={expandable ? open : undefined}
        onClick={expandable ? toggle : undefined}
        onKeyDown={expandable ? toggleFromKeyboard : undefined}
      >
        <span className={css.leading}>{leading}</span>
        {status !== null && <span className={css.visuallyHidden}>{status}</span>}
        <span className={css.title}>{title}</span>
        <span className={css.sep} aria-hidden />
        <span className={clsx(css.summary, errorSummary !== null && css.errorSummary)}>
          {errorSummary ?? summary}
        </span>
        {visibleFacts.map((fact, index) => (
          <span key={`${fact}-${index}`} className={css.factGroup}>
            <span className={css.sep} aria-hidden />
            <span className={css.fact}>{fact}</span>
          </span>
        ))}
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
