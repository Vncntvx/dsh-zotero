/**
 * Error boundary for the Zotero Sources tab.
 * Catches rendering exceptions in child components and displays an inline notice.
 * Resets state when `resetKey` changes.
 * @module dsh-zotero/client/components/ZoteroSurfaceBoundary
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { messageOf } from '../error-text.ts'
import { reportCrashedSurface } from '../actions/error-reporter.ts'
import css from './cards.module.css'

interface ZoteroSurfaceBoundaryProps {
  readonly t: TranslateNS<'zotero'>
  readonly children: ReactNode
  /** Identity-compared between renders; a change clears the caught fault. */
  readonly resetKey?: string | number
  /**
   * Which surface this boundary guards, as the crash report names it: the
   * client-error intake files the entry under this key (`sources`, `detail`).
   */
  readonly surface: string
}

interface ZoteroSurfaceBoundaryState {
  readonly message: string | null
}

/**
 * Error boundary that isolates rendering errors within the Sources tab.
 */
export class ZoteroSurfaceBoundary extends Component<
  ZoteroSurfaceBoundaryProps,
  ZoteroSurfaceBoundaryState
> {
  override state: ZoteroSurfaceBoundaryState = { message: null }

  static getDerivedStateFromError(error: unknown): ZoteroSurfaceBoundaryState {
    return { message: messageOf(error) }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      `dsh-zotero: the Zotero panel failed to render (${this.props.surface}):`,
      messageOf(error),
      info,
    )
    reportCrashedSurface(this.props.surface, error, {
      kind: 'componentStack',
      componentStack: info.componentStack,
    })
  }

  override componentDidUpdate(prevProps: ZoteroSurfaceBoundaryProps): void {
    if (this.state.message !== null && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ message: null })
    }
  }

  private handleRetry = (): void => {
    this.setState({ message: null })
  }

  override render(): ReactNode {
    const { message } = this.state
    if (message === null) return this.props.children
    const { t } = this.props
    return (
      <div className={css.surfaceError} data-zotero-surface-error>
        <div className={css.surfaceErrorHeader}>
          <p className={css.surfaceErrorTitle}>{t('renderFailed')}</p>
          <Button
            variant="outline"
            size="sm"
            className={css.surfaceRetryButton}
            onClick={this.handleRetry}
            data-zotero-surface-retry
          >
            {t('refresh')}
          </Button>
        </div>
        <p className={css.surfaceErrorDetail}>{message}</p>
      </div>
    )
  }
}
