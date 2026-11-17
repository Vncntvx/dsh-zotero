import { useEffect } from 'react'
/**
 * File action rendered inside `deliverables.file.actions` for bibliography deliverables.
 * Clicking reveals the Zotero library panel in the right sidebar.
 * @module dsh-zotero/client/components/deliverables/DeliverableZoteroAction
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { shallowEqual } from '@deepseek-ai/dsh-client-store'
import { isBibliographyDeliverable, type DeliverableFileMeta } from '../../bibliography.ts'
import { BibliographyLibraryButton } from '../document/BibliographyLibraryButton.tsx'

export interface DeliverableZoteroActionProps
  extends
    PropsRuntime<'deliverables.file.actions'>,
    PropsLocale<'zotero'>,
    InjectFace<{
      readonly onOpenLibrary: () => void
      readonly reportContractMismatch: (url: string) => void
    }> {}

/** Pin-reviewed upstream route adapter; every unsupported shape is reported by the slot. */
export function supportsDeliverableActionUrl(actionUrl: string | undefined): boolean {
  if (!actionUrl || !/^(?:\/)?api\/present\.open\?/.test(actionUrl)) return false
  const params = new URLSearchParams(actionUrl.slice(actionUrl.indexOf('?') + 1))
  return (
    ['seq', 'index', 'sessionId'].every((key) => params.getAll(key).length === 1) &&
    (params.get('sessionId')?.length ?? 0) > 0 &&
    /^[1-9][0-9]*$/.test(params.get('seq') ?? '') &&
    /^(?:0|[1-9][0-9]*)$/.test(params.get('index') ?? '') &&
    Number.isSafeInteger(Number(params.get('seq'))) &&
    Number.isSafeInteger(Number(params.get('index')))
  )
}

/**
 * Resolves the delivered file metadata (path and optional description) from actionUrl coordinates.
 */
export function resolveDeliverableFile(
  actionUrl: string | undefined,
  snapshot: ChatSnapshot | undefined,
): DeliverableFileMeta | undefined {
  if (!supportsDeliverableActionUrl(actionUrl) || !snapshot || actionUrl === undefined)
    return undefined
  const params = new URLSearchParams(actionUrl.slice(actionUrl.indexOf('?') + 1))
  const seq = Number(params.get('seq')),
    index = Number(params.get('index'))
  for (const turnId of snapshot.timeline.turnOrder) {
    const presented = snapshot.timeline.turns.get(turnId)?.data.get('deliverables')?.presented
    const match = presented?.find((entry) => entry.seq === seq && entry.index === index)
    if (match?.path) return { path: match.path, description: match.description }
  }
  return undefined
}

/**
 * Resolves the file path from the delivered actionUrl coordinates and the chat snapshot.
 */
export function resolveDeliverablePath(
  actionUrl: string | undefined,
  snapshot: ChatSnapshot | undefined,
): string | undefined {
  return resolveDeliverableFile(actionUrl, snapshot)?.path
}

export function DeliverableZoteroAction(props: DeliverableZoteroActionProps) {
  const { actionUrl, t, useChat, onOpenLibrary, reportContractMismatch } = props
  useEffect(() => {
    if (!supportsDeliverableActionUrl(actionUrl)) reportContractMismatch(actionUrl)
  }, [actionUrl, reportContractMismatch])
  const file = useChat((snapshot) => resolveDeliverableFile(actionUrl, snapshot), shallowEqual)

  if (!isBibliographyDeliverable(file)) return null

  return <BibliographyLibraryButton label={t('openInLibraryPanel')} onOpenLibrary={onOpenLibrary} />
}
