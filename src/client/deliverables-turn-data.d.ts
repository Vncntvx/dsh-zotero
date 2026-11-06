/**
 * Client-side declaration of the `deliverables` turn-data key.
 *
 * Upstream `@deepseek-ai/dsh-client-ui-deliverables` declares this
 * `ConversationTurnDataMap` augmentation from
 * `src/client/turn-deliverables.ts`, a path its `exports` map advertises but
 * its published tarball does not contain (`files` lists only `lib/**` and
 * `locale/*.json`). Importing that path therefore works against a sibling
 * checkout and fails typecheck plus runtime resolution in a registry-only
 * install, which is the client lane the CI runs.
 *
 * This declaration restates the value shape against the *public*
 * `@deepseek-ai/dsh-tool-present/types` entry, so
 * `DeliverableZoteroAction`'s `turn.data.get('deliverables')` is typed from
 * published declarations alone. `tests/client/deliverables/turn-data-contract.spec.ts`
 * pins the shape to the production reader; if upstream ever exports the
 * augmentation from a public entry, delete this file and reference that entry
 * instead of keeping two copies of the shape.
 *
 * @module dsh-zotero/client/deliverables-turn-data.d.ts
 */

import type { PresentedFile } from '@deepseek-ai/dsh-tool-present/types'

/** A file a successful first-party mutation wrote in this turn. */
export interface ProducedPath {
  readonly path: string
  readonly argumentPath?: string
}

/** A declared file with its authorized open coordinates. */
export interface PresentedPath extends PresentedFile {
  readonly seq: number
  readonly index: number
}

/** The latest `workspace/changes` announcement of one turn. */
export interface ChangesTurnData {
  readonly seq: number
}

/** Immutable produced-file facts published against one turn. */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
  readonly presented?: readonly PresentedPath[]
  readonly changes?: ChangesTurnData
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Produced paths, change announcements, and deliveries accumulated in this turn. */
    deliverables: DeliverablesTurnData
  }
}
