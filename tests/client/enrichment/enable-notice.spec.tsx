// @vitest-environment jsdom
/**
 * The enrichment egress disclosure: the settings form's namespace status says
 * whether the component is served, and the notice is owed until this client
 * acknowledges it — a deployment already enabled at boot included. Dismissal
 * persists the acknowledgement, so a second controller over the same storage
 * stays closed. The rendered modal is checked against the same controller
 * state.
 * @module tests/client/enrichment/enable-notice
 */

import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EnrichmentEnableNoticeController,
  type EnrichmentEnableNoticeFace,
  type EnrichmentEnableNoticeState,
  type EnrichmentNamespaceStatus,
} from '../../../src/client/enrichment/enable-notice.ts'
import { acknowledgementOf } from './support/acknowledgement.ts'
import { EnrichmentEnableNotice } from '../../../src/client/enrichment/EnableNotice.tsx'
import type { EnrichmentEnableNoticeProps } from '../../../src/client/enrichment/EnableNotice.tsx'
import { zh } from '../../../src/client/locales.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

afterEach(() => {
  cleanup()
})

function statusSourceOf() {
  let snapshot: { namespaceStatus: EnrichmentNamespaceStatus } = { namespaceStatus: 'loading' }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publish: (namespaceStatus: EnrichmentNamespaceStatus) => {
      snapshot = { namespaceStatus }
      for (const listener of listeners) listener()
    },
  }
}

function hookOf(face: EnrichmentEnableNoticeFace) {
  const store = face.hooks.enrichmentEnableNotice
  return function useNotice<T>(selector: (state: EnrichmentEnableNoticeState) => T): T {
    return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
  }
}

function mountNotice(face: EnrichmentEnableNoticeFace) {
  const props = {
    useEnrichmentEnableNotice: hookOf(face),
    dismiss: face.dismiss,
    t: makeTranslate(zh),
  } as unknown as EnrichmentEnableNoticeProps
  return render(<EnrichmentEnableNotice {...props} />)
}

describe('EnrichmentEnableNoticeController', () => {
  it('opens for a deployment already enabled at boot until the client acknowledges it', () => {
    const source = statusSourceOf()
    const acknowledgement = acknowledgementOf()
    const controller = new EnrichmentEnableNoticeController(source, acknowledgement)
    try {
      source.publish('ready')
      expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(true)
    } finally {
      controller.dispose()
    }
  })

  it('stays closed when this client already acknowledged the disclosure', () => {
    const source = statusSourceOf()
    const acknowledgement = acknowledgementOf()
    acknowledgement.remember()
    const controller = new EnrichmentEnableNoticeController(source, acknowledgement)
    try {
      source.publish('ready')
      expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('never opens while the status is still loading', () => {
    const source = statusSourceOf()
    const acknowledgement = acknowledgementOf()
    const controller = new EnrichmentEnableNoticeController(source, acknowledgement)
    try {
      source.publish('loading')
      expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(false)
      expect(acknowledgement.acknowledged).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('closes again when the component stops being served', () => {
    const source = statusSourceOf()
    const acknowledgement = acknowledgementOf()
    const controller = new EnrichmentEnableNoticeController(source, acknowledgement)
    try {
      source.publish('ready')
      expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(true)
      source.publish('unavailable')
      expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('persists the acknowledgement so a second controller stays closed', () => {
    const source = statusSourceOf()
    const acknowledgement = acknowledgementOf()
    const first = new EnrichmentEnableNoticeController(source, acknowledgement)
    try {
      source.publish('ready')
      first.dismiss()
      expect(first.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(false)
      expect(acknowledgement.acknowledged).toBe(true)
    } finally {
      first.dispose()
    }

    // The same client reloads: the persisted acknowledgement is read, so the
    // notice is not owed again, and disabling then re-enabling the component
    // does not reopen it either.
    const reloaded = new EnrichmentEnableNoticeController(source, acknowledgement)
    try {
      source.publish('ready')
      expect(reloaded.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(false)
      source.publish('unavailable')
      source.publish('ready')
      expect(reloaded.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(false)
    } finally {
      reloaded.dispose()
    }
  })

  it('does not acknowledge anything when there is nothing to dismiss', () => {
    const source = statusSourceOf()
    const acknowledgement = acknowledgementOf()
    const controller = new EnrichmentEnableNoticeController(source, acknowledgement)
    try {
      source.publish('unavailable')
      controller.dismiss()
      expect(acknowledgement.acknowledged).toBe(false)
    } finally {
      controller.dispose()
    }
  })
})

describe('EnrichmentEnableNotice', () => {
  it('renders the disclosure and dismisses it from the primary action', () => {
    const source = statusSourceOf()
    const controller = new EnrichmentEnableNoticeController(source, acknowledgementOf())
    try {
      source.publish('unavailable')
      mountNotice(controller.inject())
      expect(screen.queryByRole('dialog')).toBeNull()
      act(() => {
        source.publish('ready')
      })
      expect(screen.getByRole('dialog', { name: zh.enrichmentEnableNoticeTitle })).toBeDefined()
      expect(screen.getByText(zh.enrichmentEnableNoticeDescription)).toBeDefined()
      fireEvent.click(screen.getByRole('button', { name: zh.enrichmentEnableNoticeConfirm }))
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      controller.dispose()
    }
  })
})
