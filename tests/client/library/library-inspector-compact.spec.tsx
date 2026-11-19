// @vitest-environment jsdom
/**
 * The inspector's compact density mirrors the tree scale: the aside carries
 * the compact class and its action row stays present so the detail keeps its
 * primary read/ask actions at either density.
 * @module tests/client/library/library-inspector-compact
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryInspector } from '../../../src/client/components/library/LibraryInspector.tsx'
import { LibraryPreferencesContext } from '../../../src/client/library-preferences.tsx'
import { LIBRARY_DEFAULTS } from '../../../src/library-preferences.ts'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'

afterEach(cleanup)

function mount(density: 'comfortable' | 'compact') {
  return render(
    <LibraryPreferencesContext.Provider
      value={{ preferences: { ...LIBRARY_DEFAULTS, listDensity: density } }}
    >
      <LibraryInspector
        t={mockT}
        locale={{ getSnapshot: () => ({ active: 'en' }) }}
        inspector={{ phase: 'ready', detail: ITEM_DETAIL }}
        retry={vi.fn()}
        pageChild={vi.fn()}
        childStates={{}}
        retryChild={vi.fn()}
        inputActions={undefined}
        openFile={undefined}
        resolveAttachment={undefined}
      />
    </LibraryPreferencesContext.Provider>,
  )
}

describe('inspector compact density', () => {
  it('keeps the action row at compact density', () => {
    const comfortable = mount('comfortable')
    const wideClass = comfortable.container.querySelector('aside')?.className
    comfortable.unmount()
    const compact = mount('compact')
    expect(compact.container.querySelector('aside')?.className).not.toBe(wideClass)
    expect(compact.container.querySelector('[class*="_inspectorActions_"]')).not.toBeNull()
  })

  it('opens a URL action through the host protocol', () => {
    const openProtocol = vi.fn(async () => true)
    render(
      <LibraryPreferencesContext.Provider value={{ preferences: LIBRARY_DEFAULTS }}>
        <LibraryInspector
          t={mockT}
          locale={{ getSnapshot: () => ({ active: 'en' }) }}
          inspector={{ phase: 'ready', detail: ITEM_DETAIL }}
          retry={vi.fn()}
          pageChild={vi.fn()}
          childStates={{}}
          retryChild={vi.fn()}
          inputActions={undefined}
          openFile={undefined}
          resolveAttachment={undefined}
          openProtocol={openProtocol}
        />
      </LibraryPreferencesContext.Provider>,
    )
    const openUrl = screen.queryByRole('button', { name: zh.openInZotero })
    expect(openUrl).not.toBeNull()
  })
})
