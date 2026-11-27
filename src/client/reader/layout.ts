/**
 * Reader layout thresholds shared by the stylesheet and the runtime.
 *
 * The drawer breakpoint lives in two places by necessity: CSS decides where the
 * panels float over the page, and the runtime needs the same number to keep one
 * drawer open at a time. Reading it from here keeps them from drifting apart;
 * `tests/unit/tooling/reader-layout.spec.ts` checks the stylesheet still states
 * the same value.
 * @module dsh-zotero/client/reader/layout
 */

/**
 * Container width, in rem, below which the panels overlay the page instead of
 * splitting the surface with it. Two 288px rails at 56rem would leave the page
 * under 384px, so the split waits until the container can hold both rails and a
 * readable page. Mirrors `@container reader (max-width: 60rem)`.
 */
export const DRAWER_MAX_REM = 60

/**
 * Container width, in rem, below which the toolbar sheds its secondary meta
 * text. Mirrors `@container reader (max-width: 40rem)`.
 */
export const TOOLBAR_COMPACT_MAX_REM = 40
