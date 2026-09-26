// @vitest-environment jsdom
/**
 * Tests for shared DiagnosisBox component.
 * @module tests/client/DiagnosisBox
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DiagnosisBox } from '../../src/client/components/DiagnosisBox.tsx'
import { zh } from '../../src/client/locales.ts'
import { mockT } from './helpers/mock-translate.ts'

afterEach(() => {
  cleanup()
})

describe('DiagnosisBox', () => {
  it('renders raw code and formatted diagnosis message', () => {
    const { container } = render(
      <DiagnosisBox diagnosis="ZOTERO_NOT_RUNNING: Could not connect to Zotero" t={mockT} />,
    )

    expect(screen.getByText(`${zh.diagnosisLabel}:`)).toBeTruthy()
    expect(screen.getByText('ZOTERO_NOT_RUNNING')).toBeTruthy()
    expect(screen.getByText(zh.diagnosisNotRunning)).toBeTruthy()
    expect(container.querySelector('[data-zotero-diagnosis-box]')).toBeTruthy()
  })

  it('renders without raw code when diagnosis text has no recognized prefix', () => {
    const { container } = render(<DiagnosisBox diagnosis="Generic failure string" t={mockT} />)

    expect(screen.getByText(`${zh.diagnosisLabel}:`)).toBeTruthy()
    expect(screen.getByText('Generic failure string')).toBeTruthy()
    expect(container.querySelector('code')).toBeNull()
  })
})
