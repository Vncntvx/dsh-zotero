/**
 * The hand-written host Typert manifest for the zotero Remote. Registered
 * through `ctx.typert.register` in the plugin body — not via a `./typert`
 * export, because dsh-typert-loader's auto-discovery only resolves
 * bare-package-name rows and would double-register this manifest on the
 * production profile where the plugin also self-registers (see service.ts).
 * The strict registry is the Host Gateway's preferred resolution path for
 * `zotero/status` and needs no `@Remote` markers; avoiding the decorators
 * also keeps the source runnable under Node's plain TypeScript type
 * stripping, which rejects decorator syntax.
 *
 * Invocations come from `status-codec.ts` (host zod factories). Structural endpoint identity is shared with the client through
 * `contract.ts`; only this half materializes boundary schemas. The model's
 * service key spells {@link ZOTERO_STATUS_SERVICE_KEY} — the same constant
 * the host Remote service and the invocation descriptor use.
 * @module dsh-zotero/typert
 */

import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import {
  ZOTERO_REMOTE_PACKAGE,
  ZOTERO_STATUS_METHOD,
  ZOTERO_STATUS_SERVICE_KEY,
} from './contract.js'
import { ZOTERO_INVOCATIONS } from './status-codec.js'

/** The zotero namespace's host manifest (strict codecs owned by this half). */
export const TYPERT_MANIFEST: TypertContribution = {
  package: ZOTERO_REMOTE_PACKAGE,
  face: 'host',
  schemas: [],
  model: {
    services: [
      {
        key: ZOTERO_STATUS_SERVICE_KEY,
        exportName: 'ZoteroRuntime',
        description: 'Serves live Zotero connectivity facts to the dedicated web tab.',
        tags: [],
        members: [
          {
            kind: 'method',
            name: ZOTERO_STATUS_METHOD,
            signature: 'status(): Promise<ZoteroStatusView>',
          },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: ZOTERO_INVOCATIONS,
}
