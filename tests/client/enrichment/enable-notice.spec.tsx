// @vitest-environment jsdom
/**
 * The enrichment enable disclosure: the settings form's namespace status is
 * the enable signal, the first settled status is a baseline, and dismissal is
 * scoped to one serving of the component. The rendered modal is checked
 * against the same controller state.
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
  it('treats the first settled status as a baseline, even when the component is already on', () => {
    const source = statusSourceOf()
    const controller = new EnrichmentEnableNoticeController(source)
    try {
      source.publish('ready')
      expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('opens when a boot-enabled component is disabled and re-enabled', () => {
    const source = statusSourceOf()
    const controller = new EnrichmentEnableNoticeController(source)
    try {
      source.publish('ready')
      source.publish('unavailable')
      source.publish('ready')
      expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(true)
    } finally {
      controller.dispose()
    }
  })

  it('opens on an unavailable to ready transition and closes on dismissal', () => {
    const source = statusSourceOf()
    const controller = new EnrichmentEnableNoticeController(source)
    try {
      source.publish('unavailable')
      expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(false)
      source.publish('ready')
      expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(true)
      controller.dismiss()
      expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(false)
      // A later status refresh that stays ready does not reopen it.
      source.publish('ready')
      expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('shows the disclosure again when the component is disabled and re-enabled', () => {
    const source = statusSourceOf()
    const controller = new EnrichmentEnableNoticeController(source)
    try {
      source.publish('unavailable')
      source.publish('ready')
      controller.dismiss()
      source.publish('unavailable')
      source.publish('ready')
      expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(true)
    } finally {
      controller.dispose()
    }
  })
})

describe('EnrichmentEnableNotice', () => {
  it('renders the disclosure and dismisses it from the primary action', () => {
    const source = statusSourceOf()
    const controller = new EnrichmentEnableNoticeController(source)
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
