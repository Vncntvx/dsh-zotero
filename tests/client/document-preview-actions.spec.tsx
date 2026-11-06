// @vitest-environment jsdom
/**
 * Tests for document preview header action and unpreviewable empty-state action.
 * @module tests/client/document-preview-actions
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import {
  DocumentZoteroAction,
  type DocumentZoteroActionProps,
} from '../../src/client/components/document/DocumentZoteroAction.tsx'
import {
  DocumentUnpreviewableAction,
  type DocumentUnpreviewableActionProps,
} from '../../src/client/components/document/DocumentUnpreviewableAction.tsx'
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

  describe('DocumentZoteroAction', () => {
    it('returns null for non-bibliography paths', () => {
      const props = {
        absolutePath: '/workspace/project/main.ts',
        t: mockT,
      } as unknown as DocumentZoteroActionProps
      const { container } = render(<DocumentZoteroAction {...props} />)
      expect(container.firstChild).toBeNull()
    })

    it('renders the same accessible name and visible label for bibliography paths', () => {
      const onOpen = vi.fn()
      const props = {
        absolutePath: '/workspace/project/references.bib',
        onOpenLibrary: onOpen,
        t: mockT,
      } as unknown as DocumentZoteroActionProps
      const { getByRole, rerender } = render(<DocumentZoteroAction {...props} />)

      const button = getByRole('button')
      expect(button.textContent).toBe(label)
      expect(button.title).toBe(label)
      expect(button.getAttribute('aria-label')).toBe(label)

      fireEvent.click(button)
      expect(onOpen).toHaveBeenCalledTimes(1)

      rerender(
        <DocumentZoteroAction
          {...({
            absolutePath: '/workspace/project/citations.ris',
            onOpenLibrary: onOpen,
            t: mockT,
          } as unknown as DocumentZoteroActionProps)}
        />,
      )
      expect(getByRole('button').textContent).toBe(label)
    })
  })

  describe('DocumentUnpreviewableAction', () => {
    it('returns null for non-bibliography paths', () => {
      const props = {
        absolutePath: '/workspace/project/binary.dat',
        t: mockT,
      } as unknown as DocumentUnpreviewableActionProps
      const { container } = render(<DocumentUnpreviewableAction {...props} />)
      expect(container.firstChild).toBeNull()
    })

    it('renders the same accessible name and visible label and triggers the callback', () => {
      const onOpen = vi.fn()
      const props = {
        absolutePath: '/workspace/project/refs.bib',
        onOpenLibrary: onOpen,
        t: mockT,
      } as unknown as DocumentUnpreviewableActionProps
      const { getByRole } = render(<DocumentUnpreviewableAction {...props} />)

      const button = getByRole('button')
      expect(button.textContent).toBe(label)
      expect(button.title).toBe(label)
      expect(button.getAttribute('aria-label')).toBe(label)
      fireEvent.click(button)
      expect(onOpen).toHaveBeenCalledTimes(1)
    })
  })
})
