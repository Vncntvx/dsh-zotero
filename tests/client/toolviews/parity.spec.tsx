/**
 * The card-table parity contract: every host-registered local tool has a
 * dedicated Chat card, and no card is registered for a tool the host does not
 * register — a tool added without a card (the `zotero_batch_items` gap this
 * closes) or a card left behind by a retired tool fails here instead of
 * silently degrading to the generic row.
 *
 * The six retrieval-only scholarly tools (`scholarly_search`, `scholarly_get`,
 * `scholarly_citations`, `scholarly_read`, `scholarly_cite`, `scholarly_verify`)
 * deliberately have no dedicated card: the `tool.call.toolview` contract falls
 * back to the generic row for an unclaimed key, and their results are text
 * receipts rather than structured write/browse data. `scholarly_save_to_zotero`
 * writes to the library, so it carries the write receipt card.
 *
 * The scholarly tool vocabulary is derived from the tool factories in
 * `tests/scholarly/search-tools.spec.ts`, one lane over, because those
 * factories pull Node-side transport code this client project does not
 * typecheck.
 * @module tests/client/toolviews/parity
 */

import { describe, expect, it } from 'vitest'
import { REGISTRATIONS } from '../../../src/client/toolviews/index.ts'
import { ZOTERO_TOOL_NAMES } from '../../../src/constants.js'

describe('tool card table parity', () => {
  it('registers one card per host tool and none besides', () => {
    const cardKeys = [...REGISTRATIONS.map(([key]) => key)].sort()
    const expected = [...ZOTERO_TOOL_NAMES, 'scholarly_save_to_zotero'].sort()
    expect(cardKeys).toEqual(expected)
  })
})
