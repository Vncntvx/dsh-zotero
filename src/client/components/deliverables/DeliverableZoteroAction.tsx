import type {} from '@deepseek-ai/dsh-client-ui-deliverables/src/client/turn-deliverables.ts'
/**
 * File action rendered inside `deliverables.file.actions` for bibliography deliverables.
 * Clicking reveals the Zotero library panel in the right sidebar.
 * @module dsh-zotero/client/components/deliverables/DeliverableZoteroAction
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { ZoteroLibraryIcon } from '../library/ZoteroLibraryIcon.tsx'
import css from './deliverables.module.css'

export interface DeliverableZoteroActionProps {
  readonly actionUrl?: string
  readonly t: TranslateNS<'zotero'>
  readonly useChat?: UseChat
  readonly onOpenLibrary?: () => void
}

export interface DeliverableFileMeta {
  readonly path: string
  readonly description?: string
}

const STRICT_BIBLIOGRAPHY_EXTENSIONS = /\.(bib|ris|csljson|csl\.json|biblatex|bibtex)$/i
const BIBLIOGRAPHY_DESCRIPTION_PATTERN = /exported (?:csljson|citation|references|bib)/i
const BIBLIOGRAPHY_FILENAME_PATTERN = /(?:csl|zotero|citations?|references?|bibliography)/i

/**
 * Determine whether a delivered file represents a bibliography export.
 * Strict extensions (.bib, .ris, .csljson, etc.) pass unconditionally;
 * generic .json files must carry a bibliography description or naming token.
 */
export function isBibliographyDeliverable(file: DeliverableFileMeta | undefined): boolean {
  if (!file?.path) return false
  if (STRICT_BIBLIOGRAPHY_EXTENSIONS.test(file.path)) return true
  if (/\.json$/i.test(file.path)) {
    if (file.description && BIBLIOGRAPHY_DESCRIPTION_PATTERN.test(file.description)) return true
    if (BIBLIOGRAPHY_FILENAME_PATTERN.test(file.path)) return true
  }
  return false
}

export function isBibliographyPath(path: string | undefined): boolean {
  if (!path) return false
  return isBibliographyDeliverable({ path })
}

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
  const snapshot = useChat ? useChat((s) => s) : undefined
  const file = resolveDeliverableFile(actionUrl, snapshot)

  if (!isBibliographyDeliverable(file)) return null

  return (
    <Button
      variant="outline"
      size="sm"
      className={css.actionButton}
      onClick={onOpenLibrary}
      title={t('deliverableOpenLibrary')}
      aria-label={t('deliverableOpenLibrary')}
    >
      <ZoteroLibraryIcon size={12} />
      <span>{t('deliverableOpenLibrary')}</span>
    </Button>
  )
}
