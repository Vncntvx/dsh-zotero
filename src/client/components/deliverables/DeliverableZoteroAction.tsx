/**
 * File action rendered inside `deliverables.file.actions` for bibliography deliverables.
 * Clicking reveals the Zotero library panel in the right sidebar.
 * @module dsh-zotero/client/components/deliverables/DeliverableZoteroAction
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { isBibliographyDeliverable, type DeliverableFileMeta } from '../../bibliography.ts'
import { BibliographyLibraryButton } from '../document/BibliographyLibraryButton.tsx'

export interface DeliverableZoteroActionProps
  extends
    PropsRuntime<'deliverables.file.actions'>,
    PropsLocale<'zotero'>,
    InjectFace<{ readonly onOpenLibrary: () => void }> {}

/**
 * Resolves the delivered file metadata (path and optional description) from actionUrl coordinates.
 */
export function resolveDeliverableFile(
  actionUrl: string | undefined,
  snapshot: ChatSnapshot | undefined,
): DeliverableFileMeta | undefined {
  if (!actionUrl || !snapshot) return undefined
  try {
    const query = actionUrl.includes('?') ? actionUrl.split('?')[1] : actionUrl
    const params = new URLSearchParams(query)
    const seqStr = params.get('seq')
    const indexStr = params.get('index')
    if (seqStr === null || indexStr === null) return undefined
    const seq = Number(seqStr)
    const index = Number(indexStr)
    if (
      !/^[0-9]+$/.test(seqStr) ||
      !/^[0-9]+$/.test(indexStr) ||
      !Number.isSafeInteger(seq) ||
      !Number.isSafeInteger(index) ||
      seq < 1 ||
      index < 0 ||
      params.getAll('seq').length !== 1 ||
      params.getAll('index').length !== 1
    )
      return undefined

    for (const turnId of snapshot.timeline.turnOrder) {
      const presented = snapshot.timeline.turns.get(turnId)?.data.get('deliverables')?.presented
      const match = presented?.find((p) => p.seq === seq && p.index === index)
      if (match?.path) return { path: match.path, description: match.description }
    }
  } catch {
    return undefined
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
  const { actionUrl, t, useChat, onOpenLibrary } = props
  const file = useChat((snapshot) => resolveDeliverableFile(actionUrl, snapshot))

  if (!isBibliographyDeliverable(file)) return null

  return <BibliographyLibraryButton label={t('openInLibraryPanel')} onOpenLibrary={onOpenLibrary} />
}
