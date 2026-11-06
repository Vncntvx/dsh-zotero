/**
 * Comment glyph for annotation rows. The host icon set exposes no
 * comment/message/bubble icon, so this SVG stands in; `currentColor` keeps its
 * colour on the host label token.
 * @module dsh-zotero/client/components/CommentIcon
 */

export interface CommentIconProps {
  readonly size?: number
  readonly className?: string
}

/** Render a speech-bubble glyph that inherits the surrounding text colour. */
export function CommentIcon({ size = 14, className }: CommentIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.5 7.5a5.5 5.5 0 0 1-5.5 5.5H4L2 14.5V7.5A5.5 5.5 0 0 1 7.5 2h.5a5.5 5.5 0 0 1 5.5 5.5Z" />
      <path d="M5.5 6.5h5M5.5 9h3" />
    </svg>
  )
}
