// @vitest-environment jsdom
/** Canonical annotation identity opens its owning PDF in Zotero. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LibraryInspector } from '../../../src/client/components/library/LibraryInspector.tsx'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it.each([
  [
    'zotero://user/0/annotation/ANNO0001',
    'zotero://user/0/attachment/ATTAC001',
    'library/items/ATTAC001',
  ],
  [
    'zotero://group/123/annotation/ANNO0001',
    'zotero://group/123/attachment/ATTAC001',
    'groups/123/items/ATTAC001',
  ],
  [
    'zotero://user/0/annotation/ANNO0001?server=S1',
    'zotero://user/0/attachment/ATTAC001?server=S1',
    'library/items/ATTAC001',
  ],
])('opens annotation ref %s using the owning attachment', (ref, parentRef, target) => {
  const opened: string[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    opened.push(this.href)
  })
  render(
    <LibraryInspector
      t={mockT}
      inspector={{
        phase: 'ready',
        detail: {
          ...ITEM_DETAIL,
          annotations: {
            offset: 0,
            limit: 1,
            total: 1,
            returned: 1,
            items: [{ ref, parentRef, type: 'highlight', text: 'Source quote', pageLabel: 'iv' }],
          },
        },
      }}
      retry={() => {}}
      pageChild={() => {}}
      childStates={{}}
      retryChild={() => {}}
      inputActions={undefined}
      openFile={undefined}
      resolveAttachment={undefined}
    />,
  )
  const card = screen.getByText('Source quote').closest('li')!
  fireEvent.click(within(card).getByRole('button', { name: mockT('openInZotero') }))
  expect(opened).toEqual([`zotero://open-pdf/${target}?annotation=ANNO0001`])
  expect(within(card).getByText('P. iv').tagName).toBe('SPAN')
})
it.each(['unparseable', 'zotero://user/0/annotation/SHORT'])(
  'omits location action for invalid annotation identity %s',
  (ref) => {
    render(
      <LibraryInspector
        t={mockT}
        inspector={{
          phase: 'ready',
          detail: {
            ...ITEM_DETAIL,
            annotations: {
              offset: 0,
              limit: 1,
              total: 1,
              returned: 1,
              items: [
                {
                  ref,
                  parentRef: 'zotero://user/0/attachment/ATTAC001',
                  type: 'highlight',
                  text: 'Source quote',
                },
              ],
            },
          },
        }}
        retry={() => {}}
        pageChild={() => {}}
        childStates={{}}
        retryChild={() => {}}
        inputActions={undefined}
        openFile={undefined}
        resolveAttachment={undefined}
      />,
    )
    const card = screen.getByText('Source quote').closest('li')!
    expect(within(card).queryByRole('button', { name: mockT('openInZotero') })).toBeNull()
  },
)
