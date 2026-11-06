/**
 * Universal container row for Zotero tool views in the Chat stream.
 * Encapsulates disclosure handling, lifecycle state rendering, inspection, and error styling.
 * @module dsh-zotero/client/toolviews/ZoteroToolRow
 */

import { useMemo, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button,
  CodeBlock,
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
import { isToolRunning, metaOf, rowStateOf } from '../../sources/presenters.js'
import { writeMetaOf } from '../sources/write-decoder.ts'
import css from './toolviews.module.css'

interface ToolRowRenderContext {
  readonly isRunning: boolean
  readonly isDeclined: boolean
  readonly isUnverified: boolean
  readonly state: 'preparing' | 'running' | 'ok' | 'error' | 'stopped'
}

interface ZoteroToolRowProps {
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

/** Raw payload fallback when the structured view is absent or malformed. */
export function RawTextFallback({
  text,
  copyLabel,
  copiedLabel,
}: {
  readonly text: string
  readonly copyLabel: string
  readonly copiedLabel: string
}) {
  return (
    <CodeBlock
      code={text}
      showHeader={false}
      copyLabel={copyLabel}
      copiedLabel={copiedLabel}
      className={css.rawCode}
    />
  )
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
  // `preparing` keeps its own name: only the header's state label tells the
  // two running phases apart, and that label comes from `rowStateOf`, which
  // reports both as running.
  const isPreparing = 'phase' in block && block.phase === 'preparing'
  const isRunning = isToolRunning(block)
  const { expanded, toggle: toggleExpand } = useDisclosure()

  const state = isPreparing ? 'preparing' : rowStateOf(block)
  // Both write verdicts read the outcome through the one decoder, so a fourth
  // outcome added to the write projection cannot be classified here but not
  // there. Reading `meta.kind` directly instead would put a value-import
  // cycle between `presenters` and `decoders` to save one line.
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

  // No memo here: every parent render passes a fresh children closure, so a
  // memo keyed on its identity would always miss; the closed-state skip is
  // the early return itself.
  const content = !open ? null : typeof children === 'function' ? children(renderContext) : children

  const expandedBody = open ? (
    <div className={css.bodyWrap}>
      {content}
      {inspect !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          className={css.inspectButton}
          icon={<IconInspectOutlineRegular size={12} />}
          onClick={(e) => {
            e.stopPropagation()
            inspect()
          }}
        >
          {t('toolInspect')}
        </Button>
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
