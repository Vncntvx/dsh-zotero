// @vitest-environment jsdom
/**
 * The component enable disclosures: each component's namespace status says
 * whether it is served, and its notice is owed until this client acknowledges
 * the current enable — a deployment already enabled at boot included.
 * Dismissal covers that one enable: observing the component off revokes it, so
 * the next enable asks again, while a reload with the component still on stays
 * closed. One arbiter shows the two disclosures in registration order, so a
 * browser that owes both sees them one at a time. The rendered modals are
 * checked against the same controller state.
 * @module tests/client/enable-notice
 */

import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import {
  EnableNoticeArbiter,
  EnableNoticeController,
  type EnableNoticeFace,
  type EnableNoticeHookName,
  type EnableNoticeState,
} from '../../src/client/enable-notice.ts'
import { EnrichmentEnableNotice } from '../../src/client/enrichment/EnableNotice.tsx'
import type { EnrichmentEnableNoticeProps } from '../../src/client/enrichment/EnableNotice.tsx'
import { ScholarlyEnableNotice } from '../../src/client/scholarly/EnableNotice.tsx'
import type { ScholarlyEnableNoticeProps } from '../../src/client/scholarly/EnableNotice.tsx'
import { acknowledgementOf } from './helpers/acknowledgement.ts'
import { namespaceStatusSourceOf } from './helpers/namespace-status-source.ts'
import { zh } from '../../src/client/locales.ts'
import { makeTranslate } from './helpers/mock-translate.ts'

afterEach(() => {
  cleanup()
})

function controllerOf<Hook extends EnableNoticeHookName>(
  hook: Hook,
  source: ReturnType<typeof namespaceStatusSourceOf>,
  arbiter: EnableNoticeArbiter = new EnableNoticeArbiter(),
  acknowledgement = acknowledgementOf(),
) {
  const controller = new EnableNoticeController(source, hook, acknowledgement, arbiter)
  return {
    controller,
    acknowledgement,
    open: () => controller.inject().hooks[hook].getSnapshot().open,
    face: () => controller.inject(),
  }
}

function hookOf<Hook extends EnableNoticeHookName>(face: EnableNoticeFace<Hook>, hook: Hook) {
  const store = face.hooks[hook]
  return function useNotice<T>(selector: (state: EnableNoticeState) => T): T {
    return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
  }
}

function mountEnrichmentNotice(face: EnableNoticeFace<'enrichmentEnableNotice'>) {
  const props = {
    useEnrichmentEnableNotice: hookOf(face, 'enrichmentEnableNotice'),
    dismiss: face.dismiss,
    t: makeTranslate(zh),
  } as unknown as EnrichmentEnableNoticeProps
  return render(<EnrichmentEnableNotice {...props} />)
}

function mountScholarlyNotice(face: EnableNoticeFace<'scholarlyEnableNotice'>) {
  const props = {
    useScholarlyEnableNotice: hookOf(face, 'scholarlyEnableNotice'),
    dismiss: face.dismiss,
    t: makeTranslate(zh),
  } as unknown as ScholarlyEnableNoticeProps
  return render(<ScholarlyEnableNotice {...props} />)
}

