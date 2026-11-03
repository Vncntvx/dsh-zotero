/**
 * Shared DOM-face stub for ui-primitives `Tag`. Specs that only need the
 * capsule's children and placement stub this so they do not load the real
 * primitives bundle (katex, shiki).
 *
 * The stub mirrors the real component's DOM face: `data-tone` carries the
 * palette, so a spec asserting on a tone reads the same attribute it would in
 * the shell. `Tag`'s own props are closed, so this stub's are too.
 * @module tests/client/helpers/tag-stub
 */

import type { ReactNode } from 'react'

/** Props the stub accepts: the subset of `Tag` these specs exercise. */
export interface TagStubProps {
  readonly children?: ReactNode
  readonly className?: string
  readonly tone?: string
}

/**
 * Render the Tag stub as a plain span carrying `data-tag` and `data-tone`.
 * @param props - children, optional placement class, and optional tone.
 * @returns the stub element.
 */
export function TagStub(props: TagStubProps): ReactNode {
  const { children, className, tone } = props
  return (
    <span data-tag data-tone={tone} className={className}>
      {children}
    </span>
  )
}
