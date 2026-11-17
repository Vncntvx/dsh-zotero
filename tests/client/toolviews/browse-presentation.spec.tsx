// @vitest-environment jsdom
/** Browse card limits preserve complete canonical pages and honest continuation. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowseToolView } from '../../../src/client/toolviews/BrowseToolView.tsx'
import { projectBrowseMeta } from '../../../src/presentation-meta.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { createToolViewProps, mockUseDisclosure } from '../helpers/mock-disclosure.ts'
import { settled } from '../helpers/blocks.ts'

afterEach(cleanup)
function viewBrowse(block: ReturnType<typeof settled>) {
  return render(
    <BrowseToolView
      {...createToolViewProps({
        callId: 'browse-budget',
        toolName: 'zotero_browse',
        phase: 'result',
        block,
        useDisclosure: mockUseDisclosure(true),
        t: mockT,
      })}
    />,
  )
}

describe('browse card presentation limits', () => {
  it('renders a bounded page with an honest omitted-row count and canonical continuation', () => {
    const items = Array.from({ length: 50 }, (_, index) => ({ tag: `Tag ${index}` }))
    const meta = projectBrowseMeta({
      kind: 'tags',
      items,
      returned: 50,
      total: 100,
      offset: 0,
      nextOffset: 50,
    })
    viewBrowse(settled({ call: { name: 'zotero_browse', argsRaw: '{"kind":"tags"}' }, meta }))
    expect(screen.getByText('Tag 0')).toBeTruthy()
    expect(screen.getByText('Tag 19')).toBeTruthy()
    expect(screen.queryByText('Tag 20')).toBeNull()
    expect(screen.getByText(mockT('toolBrowseOmittedRows', { count: 30 }))).toBeTruthy()
    expect(screen.getByText(mockT('toolBrowseNextPage', { offset: 50 }))).toBeTruthy()
  })

  it('does not call a nonempty page empty when its first row exceeds the card budget', () => {
    const meta = projectBrowseMeta({
      kind: 'tags',
      items: [{ tag: 'x'.repeat(10_000) }],
      returned: 1,
      total: 1,
      offset: 0,
    })
    viewBrowse(
      settled({
        call: { name: 'zotero_browse', argsRaw: '{"kind":"tags"}' },
        meta,
        content: [{ type: 'text', text: 'Complete canonical page' }],
      }),
    )
    expect(screen.queryByText(mockT('toolNoResults'))).toBeNull()
    expect(screen.getByText('Complete canonical page')).toBeTruthy()
  })
})
