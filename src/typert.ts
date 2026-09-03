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
 * @module dsh-zotero/typert
 */

import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { ZOTERO_INVOCATIONS } from './contract.js'

/** The zotero namespace's host manifest (strict codecs shared with the client). */
export const TYPERT_MANIFEST: TypertContribution = {
  package: 'dsh-zotero',
  face: 'host',
  schemas: [],
  model: {
    services: [
      {
        key: 'zoteroRemote',
        exportName: 'ZoteroRuntime',
        description: 'Serves live Zotero connectivity facts to the dedicated web tab.',
        tags: [],
        members: [
          {
            kind: 'method',
            name: 'status',
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
