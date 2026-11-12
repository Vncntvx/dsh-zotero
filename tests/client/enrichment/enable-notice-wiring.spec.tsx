// @vitest-environment jsdom
/**
 * The enable disclosure wired the way the client wires it: the notice reads
 * the enrichment card store that `EnrichmentFormController.project()` publishes,
 * not a hand-built status source.
 *
 * The unit spec next door owns the notice's own rules. This one owns the
 * connection: if the controller stops publishing `namespaceStatus`, points the
 * hook at another store, or the notice reads a different field, the modal would
 * silently never appear in production while every unit case stayed green.
 * @module tests/client/enrichment/enable-notice-wiring
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  EnrichmentFormController,
  type EnrichmentCredentialPort,
  type EnrichmentModelPort,
} from '../../../src/client/enrichment-form-controller.ts'
import {
  EnrichmentEnableNoticeController,
  type EnableNoticeAcknowledgement,
} from '../../../src/client/enrichment/enable-notice.ts'
import { fakeScope } from '../helpers/fake-scope.ts'

const controllers: EnrichmentFormController[] = []
const notices: EnrichmentEnableNoticeController[] = []

afterEach(() => {
  for (const notice of notices.splice(0)) notice.dispose()
  for (const controller of controllers.splice(0)) controller.dispose()
})

function credentialPort(): EnrichmentCredentialPort {
  return {
    describe: async () => ({ ok: true, value: {} }),
    set: async () => ({ ok: true, value: undefined }),
  }
}

function modelPort(): EnrichmentModelPort {
  const status = {
    model: 'balanced',
    ready: false,
    downloading: false,
    path: '',
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  }
  return {
    semanticModelStatus: async () => ({ ok: true as const, value: status }),
    downloadSemanticModel: async () => ({
      ok: true as const,
      value: { success: true, model: 'balanced', status: 'started' as const, path: '' },
    }),
    cancelSemanticModelDownload: async () => ({ ok: true as const, value: { cancelled: false } }),
    deleteSemanticModel: async () => ({
      ok: true as const,
      value: {
        success: true,
        model: 'balanced',
        path: '',
        removed: true,
        removedFiles: 0,
        removedBytes: 0,
      },
    }),
    verifySemanticModel: async () => ({ ok: true as const, value: { ...status, ready: true } }),
  }
}

/** The acknowledgement as a fresh client keeps it. */
function acknowledgementOf(): EnableNoticeAcknowledgement & { acknowledged: boolean } {
  const state = {
    acknowledged: false,
    read: () => state.acknowledged,
    remember: () => {
      state.acknowledged = true
    },
  }
  return state
}

describe('the end-to-end enable disclosure', () => {
  it('opens when the component becomes served through the real card store', () => {
    const scope = fakeScope({ status: 'unavailable' })
    const controller = new EnrichmentFormController(scope, credentialPort(), modelPort())
    controllers.push(controller)
    const store = controller.inject().hooks.enrichmentCard
    const acknowledgement = acknowledgementOf()
    const notice = new EnrichmentEnableNoticeController(store, acknowledgement)
    notices.push(notice)
    const open = () => notice.inject().hooks.enrichmentEnableNotice.getSnapshot().open

    // The component is not served: nothing is owed.
    expect(store.getSnapshot().namespaceStatus).toBe('unavailable')
    expect(open()).toBe(false)

    // The deployment flips the component on: the form's namespace becomes
    // ready, the controller republishes, and the disclosure opens.
    scope.publish({ status: 'ready' })
    expect(store.getSnapshot().namespaceStatus).toBe('ready')
    expect(open()).toBe(true)

    // The user accepts; the acknowledgement is written and the notice closes,
    // and a later status refresh does not reopen it.
    notice.dismiss()
    expect(acknowledgement.read()).toBe(true)
    expect(open()).toBe(false)
    scope.publish({ revision: 2 })
    expect(open()).toBe(false)
  })

  it('opens for a deployment already enabled when the client mounts', () => {
    const scope = fakeScope({ status: 'ready' })
    const controller = new EnrichmentFormController(scope, credentialPort(), modelPort())
    controllers.push(controller)
    const store = controller.inject().hooks.enrichmentCard
    const notice = new EnrichmentEnableNoticeController(store, acknowledgementOf())
    notices.push(notice)

    expect(store.getSnapshot().namespaceStatus).toBe('ready')
    expect(notice.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(true)
  })
})
