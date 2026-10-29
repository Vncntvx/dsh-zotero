/**
 * The sidebar artwork for the library panel entry. Decorative, like every
 * panellist occupant: the sidebar owns the button, the accessible name, and
 * the selected state.
 * @module dsh-zotero/client/components/library/ZoteroLibraryIcon
 */

export interface ZoteroLibraryIconProps {
  readonly size?: number
  readonly className?: string
}

export function ZoteroLibraryIcon({ size, className }: ZoteroLibraryIconProps) {
  const edge = size ?? 36
  return (
    <svg width={edge} height={edge} viewBox="0 0 36 36" className={className} aria-hidden="true">
      <path
        d="M9 10V8.5A2.5 2.5 0 0 1 11.5 6H28a2.5 2.5 0 0 1 2.5 2.5v19A2.5 2.5 0 0 1 28 30H11.5A2.5 2.5 0 0 1 9 27.5V10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.45"
      />
      <path
        d="M12 9.5A2.5 2.5 0 0 1 14.5 7H28a2.5 2.5 0 0 1 2.5 2.5v17A2.5 2.5 0 0 1 28 29H14.5a2.5 2.5 0 0 1-2.5-2.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M16 12h10M16 16h8M16 20h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
