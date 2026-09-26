/**
 * Universal container row for Zotero tool views in the Chat stream.
 * Encapsulates disclosure handling, lifecycle state rendering, inspection, and error styling.
 * @module dsh-zotero/client/toolviews/ZoteroToolRow
 */

import { useMemo, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  DisclosureRow,
  IconInspectOutlineRegular,
  TextShimmer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { UseDisclosure } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PreparingToolCall,
  StartedToolCall,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { isDeclinedOf, rowStateOf } from '../presenters.ts'
import css from './toolviews.module.css'

export interface ToolRowRenderContext {
  readonly isRunning: boolean
  readonly isDeclined: boolean
  readonly state: 'preparing' | 'running' | 'ok' | 'error' | 'stopped'
}

export interface ZoteroToolRowProps {
  readonly useDisclosure: UseDisclosure
  readonly t: TranslateNS<'zotero'>
  readonly toolName: string
  readonly block: PreparingToolCall | StartedToolCall | ToolResultNode
  readonly icon: ReactNode
  readonly title: string
  readonly summary: string
  readonly summarySuffix?: string | null
  readonly errorSummary?: string | null
  readonly inspect?: (() => void) | undefined
  readonly children?: ReactNode | ((ctx: ToolRowRenderContext) => ReactNode)
}

/** Standard running state notice across tool cards. */
export function RunningNotice({ text }: { readonly text: string }) {
  return <div className={css.coverageNotice}>{text}</div>
}

/** Preformatted raw payload fallback when structured view is absent or malformed. */
export function RawTextFallback({ text }: { readonly text: string }) {
  return <pre className={css.codeBox}>{text}</pre>
}

export function ZoteroToolRow({
  useDisclosure,
  t,
  toolName,
  block,
  icon,
  title,
  summary,
  summarySuffix,
  errorSummary,
  inspect,
  children,
}: ZoteroToolRowProps) {
  const isPreparing = 'phase' in block && block.phase === 'preparing'
  const isRunning = ('phase' in block && block.phase === 'start') || isPreparing
  const { expanded, toggle: toggleExpand } = useDisclosure()

  const state = isPreparing ? 'preparing' : rowStateOf(block)
  const isDeclined = isDeclinedOf(block)

  const failureLine = state === 'error' && !isDeclined ? (errorSummary ?? t('toolFailed')) : null
  const stoppedLine = state === 'stopped' ? t('toolStopped') : null
  const displaySummary = isDeclined ? t('toolDeclined') : (failureLine ?? stoppedLine ?? summary)

  const collapsedContent = useMemo(() => {
    if (!displaySummary && !isPreparing) return null
    return (
      <>
        <span className={css.summarySep} aria-hidden />
        <span
          className={clsx(
            css.summary,
            state === 'error' && !isDeclined && css.errorSummary,
            (state === 'stopped' || isDeclined) && css.declinedSummary,
          )}
        >
          <TextShimmer active={isRunning}>{displaySummary}</TextShimmer>
        </span>
        {summarySuffix && (state === 'ok' || isDeclined) && (
          <span className={css.summarySuffix}>{summarySuffix}</span>
        )}
      </>
    )
  }, [displaySummary, isDeclined, isPreparing, isRunning, state, summarySuffix])

  const expandable = !isPreparing && (children !== undefined || failureLine !== null)
  const open = expanded && expandable

  const renderContext = useMemo<ToolRowRenderContext>(
    () => ({ isRunning, isDeclined, state }),
    [isRunning, isDeclined, state],
  )

  const content = useMemo(() => {
    if (!open) return null
    return typeof children === 'function' ? children(renderContext) : children
  }, [open, children, renderContext])

  const expandedBody = open ? (
    <div className={css.bodyWrap}>
      {content}
      {inspect !== undefined && (
        <button
          type="button"
          className={css.inspectButton}
          onClick={(e) => {
            e.stopPropagation()
            inspect()
          }}
        >
          <IconInspectOutlineRegular size={12} />
          <span>{t('toolInspect')}</span>
        </button>
      )}
    </div>
  ) : null

  return (
    <div data-tool={toolName} data-state={isDeclined ? 'declined' : state}>
      <DisclosureRow
        icon={icon}
        title={title}
        open={open}
        expandable={expandable}
        running={isRunning}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={toggleExpand}
        collapsedContent={collapsedContent}
      >
        {expandedBody}
      </DisclosureRow>
    </div>
  )
}
