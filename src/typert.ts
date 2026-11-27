/**
 * The hand-written host Typert manifest for the zotero Remote. Registered
 * through `ctx.typert.register` in the plugin body, not as a generated
 * `./typert` artifact: Typert's generator runs only inside a workspace root
 * that contains both `tsconfig.host.json` and `packages/`, and this
 * repository is a standalone checkout with neither, so no artifact can be
 * generated here. The registry documents `ctx.typert.register()` as the path
 * for hand-written wire schemas. No `./typert` export is declared on purpose:
 * the production Loader row is the bare package name `dsh-zotero`, which
 * dsh-typert-loader's entry discovery would resolve, and registering the same
 * `package#face` again fails with "already registered" (see service.ts).
 * The strict registry is the Host Gateway's preferred resolution path for
 * `zotero/status` and needs no `@Remote` markers.
 *
 * Both halves register the same lazy invocation descriptors from the
 * client-safe `wire-schemas.ts`. Structural endpoint identity is shared
 * through `contract.ts`. The service key spells {@link ZOTERO_STATUS_SERVICE_KEY}, the same
 * constant the host Remote service and the invocation descriptor use.
 *
 * The manifest declares the `zoteroLibrary` service of the separate
 * `dsh-zotero/library` bundle row. Deliberate: Typert binds endpoints by
 * composed service at runtime, so with the row disabled nothing answers, but
 * the declaration stays here because the manifest is one static contribution
 * per package. The browser-side `whileServed('library')` watch
 * (`client/index.ts`) mounts library panel surfaces only while the row is served.
 * The core SourcesTab has a separate URL PDF action gate: its live library
 * preference snapshot must exist and permit URL PDF reading before dispatch.
 * Turning the library row off revokes that snapshot and blocks the core action.
 * @module dsh-zotero/typert
 */

import type {
  TypertContribution,
  TypertSchemaFactory,
} from '@deepseek-ai/dsh-typert-registry/types'
import type { TypertCodec } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import {
  ZOTERO_REMOTE_PACKAGE,
  ZOTERO_STATUS_SERVICE_KEY,
  ZOTERO_LIBRARY_SERVICE_KEY,
  ZOTERO_ENRICHMENT_SERVICE_KEY,
  ZOTERO_READER_SERVICE_KEY,
} from './contract.js'
import { ZOTERO_COMMON_INVOCATIONS } from './wire-schemas.js'

/** Invocation codecs are the sole schema registry authority. */
function schemaFactories(): TypertSchemaFactory[] {
  const schemas = new Map<string, TypertSchemaFactory>()
  const add = (codec: TypertCodec): void => {
    if (codec.mode !== 'strict') return
    const prefix = `${ZOTERO_REMOTE_PACKAGE}#`
    if (!codec.typeSymbol.startsWith(prefix))
      throw new Error(`Unexpected schema owner: ${codec.typeSymbol}`)
    if (!schemas.has(codec.typeSymbol))
      schemas.set(codec.typeSymbol, {
        name: codec.typeSymbol.slice(prefix.length),
        create: () => {
          const schema = codec.create()
          if (!(schema instanceof z.ZodType))
            throw new Error(`Expected a Zod schema for ${codec.typeSymbol}`)
          return schema
        },
      })
  }
  for (const invocation of ZOTERO_COMMON_INVOCATIONS) {
    if (invocation.invocation.kind === 'context') add(invocation.invocation.codec)
    for (const parameter of invocation.parameters) add(parameter.codec)
    if (invocation.uplink) add(invocation.uplink.codec)
    add(invocation.result)
  }
  return [...schemas.values()]
}

function membersOf(service: string) {
  const typeName = (codec: TypertCodec): string => {
    if (codec.mode !== 'strict')
      throw new Error('Every Zotero wire type requires a named strict codec.')
    return codec.typeSymbol.slice(codec.typeSymbol.indexOf('#') + 1)
  }
  return ZOTERO_COMMON_INVOCATIONS.filter((entry) => entry.service === service).map((entry) => ({
    kind: 'method' as const,
    name: entry.method,
    signature: `${entry.method}(${[
      ...entry.parameters.map((param) => `${param.name}: ${typeName(param.codec)}`),
      ...(entry.cancellation ? [`${entry.cancellation.parameter}: AbortSignal`] : []),
    ].join(', ')}): Promise<${typeName(entry.result)}>`,
  }))
}

/** The zotero namespace's host manifest (strict codecs owned by this half). */
export const TYPERT_MANIFEST: TypertContribution = {
  package: ZOTERO_REMOTE_PACKAGE,
  face: 'host',
  schemas: schemaFactories(),
  model: {
    services: [
      {
        key: ZOTERO_STATUS_SERVICE_KEY,
        exportName: 'ZoteroRuntime',
        description: 'Serves live Zotero connectivity facts to the dedicated web tab.',
        tags: [],
        members: membersOf(ZOTERO_STATUS_SERVICE_KEY),
        types: [],
      },
      {
        key: ZOTERO_ENRICHMENT_SERVICE_KEY,
        exportName: 'EnrichmentService',
        description:
          'Serves the optional enrichment component: explicit session-owned document parsing, artifact receipts, and local semantic-model management. Answers only while the component row is composed.',
        tags: [],
        members: membersOf(ZOTERO_ENRICHMENT_SERVICE_KEY),
        types: [],
      },
      {
        key: ZOTERO_LIBRARY_SERVICE_KEY,
        exportName: 'ZoteroLibraryService',
        description: 'Serves library panel listings, user PDF reads, and approved mutations.',
        tags: [],
        members: membersOf(ZOTERO_LIBRARY_SERVICE_KEY),
        types: [],
      },
      {
        key: ZOTERO_READER_SERVICE_KEY,
        exportName: 'ReaderService',
        description: 'Serves the optional Zotero Reader for session reading.',
        tags: [],
        members: membersOf(ZOTERO_READER_SERVICE_KEY),
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: ZOTERO_COMMON_INVOCATIONS,
}
