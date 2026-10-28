/**
 * The in-app "Read PDF" button. Opens the PDF in DeepSeek Harness's right
 * sidebar reader via `openFile`, resolving the attachment location through
 * `resolveAttachment` when no local path is known yet.
 * @module dsh-zotero/client/components/open/PdfReadButton
 */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  Button,
  IconDeliverDocRegular,
  type ButtonVariant,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView } from '../../../contract.ts'
import { getAttachmentResolver } from '../../actions/attachment-resolver.ts'
import type { PdfCapability } from '../../sources/source-capabilities.ts'
import css from './open.module.css'

interface PdfReadButtonProps {
  /** Optional structured PDF capability; extracts ref, filePath, or webUrl automatically. */
  readonly capability?: PdfCapability | null
  readonly attachmentRef?: string
  readonly filePath?: string
  readonly webUrl?: string
  readonly onOpenFile?: (path: string) => void
  readonly onOpenUrl?: (url: string) => void
  readonly resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
  readonly label?: string
  readonly t: TranslateNS<'zotero'>
  readonly className?: string
  readonly title?: string
  /** Explicitly disables the action and explains why it is unavailable. */
  readonly disabledReason?: string
  readonly requireSessionForResolvedFile?: boolean
  readonly variant?: 'button' | 'link'
  /** Button emphasis when variant="button": the inspector's action row asks for `primary`. */
  readonly emphasis?: ButtonVariant
}

export function PdfReadButton({
  capability,
  attachmentRef,
  filePath,
  webUrl,
  onOpenFile,
  onOpenUrl,
  resolveAttachment,
  label,
  emphasis = 'outline',
  t,
  className,
  title,
  disabledReason,
  requireSessionForResolvedFile = false,
  variant = 'button',
}: PdfReadButtonProps) {
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetRef = attachmentRef ?? (capability?.kind === 'file' ? capability.ref : undefined)
  const targetPath = filePath ?? (capability?.kind === 'file' ? capability.filePath : undefined)
  const targetWebUrl = webUrl ?? (capability?.kind === 'url' ? capability.url : undefined)

  useEffect(() => {
    setError(null)
  }, [attachmentRef, filePath, webUrl, capability])

  const openExternalUrl = (url: string) => {
    if (onOpenUrl) onOpenUrl(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  }

  /**
   * Run one open action; a synchronous refusal from the host (the right
   * sidebar's session gate) degrades to the inline error the async resolve
   * path already shows, instead of an unhandled rejection.
   */
  const openWith = (open: () => void) => {
    try {
      open()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (resolving) return
    setError(null)

    // A web PDF opens in a new tab.
    if (targetWebUrl) {
      openWith(() => openExternalUrl(targetWebUrl))
      return
    }

    // A known local path goes straight to the sidebar reader.
    if (targetPath) {
      if (onOpenFile) openWith(() => onOpenFile(targetPath))
      return
    }

    // Otherwise, resolve the location via the Typert remote.
    const resolver = resolveAttachment ?? getAttachmentResolver()
    if (targetRef && resolver) {
      setResolving(true)
      try {
        const res = await resolver(targetRef)
        if (res.ok) {
          if (res.value.kind === 'file') {
            const path = res.value.path
            if (path) {
              if (onOpenFile) openWith(() => onOpenFile(path))
              else if (requireSessionForResolvedFile) setError(t('libraryNoSessionForOpen'))
            } else {
              setError(t('pdfFileNotFound'))
            }
          } else if (res.value.kind === 'url' && res.value.url) {
            // Capture the narrowed URL: the closure outlives the narrowing.
            const url = res.value.url
            openWith(() => openExternalUrl(url))
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
  }

  const displayLabel = resolving ? t('pdfResolving') : (error ?? label ?? t('readPdf'))
  const tooltip = error ?? title ?? t('readPdfInSidebar')
  const unavailableReason =
    disabledReason ??
    (targetPath && !targetWebUrl && onOpenFile === undefined
      ? t('libraryNoSessionForOpen')
      : undefined)
  const disabled = resolving || unavailableReason !== undefined

  if (variant === 'link') {
    return (
      <button
        type="button"
        className={clsx(css.link, className, resolving && css.resolving)}
        onClick={handleClick}
        aria-label={unavailableReason ?? displayLabel}
        title={unavailableReason ?? tooltip}
        disabled={disabled}
      >
        <IconDeliverDocRegular className={css.linkIcon} />
        {displayLabel}
      </button>
    )
  }

  return (
    <Button
      variant={emphasis}
      size="sm"
      className={clsx(className, resolving && css.resolving)}
      onClick={handleClick}
      aria-label={unavailableReason ?? displayLabel}
      title={unavailableReason ?? tooltip}
      disabled={disabled}
      icon={<IconDeliverDocRegular size={14} />}
    >
      {displayLabel}
    </Button>
  )
}
