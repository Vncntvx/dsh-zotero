/**
 * Fallback action rendered in unpreviewable document view for bibliography files.
 * @module dsh-zotero/client/components/document/DocumentUnpreviewableAction
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BibliographyAction } from './BibliographyAction.tsx'

export interface DocumentUnpreviewableActionProps
  extends
    PropsRuntime<'sidebar.right.tab.document.unpreviewable'>,
    PropsLocale<'zotero'>,
    InjectFace<{ readonly onOpenLibrary: () => void }> {}

export function DocumentUnpreviewableAction({
  absolutePath,
  onOpenLibrary,
  t,
}: DocumentUnpreviewableActionProps) {
  return <BibliographyAction absolutePath={absolutePath} t={t} onOpenLibrary={onOpenLibrary} />
}
