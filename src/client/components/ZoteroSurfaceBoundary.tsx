/**
 * Error boundary for the Zotero Sources tab.
 * Catches rendering exceptions in child components and displays an inline notice.
 * Resets state when `resetKey` changes.
 * @module dsh-zotero/client/components/ZoteroSurfaceBoundary
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { messageOf } from '../error-text.ts'
import css from './cards.module.css'

export interface ZoteroSurfaceBoundaryProps {
  readonly t: TranslateNS<'zotero'>
  readonly children: ReactNode
  /** Identity-compared between renders; a change clears the caught fault. */
  readonly resetKey?: string | number
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
    // Logs the failure with plugin context for diagnostics.
    console.error('dsh-zotero: the Zotero panel failed to render:', messageOf(error), info)
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
          <button
            type="button"
            className={css.surfaceRetryButton}
            onClick={this.handleRetry}
            data-zotero-surface-retry
          >
            {t('refresh')}
          </button>
        </div>
        <p className={css.surfaceErrorDetail}>{message}</p>
      </div>
    )
  }
}
