/**
 * Error boundary for Zotero tool cards.
 * Catches rendering exceptions inside a card's own tree and degrades that one
 * card in place, so the harness's slot boundary — which would retire the
 * crashed entry for good — never sees the failure.
 * @module dsh-zotero/client/toolviews/ZoteroCardBoundary
 */

import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type FunctionComponent,
  type ReactNode,
} from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { messageOf } from '../error-text.ts'
import { reportCrashedSurface } from '../actions/error-reporter.ts'
import css from '../components/cards.module.css'

type AnyToolViewProps = PropsRuntime<'tool.call.toolview'> & PropsLocale<'zotero'>

interface ZoteroCardBoundaryProps {
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
    reportCrashedSurface(`tool:${this.props.props.toolName}`, error, {
      kind: 'componentStack',
      componentStack: info.componentStack,
    })
  }

  override render(): ReactNode {
    const { message } = this.state
    if (message === null) return this.props.children
    const { props } = this.props
    // The fallback reads only strings. `block` is the likeliest thing that
    // crashed the card (malformed meta, hostile shapes), so a fallback built
    // on the shared row — which reads the block — could crash in turn, escape
    // to the harness's slot boundary, and retire the card for good. Nothing
    // here can throw.
    return (
      <div data-zotero-card-error className={css.cardError}>
        <p className={css.cardErrorTitle}>
          {props.toolName} · {props.t('renderFailed')}
        </p>
        <p className={css.cardErrorDetail}>{message}</p>
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
