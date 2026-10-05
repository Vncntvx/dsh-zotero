/**
 * The fixtures the `buildSourceWorkspace` specs share: the ref builder, the
 * settled tool-call block with JSON arguments, and the canonical get
 * projection every spec asserts against. What two or more of `reducer.spec.ts`,
 * `reducer-evidence.spec.ts`, and `reducer-outputs.spec.ts` use lives here —
 * the search projection builder, the episode search occurrence builder, and the
 * retrieve projection stay with the one spec that reads them.
 * @module tests/client/sources/reducer-fixtures
 */

import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { settled } from '../helpers/blocks.ts'

/** One item/attachment/annotation ref in the specs' spelling. */
export const REF = (key: string, serverId?: string): string =>
  `zotero://user/0/item/${key}${serverId === undefined ? '' : `?server=${serverId}`}`

/** One settled zotero tool result whose arguments are the JSON of `args`. */
export function block(
  callId: string,
  seq: number,
  name: string,
  args: Record<string, unknown>,
  extra: Partial<ToolResultNode> = {},
): ToolResultNode {
  return settled({ callId, seq, call: { name, argsRaw: JSON.stringify(args) }, ...extra })
}

/** The get projection with every field the specs assert on. */
export const GET_META = {
  title: 'Attention Is All You Need',
  creators: 'Vaswani',
  year: 2017,
  venue: 'NeurIPS',
  itemType: 'journalArticle',
  notesPreview: [],
  annotationsPreview: [],
}
