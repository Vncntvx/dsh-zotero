// @vitest-environment jsdom
/** Ref-less search work is visible before the first source and after a failure. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceToolbar } from '../../../src/client/components/workspace/WorkspaceToolbar.tsx'
import { workspaceOf } from '../helpers/source-fixtures.ts'
import { mockT } from '../helpers/mock-translate.ts'

afterEach(cleanup)
it('updates the toolbar status across running, failed, stopped and empty search states', () => {
  const view = render(
    <WorkspaceToolbar
      connection={{ kind: 'loading' }}
      onRefresh={vi.fn()}
      t={mockT}
      workspace={workspaceOf([], { searchOperations: { running: 1, failed: 0, stopped: 0 } })}
    />,
  )
  expect(
    screen.getByRole('status', { name: mockT('searchOperationsLabel') }).textContent,
  ).toContain(mockT('runningBadge', { count: 1 }))
  expect(
    screen.getByRole('status', { name: mockT('searchOperationsLabel') }).textContent,
  ).toContain(mockT('searchOperationsLabel'))
  view.rerender(
    <WorkspaceToolbar
      connection={{ kind: 'loading' }}
      onRefresh={vi.fn()}
      t={mockT}
      workspace={workspaceOf([], { searchOperations: { running: 0, failed: 2, stopped: 1 } })}
    />,
  )
  expect(
    screen.getByRole('status', { name: mockT('searchOperationsLabel') }).textContent,
  ).toContain(mockT('failedBadge', { count: 2 }))
  expect(
    screen.getByRole('status', { name: mockT('searchOperationsLabel') }).textContent,
  ).toContain(mockT('stoppedBadge', { count: 1 }))
  view.rerender(
    <WorkspaceToolbar
      connection={{ kind: 'loading' }}
      onRefresh={vi.fn()}
      t={mockT}
      workspace={workspaceOf([])}
    />,
  )
  expect(screen.queryByRole('status', { name: mockT('searchOperationsLabel') })).toBeNull()
})
