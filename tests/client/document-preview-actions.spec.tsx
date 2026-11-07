// @vitest-environment jsdom
/**
 * The document preview's open-library action: the bibliography guard, the
 * one accessible button, and the shared BibliographyAction underneath it.
 * Both document slots register this single component.
 * @module tests/client/document-preview-actions
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import {
  DocumentOpenLibraryAction,
  type DocumentOpenLibraryActionProps,
} from '../../src/client/components/document/DocumentOpenLibraryAction.tsx'
import { BibliographyAction } from '../../src/client/components/document/BibliographyAction.tsx'
import { mockT } from './helpers/mock-translate.ts'

// Stub primitives so icon and button imports do not load the full bundle.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('./helpers/primitives-stub.ts')
  return primitivesStub()
})

describe('Document preview actions', () => {
  afterEach(() => {
    cleanup()
  })
  const label = mockT('openInLibraryPanel')

  const renderAction = (absolutePath: string, onOpenLibrary?: () => void) =>
    render(
      <DocumentOpenLibraryAction
        {...({
          absolutePath,
          onOpenLibrary,
          t: mockT,
        } as unknown as DocumentOpenLibraryActionProps)}
      />,
    )

  it('returns null for a non-bibliography path', () => {
    const { container } = renderAction('/workspace/project/main.ts')
    expect(container.firstChild).toBeNull()
  })

  it('renders one accessible button that opens the library', () => {
    const onOpen = vi.fn()
    const { getByRole } = renderAction('/workspace/project/references.bib', onOpen)
    const button = getByRole('button')
    expect(button.textContent).toBe(label)
    expect(button.title).toBe(label)
    expect(button.getAttribute('aria-label')).toBe(label)
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('renders for a .ris suffix too', () => {
    const { getByRole } = renderAction('/workspace/project/citations.ris')
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
