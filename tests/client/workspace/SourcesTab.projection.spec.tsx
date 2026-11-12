// @vitest-environment jsdom
/**
 * The Sources panel consumes the host projection when it is present and keeps
 * the chat-window fold only when host status says the registry is not
 * composed; absence while registration is pending is not a fallback.
 * @module tests/client/workspace/SourcesTab.projection
 */

import { act, cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sourceOf, workspaceOf } from '../helpers/source-fixtures.ts'
import { connectedProbe, mountTab, sessionOf, sessionsOf } from '../helpers/sources-tab-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { statusView } from '../../helpers/status-view.ts'

afterEach(cleanup)

describe('the Sources panel projection path', () => {
  it('keeps rendering a projected source after the ready probe settles', async () => {
    // The ready state must be asserted after the probe settles, not on the
    // first frame: a pre-settle assertion would pass on a transient render
    // and prove nothing about the composed path this file owns.
    const status = vi.fn(async () => ({
      ok: true as const,
      value: statusView({ sourceProjection: { state: 'ready' } }),
    }))
    const { view } = mountTab(
      undefined,
      status,
      undefined,
      sessionOf(),
      undefined,
      sessionsOf(),
      workspaceOf([sourceOf({ title: 'Projected paper', ref: 'zotero://user/0/item/PRJ1' })]),
    )
    await act(async () => {})
    // The title renders in the workspace row and the inspector alike, so the
    // assertion is on any occurrence existing after the probe has settled.
    expect(screen.getAllByText('Projected paper').length).toBeGreaterThan(0)
    view.unmount()
  })

  it('folds the loaded chat window once the registry is not composed', async () => {
    const { view } = mountTab(undefined, connectedProbe())
    expect(await screen.findByText(mockT('noSources'))).toBeDefined()
    view.unmount()
  })
})
