/**
 * Error boundary for Zotero tool cards.
 * Catches rendering exceptions in individual cards and displays a fallback tool row.
 * @module dsh-zotero/client/toolviews/ZoteroCardBoundary
 */

import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type FunctionComponent,
  type ReactNode,
} from 'react'
import { IconBrowseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { messageOf } from '../error-text.ts'
import { RawTextFallback, ZoteroToolRow } from './ZoteroToolRow.tsx'

export type AnyToolViewProps = PropsRuntime<'tool.call.toolview'> & PropsLocale<'zotero'>

export interface ZoteroCardBoundaryProps {
  readonly props: AnyToolViewProps
  readonly children: ReactNode
}

interface ZoteroCardBoundaryState {
  readonly message: string | null
}

/**
 * Render boundary protecting individual Zotero tool cards against rendering exceptions.
 */
export class ZoteroCardBoundary extends Component<
  ZoteroCardBoundaryProps,
  ZoteroCardBoundaryState
> {
  override state: ZoteroCardBoundaryState = { message: null }

  static getDerivedStateFromError(error: unknown): ZoteroCardBoundaryState {
    return { message: messageOf(error) }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('dsh-zotero: tool card failed to render:', messageOf(error), info)
  }

  override render(): ReactNode {
    const { message } = this.state
    if (message === null) return this.props.children
    const { props } = this.props
    return (
      <div data-zotero-card-error>
        <ZoteroToolRow
          useDisclosure={props.useDisclosure}
          t={props.t}
          toolName={props.toolName}
          block={props.block}
          // The neutral glyph is deliberate: the crashing card's own icon
          // logic is part of what threw, so the fallback never runs it.
          icon={<IconBrowseOutlineRegular size={14} />}
          title={props.toolName}
          summary={props.t('renderFailed')}
          errorSummary={message}
          inspect={props.inspect}
        >
          <RawTextFallback text={message} />
        </ZoteroToolRow>
      </div>
    )
  }
}

/**
 * Higher-order component wrapping a toolview in a `ZoteroCardBoundary`. The
 * guarded component stays a plain function component: the keyed-slot register
 * overload only admits call signatures, so a `ComponentType` return (which
 * allows classes) would force a cast at every registration site.
 */
export function withCardBoundary<P extends AnyToolViewProps>(
  Wrapped: ComponentType<P>,
): FunctionComponent<P> {
  function GuardedToolView(props: P): ReactNode {
    return (
      <ZoteroCardBoundary props={props}>
        <Wrapped {...props} />
      </ZoteroCardBoundary>
    )
  }
  GuardedToolView.displayName = `Guarded(${Wrapped.displayName || Wrapped.name || 'ToolView'})`
  return GuardedToolView
}
