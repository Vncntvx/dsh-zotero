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
import { metaOf, rowStateOf } from '../presenters.ts'
import { writeMetaOf } from '../sources/decoders.ts'
import css from './toolviews.module.css'

export interface ToolRowRenderContext {
  readonly isRunning: boolean
  readonly isDeclined: boolean
  readonly isUnverified: boolean
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
  // Both write verdicts read the outcome through the one decoder, so a fourth
  // outcome added to the write projection cannot be classified here but not
  // there. `isDeclined` used to be its own `presenters` helper reading
  // `meta.kind` directly, which put a value-import cycle between `presenters`
  // and `decoders` to save one line.
  const writeKind = writeMetaOf(metaOf(block) ?? {}).kind
  const isDeclined = writeKind === 'declined'
  // A write that committed but could not be verified is neither a success nor
  // a failure: the outcome is unproven, and the row has to say so before any
  // body can pick the right receipt.
  const isUnverified = !isDeclined && state === 'ok' && writeKind === 'committed-unverified'

  const failureLine = state === 'error' && !isDeclined ? (errorSummary ?? t('toolFailed')) : null
  const stoppedLine = state === 'stopped' ? t('toolStopped') : null
  const cautionLine = isUnverified ? t('toolUnverified') : null
  const displaySummary = isDeclined
    ? t('toolDeclined')
    : (failureLine ?? stoppedLine ?? cautionLine ?? summary)

  const collapsedContent = useMemo(() => {
    if (!displaySummary && !isPreparing) return null
    return (
      <>
        <span className={css.summarySep} aria-hidden />
        <span
          className={clsx(
            css.summary,
            state === 'error' && !isDeclined && css.errorSummary,
            (state === 'stopped' || isDeclined || isUnverified) && css.cautionSummary,
          )}
        >
          <TextShimmer active={isRunning}>{displaySummary}</TextShimmer>
        </span>
        {summarySuffix && (state === 'ok' || isDeclined) && (
          <span className={css.summarySuffix}>{summarySuffix}</span>
        )}
      </>
    )
  }, [displaySummary, isDeclined, isUnverified, isPreparing, isRunning, state, summarySuffix])

  const expandable = !isPreparing && (children !== undefined || failureLine !== null)
  const open = expanded && expandable

  const renderContext = useMemo<ToolRowRenderContext>(
    () => ({ isRunning, isDeclined, isUnverified, state }),
    [isRunning, isDeclined, isUnverified, state],
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
    <div
      data-tool={toolName}
      data-state={isDeclined ? 'declined' : isUnverified ? 'unverified' : state}
    >
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
