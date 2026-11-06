/**
 * The shared "view in the Zotero library" button for bibliography surfaces:
 * the deliverable action, the document preview header, and the unpreviewable
 * empty state. The caller owns the localized label and the opener.
 * @module dsh-zotero/client/components/document/BibliographyLibraryButton
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { ZoteroLibraryIcon } from '../library/ZoteroLibraryIcon.tsx'

export interface BibliographyLibraryButtonProps {
  readonly label: string
  readonly onOpenLibrary?: () => void
}

export function BibliographyLibraryButton({
  label,
  onOpenLibrary,
}: BibliographyLibraryButtonProps) {
  return (
    <Button variant="outline" size="sm" onClick={onOpenLibrary} title={label} aria-label={label}>
      <ZoteroLibraryIcon size={12} />
      <span>{label}</span>
    </Button>
  )
}
