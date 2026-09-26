// @vitest-environment jsdom
/**
 * Unit tests for ZoteroActivationGuide component (plugins.bundle.activation slot).
 * @module tests/client/ZoteroActivationGuide
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_REMOTE_PACKAGE, type ZoteroStatusView } from '../../src/contract.ts'
import { ZoteroActivationGuide } from '../../src/client/components/plugin/ZoteroActivationGuide.tsx'
import { CONNECTED, UNAVAILABLE } from './helpers/sources-tab-harness.tsx'
import { mockT } from './helpers/mock-translate.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement: create } = await import('react')
  const { primitivesStub } = await import('./helpers/primitives-stub.ts')
  return {
    ...primitivesStub(),
    Button: ({
      variant,
      size,
      disabled,
      onClick,
      children,
      className,
      'data-modal-autofocus': autofocus,
    }: {
      variant?: string
      size?: string
      disabled?: boolean
      onClick?: () => void
      children?: unknown
      className?: string
      'data-modal-autofocus'?: boolean
    }) =>
      create(
        'button',
        {
          type: 'button',
          'data-variant': variant,
          'data-size': size,
          'data-modal-autofocus': autofocus ? 'true' : undefined,
          disabled,
          onClick,
          className,
        },
        children as never,
      ),
    Modal: ({
      open,
      onClose,
      title,
      closeLabel,
      description,
      children,
      footer,
      className,
    }: {
      open?: boolean
      onClose?: () => void
      title?: string
      closeLabel?: string
      description?: string
      children?: unknown
      footer?: unknown
      className?: string
    }) => {
      if (!open) return null
      return create(
        'div',
        { role: 'dialog', 'aria-label': title, className, 'data-modal': 'open' },
        create(
          'div',
          { 'data-modal-header': 'true' },
          create('h2', null, title),
          closeLabel
            ? create(
                'button',
                { type: 'button', 'aria-label': closeLabel, onClick: onClose },
                closeLabel,
              )
            : null,
        ),
        description ? create('p', null, description) : null,
        create('div', { 'data-modal-body': 'true' }, children as never),
        footer ? create('div', { 'data-modal-footer': 'true' }, footer as never) : null,
      )
    },
  }
})

const t = mockT

afterEach(cleanup)

describe('ZoteroActivationGuide', () => {
  it('returns null when packageName does not match ZOTERO_REMOTE_PACKAGE', () => {
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: true,
      value: CONNECTED,
    }))

    const { container } = render(
      <ZoteroActivationGuide
        packageName="other-package"
        onDismiss={vi.fn()}
        onOpenDetails={vi.fn()}
        t={t}
        probe={probe}
      />,
    )

    expect(container.firstChild).toBeNull()
    expect(probe).not.toHaveBeenCalled()
  })

  it('returns null when translator t is missing', () => {
    const { container } = render(
      <ZoteroActivationGuide
        packageName={ZOTERO_REMOTE_PACKAGE}
        onDismiss={vi.fn()}
        onOpenDetails={vi.fn()}
        probe={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('returns null when probe function is missing', () => {
    const { container } = render(
      <ZoteroActivationGuide
        packageName={ZOTERO_REMOTE_PACKAGE}
        onDismiss={vi.fn()}
        onOpenDetails={vi.fn()}
        t={t}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders instruction steps and guidance copy', async () => {
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: true,
      value: CONNECTED,
    }))

    render(
      <ZoteroActivationGuide
        packageName={ZOTERO_REMOTE_PACKAGE}
        onDismiss={vi.fn()}
        onOpenDetails={vi.fn()}
        t={t}
        probe={probe}
      />,
    )

    expect(screen.getByText(t('activationTitle'))).toBeDefined()
    expect(screen.getByText(t('activationDescription'))).toBeDefined()
    expect(screen.getByText(t('activationStep1'))).toBeDefined()
    expect(screen.getByText(t('activationStep2'))).toBeDefined()
    expect(screen.getByText(t('activationStep2Note'))).toBeDefined()
  })

  it('displays connected status with version and invokes onDismiss when Done is clicked', async () => {
    const onDismiss = vi.fn()
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: true,
      value: {
        ...CONNECTED,
        zoteroVersion: '7.0.11',
      },
    }))

    render(
      <ZoteroActivationGuide
        packageName={ZOTERO_REMOTE_PACKAGE}
        onDismiss={onDismiss}
        onOpenDetails={vi.fn()}
        t={t}
        probe={probe}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(t('activationReadyVersion', { version: '7.0.11' }))).toBeDefined()
    })

    const dot = document.querySelector('[data-state="done"]')
    expect(dot).toBeDefined()
    const statusRow = document.querySelector('[data-state="connected"]')
    expect(statusRow).toBeDefined()

    const doneButton = screen.getByText(t('activationDone'))
    fireEvent.click(doneButton)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('invokes onOpenDetails and marks action with data-modal-autofocus', async () => {
    const onOpenDetails = vi.fn()
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: true,
      value: CONNECTED,
    }))

    render(
      <ZoteroActivationGuide
        packageName={ZOTERO_REMOTE_PACKAGE}
        onDismiss={vi.fn()}
        onOpenDetails={onOpenDetails}
        t={t}
        probe={probe}
      />,
    )

    const detailsButton = screen.getByText(t('activationDetails'))
    expect(detailsButton.getAttribute('data-modal-autofocus')).toBe('true')

    fireEvent.click(detailsButton)
    expect(onOpenDetails).toHaveBeenCalledTimes(1)
  })

  it('renders ready status without version suffix when zoteroVersion is omitted', async () => {
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: true,
      value: CONNECTED,
    }))

    render(
      <ZoteroActivationGuide
        packageName={ZOTERO_REMOTE_PACKAGE}
        onDismiss={vi.fn()}
        onOpenDetails={vi.fn()}
        t={t}
        probe={probe}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(t('activationReady'))).toBeDefined()
    })
  })

  it('renders diagnosis box and error state when local API communication is disabled', async () => {
    const onDismiss = vi.fn()
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: true,
      value: {
        ...UNAVAILABLE,
        diagnosis: 'ZOTERO_API_DISABLED: local api disabled',
      },
    }))

    render(
      <ZoteroActivationGuide
        packageName={ZOTERO_REMOTE_PACKAGE}
        onDismiss={onDismiss}
        onOpenDetails={vi.fn()}
        t={t}
        probe={probe}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(t('diagnosisApiDisabled'))).toBeDefined()
    })

    const dot = document.querySelector('[data-state="error"]')
    expect(dot).toBeDefined()
    const statusRow = document.querySelector('[data-state="disconnected"]')
    expect(statusRow).toBeDefined()
    expect(document.querySelector('[data-zotero-diagnosis-box]')).toBeDefined()

    const laterButton = screen.getByText(t('activationLater'))
    fireEvent.click(laterButton)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders diagnosis box and error state when probe promise rejects', async () => {
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => {
      throw new Error('Connection refused')
    })

    render(
      <ZoteroActivationGuide
        packageName={ZOTERO_REMOTE_PACKAGE}
        onDismiss={vi.fn()}
        onOpenDetails={vi.fn()}
        t={t}
        probe={probe}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeDefined()
    })

    const dot = document.querySelector('[data-state="error"]')
    expect(dot).toBeDefined()
    const statusRow = document.querySelector('[data-state="disconnected"]')
    expect(statusRow).toBeDefined()
    expect(document.querySelector('[data-zotero-diagnosis-box]')).toBeDefined()
  })

  it('renders fallback unknown diagnosis when failure payload carries empty diagnosis', async () => {
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: true,
      value: {
        ...UNAVAILABLE,
        diagnosis: '',
      },
    }))

    render(
      <ZoteroActivationGuide
        packageName={ZOTERO_REMOTE_PACKAGE}
        onDismiss={vi.fn()}
        onOpenDetails={vi.fn()}
        t={t}
        probe={probe}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(t('diagnosisUnknown'))).toBeDefined()
    })
  })

  it('re-probes connectivity and transitions from failure to ready when clicking check again', async () => {
    let callCount = 0
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => {
      callCount++
      if (callCount === 1) {
        return {
          ok: true,
          value: {
            ...UNAVAILABLE,
            diagnosis: 'ZOTERO_NOT_RUNNING',
          },
        }
      }
      return {
        ok: true,
        value: {
          ...CONNECTED,
          zoteroVersion: '7.0.12',
        },
      }
    })

    render(
      <ZoteroActivationGuide
        packageName={ZOTERO_REMOTE_PACKAGE}
        onDismiss={vi.fn()}
        onOpenDetails={vi.fn()}
        t={t}
        probe={probe}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(t('diagnosisNotRunning'))).toBeDefined()
    })

    const checkAgainButton = screen.getByText(t('activationCheckAgain'))
    fireEvent.click(checkAgainButton)

    await waitFor(() => {
      expect(screen.getByText(t('activationReadyVersion', { version: '7.0.12' }))).toBeDefined()
    })

    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('invokes onDismiss when modal close button is clicked', async () => {
    const onDismiss = vi.fn()
    const probe = vi.fn(async (): Promise<RemoteResult<ZoteroStatusView>> => ({
      ok: true,
      value: CONNECTED,
    }))

    render(
      <ZoteroActivationGuide
        packageName={ZOTERO_REMOTE_PACKAGE}
        onDismiss={onDismiss}
        onOpenDetails={vi.fn()}
        t={t}
        probe={probe}
      />,
    )

    const closeBtn = screen.getByRole('button', { name: t('activationClose') })
    fireEvent.click(closeBtn)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
