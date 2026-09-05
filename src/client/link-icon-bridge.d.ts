/**
 * Temporary type bridge for the harness 0.1.3-alpha.1 `LinkIcon` API.
 * `package.json` already pins `@deepseek-ai/dsh-client-ui-primitives` to
 * `0.1.3-alpha.1` (whose source exports `LinkIcon`, `classifyLinkPath`, and
 * `LinkIconKind`), but the npm registry has not published that line yet, so
 * the installed `0.1.2-alpha.5` types lack the symbol and `tsc` would fail on
 * the value import. The client bundle marks `ui-primitives` as external, so
 * the runtime on a 0.1.3-alpha.1 host serves the real implementation; this
 * declaration only unblocks typechecking until `npm install` brings the
 * published types. Delete this file once the registry publishes
 * `0.1.3-alpha.1` and the installed package exports `LinkIcon` itself.
 * Exact mirror of `packages/client/ui-primitives/src/LinkIcon.tsx`.
 * @module dsh-zotero/client/link-icon-bridge
 */

import type { ReactNode } from 'react'

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /** Link categories with distinct leading glyphs (upstream verbatim). */
  export type LinkIconKind = 'url' | 'folder' | 'code' | 'image' | 'document' | 'other'
  /** Props for {@link LinkIcon} (upstream verbatim). */
  export interface LinkIconProps {
    kind: LinkIconKind
    size?: number | undefined
    className?: string | undefined
  }
  /** Render the leading glyph for one clickable artifact link (upstream verbatim). */
  export function LinkIcon(props: LinkIconProps): ReactNode
  /** Derive a file path's glyph category (upstream verbatim; never `url`/`folder`). */
  export function classifyLinkPath(path: string): LinkIconKind
}
