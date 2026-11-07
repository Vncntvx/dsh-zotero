/**
 * Action button rendered in the document preview header for bibliography
 * files, whether or not the file itself is previewable. Clicking reveals the
 * Zotero library panel in the right sidebar; both document slots register the
 * same component, since their runtime props are structurally identical.
 * @module dsh-zotero/client/components/document/DocumentOpenLibraryAction
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BibliographyAction } from './BibliographyAction.tsx'

export interface DocumentOpenLibraryActionProps
  extends
    PropsRuntime<'sidebar.right.tab.document.actions'>,
    PropsLocale<'zotero'>,
    InjectFace<{ readonly onOpenLibrary: () => void }> {}

export function DocumentOpenLibraryAction({
  absolutePath,
  onOpenLibrary,
  t,
}: DocumentOpenLibraryActionProps) {
  return <BibliographyAction absolutePath={absolutePath} t={t} onOpenLibrary={onOpenLibrary} />
}
