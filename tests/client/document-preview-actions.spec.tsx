// @vitest-environment jsdom
/**
 * The two document slots share one bibliography guard and button; the table
 * below keeps each slot's behaviour explicit without mirroring the same
 * describe twice.
 * @module tests/client/document-preview-actions
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  DocumentZoteroAction,
  type DocumentZoteroActionProps,
} from '../../src/client/components/document/DocumentZoteroAction.tsx'
import {
  DocumentUnpreviewableAction,
  type DocumentUnpreviewableActionProps,
} from '../../src/client/components/document/DocumentUnpreviewableAction.tsx'
import { BibliographyAction } from '../../src/client/components/document/BibliographyAction.tsx'
import { mockT } from './helpers/mock-translate.ts'

// Stub primitives so icon and button imports do not load the full bundle.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('./helpers/primitives-stub.ts')
  return primitivesStub()
})

interface ActionProps {
  readonly absolutePath: string
  readonly t: typeof mockT
  readonly onOpenLibrary?: () => void
}

interface ActionCase {
  readonly name: string
  readonly element: (props: ActionProps) => ReactNode
}

const actions: readonly ActionCase[] = [
  {
    name: 'DocumentZoteroAction',
    element: (props) => (
      <DocumentZoteroAction {...(props as unknown as DocumentZoteroActionProps)} />
    ),
  },
  {
    name: 'DocumentUnpreviewableAction',
    element: (props) => (
      <DocumentUnpreviewableAction {...(props as unknown as DocumentUnpreviewableActionProps)} />
    ),
  },
]

describe('Document preview actions', () => {
  afterEach(() => {
    cleanup()
  })
  const label = mockT('openInLibraryPanel')

  it.each(actions)('$name returns null for a non-bibliography path', ({ element }) => {
    const { container } = render(element({ absolutePath: '/workspace/project/main.ts', t: mockT }))
    expect(container.firstChild).toBeNull()
  })

  it.each(actions)('$name renders one accessible button that opens the library', ({ element }) => {
    const onOpen = vi.fn()
    const { getByRole } = render(
      element({
        absolutePath: '/workspace/project/references.bib',
        onOpenLibrary: onOpen,
        t: mockT,
      }),
    )
    const button = getByRole('button')
    expect(button.textContent).toBe(label)
    expect(button.title).toBe(label)
    expect(button.getAttribute('aria-label')).toBe(label)
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it.each(actions)('$name renders for a .ris suffix too', ({ element }) => {
    const { getByRole } = render(
      element({
        absolutePath: '/workspace/project/citations.ris',
        onOpenLibrary: vi.fn(),
        t: mockT,
      }),
    )
    expect(getByRole('button').textContent).toBe(label)
  })

  it('shares the path guard and button through BibliographyAction', () => {
    const onOpen = vi.fn()
    const { container, getByRole, rerender } = render(
      <BibliographyAction
        absolutePath="/workspace/project/source.ts"
        t={mockT}
        onOpenLibrary={onOpen}
      />,
    )
    expect(container.firstChild).toBeNull()
    rerender(
      <BibliographyAction
        absolutePath="/workspace/project/refs.bib"
        t={mockT}
        onOpenLibrary={onOpen}
      />,
    )
    const button = getByRole('button')
    expect(button.textContent).toBe(label)
    expect(button.title).toBe(label)
    expect(button.getAttribute('aria-label')).toBe(label)
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