describe('EnableNoticeController', () => {
  it('admits only the two declared hook names', () => {
    expectTypeOf<EnableNoticeHookName>().toEqualTypeOf<
      'enrichmentEnableNotice' | 'scholarlyEnableNotice'
    >()
  })

  it('opens for a deployment already enabled at boot until the client acknowledges it', () => {
    const source = namespaceStatusSourceOf()
    const { controller, open } = controllerOf('enrichmentEnableNotice', source)
    try {
      source.publish('ready')
      expect(open()).toBe(true)
    } finally {
      controller.dispose()
    }
  })

  it('stays closed when this client already acknowledged the disclosure', () => {
    const source = namespaceStatusSourceOf()
    const acknowledgement = acknowledgementOf()
    acknowledgement.remember()
    const { controller, open } = controllerOf(
      'enrichmentEnableNotice',
      source,
      new EnableNoticeArbiter(),
      acknowledgement,
    )
    try {
      source.publish('ready')
      expect(open()).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('never opens while the status is still loading', () => {
    const source = namespaceStatusSourceOf()
    const { controller, open, acknowledgement } = controllerOf('enrichmentEnableNotice', source)
    try {
      source.publish('loading')
      expect(open()).toBe(false)
      expect(acknowledgement.acknowledged).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('closes again when the component stops being served', () => {
    const source = namespaceStatusSourceOf()
    const { controller, open, acknowledgement } = controllerOf('enrichmentEnableNotice', source)
    try {
      source.publish('ready')
      controller.dismiss()
      expect(open()).toBe(false)
      expect(acknowledgement.acknowledged).toBe(true)
      source.publish('unavailable')
      expect(open()).toBe(false)
      // Turning the component off ends the acknowledged enable period.
      expect(acknowledgement.acknowledged).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('stays closed across a reload while the component stays on', () => {
    const source = namespaceStatusSourceOf()
    const acknowledgement = acknowledgementOf()
    const arbiter = new EnableNoticeArbiter()
    const first = controllerOf('enrichmentEnableNotice', source, arbiter, acknowledgement)
    try {
      source.publish('ready')
      first.controller.dismiss()
      expect(first.open()).toBe(false)
      expect(acknowledgement.acknowledged).toBe(true)
    } finally {
      first.controller.dispose()
    }

    // The same client reloads with the component still enabled: the persisted
    // acknowledgement is read, so the disclosure is not owed again.
    const reloaded = controllerOf('enrichmentEnableNotice', source, arbiter, acknowledgement)
    try {
      source.publish('ready')
      expect(reloaded.open()).toBe(false)
    } finally {
      reloaded.controller.dispose()
    }
  })

  it('opens again after the component is turned off and back on', () => {
    const source = namespaceStatusSourceOf()
    const { controller, open } = controllerOf('enrichmentEnableNotice', source)
    try {
      source.publish('ready')
      controller.dismiss()
      source.publish('unavailable')
      // The next enable is a new authorization: the client asks once more.
      source.publish('ready')
      expect(open()).toBe(true)
    } finally {
      controller.dispose()
    }
  })

  it('does not acknowledge anything when there is nothing to dismiss', () => {
    const source = namespaceStatusSourceOf()
    const { controller, acknowledgement } = controllerOf('enrichmentEnableNotice', source)
    try {
      source.publish('unavailable')
      controller.dismiss()
      expect(acknowledgement.acknowledged).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('shows the two owed disclosures one at a time in registration order', () => {
    const arbiter = new EnableNoticeArbiter()
    const enrichmentSource = namespaceStatusSourceOf()
    const scholarlySource = namespaceStatusSourceOf()
    const enrichment = controllerOf('enrichmentEnableNotice', enrichmentSource, arbiter)
    const scholarly = controllerOf('scholarlyEnableNotice', scholarlySource, arbiter)
    try {
      enrichmentSource.publish('ready')
      scholarlySource.publish('ready')
      expect(enrichment.open()).toBe(true)
      expect(scholarly.open()).toBe(false)

      enrichment.controller.dismiss()
      expect(enrichment.open()).toBe(false)
      expect(scholarly.open()).toBe(true)
      expect(enrichment.acknowledgement.acknowledged).toBe(true)
      expect(scholarly.acknowledgement.acknowledged).toBe(false)

      scholarly.controller.dismiss()
      expect(scholarly.open()).toBe(false)
      expect(scholarly.acknowledgement.acknowledged).toBe(true)
    } finally {
      enrichment.controller.dispose()
      scholarly.controller.dispose()
    }
  })
})

describe('EnrichmentEnableNotice', () => {
  it('renders the disclosure and dismisses it from the primary action', () => {
    const source = namespaceStatusSourceOf()
    const { controller, face } = controllerOf('enrichmentEnableNotice', source)
    try {
      source.publish('unavailable')
      mountEnrichmentNotice(face())
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

describe('ScholarlyEnableNotice', () => {
  it('renders the external-retrieval disclosure and dismisses it from the primary action', () => {
    const source = namespaceStatusSourceOf()
    const { controller, face } = controllerOf('scholarlyEnableNotice', source)
    try {
      source.publish('unavailable')
      mountScholarlyNotice(face())
      expect(screen.queryByRole('dialog')).toBeNull()
      act(() => {
        source.publish('ready')
      })
      expect(screen.getByRole('dialog', { name: zh.scholarlyEnableNoticeTitle })).toBeDefined()
      expect(screen.getByText(zh.scholarlyEnableNoticeDescription)).toBeDefined()
      fireEvent.click(screen.getByRole('button', { name: zh.scholarlyEnableNoticeConfirm }))
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      controller.dispose()
    }
  })
})
