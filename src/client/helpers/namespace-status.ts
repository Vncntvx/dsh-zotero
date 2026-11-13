/**
 * The namespace lifecycle the settings forms publish.
 *
 * The value set is owned by the harness's `ConfigFormSnapshot`, so the two
 * card controllers and the enable-notice controller read one authoritative
 * type instead of restating the union in an overlay module.
 * @module dsh-zotero/client/helpers/namespace-status
 */

import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** `loading` until the first accepted section, then `ready` or `unavailable`. */
export type NamespaceStatus = ConfigFormSnapshot<unknown>['status']
