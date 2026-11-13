// @vitest-environment jsdom
/**
 * The enable disclosure wired the way the client wires it: the notice reads
 * the enrichment card store that `EnrichmentFormController.project()` publishes,
 * not a hand-built status source.
 *
 * The shared wiring suite owns both components' connection between the real
 * card store and the notice, so a controller that stops publishing
 * `namespaceStatus` cannot pass one component's spec while silently failing
 * the other's.
 * @module tests/client/enrichment/enable-notice-wiring
 */

import {
  EnrichmentFormController,
  type EnrichmentCredentialPort,
  type EnrichmentModelPort,
} from '../../../src/client/enrichment-form-controller.ts'
import { fakeScope } from '../helpers/fake-scope.ts'
import { describeEnableNoticeWiring } from '../helpers/enable-notice-wiring.ts'

interface EnrichmentCard {
  readonly scope: ReturnType<typeof fakeScope>
  readonly controller: EnrichmentFormController
}

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

describeEnableNoticeWiring<EnrichmentCard, 'enrichmentEnableNotice'>({
  label: 'the end-to-end enrichment enable disclosure',
  hook: 'enrichmentEnableNotice',
  cardOf: (status) => {
    const scope = fakeScope({ status })
    return { scope, controller: new EnrichmentFormController(scope, credentialPort(), modelPort()) }
  },
  storeOf: (card) => card.controller.inject().hooks.enrichmentCard,
  publish: (card, patch) => card.scope.publish(patch),
  dispose: (card) => card.controller.dispose(),
})
