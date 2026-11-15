// @vitest-environment jsdom
/**
 * The panel's failure copy: a client-authored failure is stored as one stable
 * code and translated where it renders, and a message the panel did not author
 * is quoted inside one localized sentence. The reader never meets a bare
 * English paragraph in a Chinese panel, and never a locale key in either.
 * @module tests/client/library/library-errors
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LibraryFailure,
  laneFailureOf,
  laneTextOf,
} from '../../../src/client/components/library/library-errors.ts'
import { ListingPager } from '../../../src/client/components/library/ListingPager.tsx'
import { zh } from '../../../src/client/locales.ts'
import { mockT } from '../helpers/mock-translate.ts'

afterEach(cleanup)

describe('lane failures', () => {
  it('stores an authored failure as its code and a foreign one verbatim', () => {
    expect(laneFailureOf(new LibraryFailure('libraryErrorChanging'))).toBe('libraryErrorChanging')
    expect(laneFailureOf(new Error('the host said no'))).toBe('the host said no')
    expect(laneFailureOf('not an error')).toBe('not an error')
  })

  it('translates a code and quotes a foreign message', () => {
    expect(laneTextOf('libraryErrorChanging', mockT)).toBe(zh.libraryErrorChanging)
    expect(laneTextOf('the host said no', mockT)).toBe(
      zh.libraryErrorDetail.replace('{message}', 'the host said no'),
    )
  })

  it('renders a lane code in the reader language, with no ASCII sentence left over', () => {
    render(
      <ListingPager
        t={mockT}
        status={{ phase: 'error', message: 'libraryErrorPagination' }}
        retry={vi.fn()}
        errorVariant="lane"
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(`${zh.libraryErrorPagination}${zh.libraryRetry}`)
    // The guard the review asked for: the visible text is Chinese, not the
    // English sentence the code replaced.
    expect(alert.textContent).not.toMatch(/[A-Za-z]{4,}/)
  })

  it('quotes an unknown failure inside the localized wrapper', () => {
    render(
      <ListingPager
        t={mockT}
        status={{ phase: 'error', message: 'connection reset' }}
        retry={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      zh.libraryErrorDetail.replace('{message}', 'connection reset'),
    )
  })
})
