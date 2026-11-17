// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { contextMenuRuntime } from './helpers/context-menu-runtime.tsx'

it('opens and selects the production shared overlay through its real registry', async () => {
  const fixture = await contextMenuRuntime()
  const run = vi.fn()
  try {
    fixture.menus.register({
      target: 'url',
      id: 'probe',
      order: 1,
      resolve: () => [{ id: 'copy', label: 'Copy target', run }],
    })
    await act(async () =>
      fixture.menus.open(
        { kind: 'url', value: { sessionId: 'menu-session' as never, url: 'https://example.org/' } },
        { x: 20, y: 20 },
      ),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy target' }))
    expect(run).toHaveBeenCalledOnce()
  } finally {
    await fixture.dispose()
  }
})
