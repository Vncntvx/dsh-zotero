/**
 * The one bibliography button shared by the document-preview and
 * unpreviewable slots. Both slots keep their own runtime prop contracts; this
 * component owns the path guard and the rendered button.
 * @module dsh-zotero/client/components/document/BibliographyAction
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { isBibliographyPath } from '../../bibliography.ts'
import { BibliographyLibraryButton } from './BibliographyLibraryButton.tsx'

export interface BibliographyActionProps {
  readonly absolutePath: string | undefined
  readonly t: TranslateNS<'zotero'>
  readonly onOpenLibrary: () => void
}

export function BibliographyAction({ absolutePath, t, onOpenLibrary }: BibliographyActionProps) {
  if (!isBibliographyPath(absolutePath)) return null
  return <BibliographyLibraryButton label={t('openInLibraryPanel')} onOpenLibrary={onOpenLibrary} />
}
