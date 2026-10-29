// @vitest-environment jsdom
/**
 * Zotero library icon component test suite.
 * @module tests/client/library/ZoteroLibraryIcon
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ZoteroLibraryIcon } from '../../../src/client/components/library/ZoteroLibraryIcon.tsx'

afterEach(() => {
  cleanup()
})

describe('ZoteroLibraryIcon', () => {
  it('renders default size 36 when size is omitted', () => {
    const { container } = render(<ZoteroLibraryIcon />)
    const svg = container.querySelector('svg')
    expect(svg).toBeDefined()
    expect(svg?.getAttribute('width')).toBe('36')
    expect(svg?.getAttribute('height')).toBe('36')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders custom size and className when provided', () => {
    const { container } = render(<ZoteroLibraryIcon size={16} className="custom-icon" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeDefined()
    expect(svg?.getAttribute('width')).toBe('16')
    expect(svg?.getAttribute('height')).toBe('16')
    expect(svg?.getAttribute('class')).toContain('custom-icon')
  })
})
