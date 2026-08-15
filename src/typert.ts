/**
 * The hand-written host Typert manifest for the zotero Remote. Registered
 * through `ctx.typert.register` in the plugin body, it claims the wire
 * endpoints through the strict registry — the same path generated `./typert`
 * artifacts use — so the Host Gateway resolves and invokes `zotero/config`,
 * `zotero/configUpdate`, and `zotero/configClear` without consulting the
 * `@Remote` marker table. That marker independence matters in the harness's
 * source-launch development environment, where the tsx-loaded gateway and a
 * profile-loaded plugin bundle can hold separate copies of the decorator
 * module state.
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
        description: 'Reads and writes the zotero settings namespace for the Web settings page.',
        tags: [],
        members: [
          {
            kind: 'method',
            name: 'status',
            signature: 'status(): Promise<ZoteroStatusView>',
          },
          {
            kind: 'method',
            name: 'config',
            signature: 'config(): Promise<ZoteroConfigView>',
          },
          {
            kind: 'method',
            name: 'configUpdate',
            signature:
              'configUpdate(patch: Record<string, unknown>, revision?: number): Promise<ZoteroConfigView>',
          },
          {
            kind: 'method',
            name: 'configClear',
            signature: 'configClear(field: string, revision?: number): Promise<ZoteroConfigView>',
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
