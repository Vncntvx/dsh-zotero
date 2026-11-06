/**
 * Action button rendered in document preview header for bibliography files.
 * Clicking reveals the Zotero library panel in the right sidebar.
 * @module dsh-zotero/client/components/document/DocumentZoteroAction
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BibliographyAction } from './BibliographyAction.tsx'

export interface DocumentZoteroActionProps
  extends
    PropsRuntime<'sidebar.right.tab.document.actions'>,
    PropsLocale<'zotero'>,
    InjectFace<{ readonly onOpenLibrary: () => void }> {}

export function DocumentZoteroAction({
  absolutePath,
  onOpenLibrary,
  t,
}: DocumentZoteroActionProps) {
  return <BibliographyAction absolutePath={absolutePath} t={t} onOpenLibrary={onOpenLibrary} />
}
