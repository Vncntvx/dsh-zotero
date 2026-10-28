/**
 * The sidebar glyph for the library panel entry. Decorative, like every
 * panellist occupant: the sidebar owns the button, the accessible name, and
 * the selected state; this component only draws the folder glyph.
 * @module dsh-zotero/client/components/library/ZoteroLibraryIcon
 */

import { IconFolderOpenOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

export interface ZoteroLibraryIconProps {
  readonly size?: number
  readonly className?: string
}

export function ZoteroLibraryIcon({ size, className }: ZoteroLibraryIconProps) {
  return <IconFolderOpenOutlineRegular size={size} className={className} />
}
