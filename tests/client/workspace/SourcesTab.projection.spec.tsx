// @vitest-environment jsdom
/**
 * The Sources panel consumes the host projection when it is present and keeps
 * the chat-window fold when it is absent (capability missing, baseline not yet
 * arrived, or a hot-loaded plugin).
 * @module tests/client/workspace/SourcesTab.projection
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SourcesTabProps } from '../../../src/client/components/SourcesTab.tsx'
import { SourcesTab } from '../../../src/client/components/SourcesTab.tsx'
import { sourceOf, workspaceOf } from '../helpers/source-fixtures.ts'
import { connectedProbe, sessionsOf, sessionOf } from '../helpers/sources-tab-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { zoteroClientStub } from '../helpers/zotero-client.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

afterEach(cleanup)

/** Mount the tab with a chosen projection value and no chat window. */
function mountWithProjection(projection: ReturnType<typeof workspaceOf> | undefined) {
  const props = {
    t: mockT,
    status: connectedProbe(),
    useSession: (sel: (snap: ReturnType<typeof sessionOf>) => unknown) => sel(sessionOf()),
    useSessions: (sel: (snapshot: ReturnType<typeof sessionsOf>) => unknown) => sel(sessionsOf()),
    useChat: () => undefined,
    useProjection: () => projection,
    useRemoteAccess: () => true,
    useAccess: () => true,
    useZoteroClient: () => zoteroClientStub(),
  } as unknown as SourcesTabProps
  return render(<SourcesTab {...props} />)
}

describe('the Sources panel projection path', () => {
  it('renders a projected source the chat window never loaded', async () => {
    const view = mountWithProjection(
      workspaceOf([sourceOf({ title: 'Projected paper', ref: 'zotero://user/0/item/PRJ1' })]),
    )
    expect((await screen.findAllByText('Projected paper')).length).toBeGreaterThan(0)
    view.unmount()
  })

  it('falls back to the chat window when the projection is absent', async () => {
    const view = mountWithProjection(undefined)
    expect(screen.getByText(mockT('noSources'))).toBeDefined()
    view.unmount()
  })
})
