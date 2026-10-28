/**
 * Ambient declaration for react-dom portal export in the client graph.
 *
 * `react-dom` is provided as an external platform module in DeepSeek Harness,
 * but `@types/react-dom` is not part of the plugin's devDependencies.
 * @module dsh-zotero/client/react-dom.d.ts
 */

declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react'

  export function createPortal(
    children: ReactNode,
    container: Element | DocumentFragment,
    key?: null | string,
  ): ReactPortal
}
