// @vitest-environment jsdom
/**
 * The tool cards hand `DisclosureRow` stable props.
 *
 * The harness primitive is `memo`'d with a shallow prop comparison, and in a
 * long transcript most rows are collapsed — the case where an unstable prop
 * re-renders every card on every unrelated parent update and buys nothing.
 * A tool view that builds its `icon` inline defeats the memo for exactly that
 * case, because the collapsed body is otherwise prop-identical.
 *
 * The card list comes from the plugin's own registration table rather than a
 * copy of it, so a twelfth tool cannot register a card this spec never renders.
 * @module tests/client/toolviews/memo-stability
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REGISTRATIONS } from '../../../src/client/toolviews/index.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { createToolViewProps } from '../helpers/mock-disclosure.ts'
import { settled } from '../helpers/blocks.ts'

// `vi.mock` factories are hoisted above the spec's imports, so the counter has
// to be created inside the factory and read back through a `var` binding the
// factory assigns — the same shape `writeClipboardSpy` uses in reverse.
var counterRef: { renders: () => number } | undefined

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub, countingDisclosure } = await import('../helpers/primitives-stub.ts')
  const counter = countingDisclosure()
  counterRef = counter
  return primitivesStub({ DisclosureRow: counter.DisclosureRow })
})

/** How many times the memo'd `DisclosureRow` body has actually run. */
function disclosureRenders(): number {
  if (counterRef === undefined) throw new Error('the DisclosureRow stub was never installed')
  return counterRef.renders()
}

/**
 * A collapsed disclosure whose `toggle` identity never moves, the way the
 * harness's own `useDisclosure` does (`useCallback`). The shared
 * `mockUseDisclosure` builds a fresh `vi.fn()` per call, which would defeat
 * the memo from the test side and hide the thing this spec measures.
 */
const stableCollapsed = (() => {
  const toggle = vi.fn()
  return () => ({
    expanded: false,
    toggle,
    expand: vi.fn(),
    collapse: vi.fn(),
    setExpanded: vi.fn(),
  })
})()

const REF = 'zotero://user/0/item/ABCD1234'

/** The arguments each tool needs for a settled, collapsed card. */
const ARGS: Record<string, Record<string, unknown>> = {
  zotero_search: { query: 'quantum' },
  zotero_retrieve: { ref: REF, query: 'attention' },
  zotero_export: { format: 'bibtex', refs: [REF] },
  zotero_get: { ref: REF },
  zotero_children: { ref: REF },
  zotero_attachment: { ref: 'zotero://user/0/attachment/WXYZ6789' },
  zotero_create_note: { markdown: '# Note' },
  zotero_update_item_tags: { ref: REF, add: ['ai'] },
  zotero_update_item_collections: { ref: REF, add: ['Reading'] },
  zotero_create_collection: { name: 'Reading' },
  zotero_delete_collection: { collection: 'Reading' },
  zotero_create_item: { itemType: 'book', title: 'A study' },
  zotero_update_item: { ref: REF, set: { title: 'A study' } },
  zotero_delete_library_tags: { tags: ['ai'] },
  zotero_browse: { kind: 'collections' },
  zotero_changes: { since: { version: 10, serverId: 'abc' } },
}

describe('tool cards hand DisclosureRow stable props', () => {
  it("registers a card for every one of the plugin's tools, and each holds its memo", () => {
    // Walking the registration table rather than a copy of it is what makes it
    // impossible to add a tool without covering its card here.
    expect(Object.keys(ARGS).sort()).toEqual(REGISTRATIONS.map(([name]) => name).sort())

    // The table is heterogeneous by design — each card has its own props type —
    // so the loop widens it once, through `any`, rather than pretending they
    // share a shape. Nothing here inspects a prop; the assertion is the render
    // count, which the props' types cannot affect.
    const cards = REGISTRATIONS.map(([toolName, View]) => [toolName, View] as [string, any])

    for (const [toolName, View] of cards) {
      const block = settled({
        call: { name: toolName, argsRaw: JSON.stringify(ARGS[toolName] ?? {}) },
        content: [{ type: 'text', text: 'result text' }],
      })
      const props = createToolViewProps({
        callId: 'c1',
        toolName,
        phase: 'result',
        block,
        useDisclosure: stableCollapsed,
        t: mockT,
      })
      const before = disclosureRenders()
      const { rerender, unmount } = render(<View {...props} />)
      expect(disclosureRenders() - before, toolName).toBe(1)

      // A parent re-render with the identical call is the streaming case: the
      // card's own facts have not moved, so the memo must hold.
      rerender(<View {...props} />)
      expect(disclosureRenders() - before, toolName).toBe(1)
      unmount()
    }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
