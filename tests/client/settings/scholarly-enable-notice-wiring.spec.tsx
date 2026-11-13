// @vitest-environment jsdom
/**
 * The scholarly enable disclosure wired the way the client wires it: the notice
 * reads the scholarly card store that `ScholarlyFormController.project()`
 * publishes, not a hand-built status source.
 *
 * The shared wiring suite owns both components' connection between the real
 * card store and the notice, so a controller that stops publishing
 * `namespaceStatus` cannot pass one component's spec while silently failing
 * the other's.
 * @module tests/client/settings/scholarly-enable-notice-wiring
 */

import { ScholarlyFormController } from '../../../src/client/scholarly-form-controller.ts'
import { emptyCredentialPort } from '../helpers/credential-port.ts'
import { fakeScope } from '../helpers/fake-scope.ts'
import { describeEnableNoticeWiring } from '../helpers/enable-notice-wiring.ts'

interface ScholarlyCard {
  readonly scope: ReturnType<typeof fakeScope>
  readonly controller: ScholarlyFormController
}

describeEnableNoticeWiring<ScholarlyCard, 'scholarlyEnableNotice'>({
  label: 'the end-to-end scholarly enable disclosure',
  hook: 'scholarlyEnableNotice',
  cardOf: (status) => {
    const scope = fakeScope({ status })
    return { scope, controller: new ScholarlyFormController(scope, emptyCredentialPort) }
  },
  storeOf: (card) => card.controller.inject().hooks.scholarlyCard,
  publish: (card, patch) => card.scope.publish(patch),
  dispose: (card) => card.controller.dispose(),
})
