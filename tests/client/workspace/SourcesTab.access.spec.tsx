// @vitest-environment jsdom
/**
 * The Sources panel gates only its wire-backed controls: a peer without access
 * sees one localized notice and issues no status or attachment request, while
 * the local trail stays readable.
 * @module tests/client/workspace/SourcesTab.access
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SourcesTabProps } from '../../../src/client/components/SourcesTab.tsx'
import { SourcesTab } from '../../../src/client/components/SourcesTab.tsx'
import { zh } from '../../../src/client/locales.ts'
import { sourceOf, workspaceOf } from '../helpers/source-fixtures.ts'
import { sessionsOf, sessionOf } from '../helpers/sources-tab-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { zoteroClientStub } from '../helpers/zotero-client.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

afterEach(cleanup)

describe('the Sources panel access gate', () => {
  it('skips the probe and explains the refusal while keeping the local trail', async () => {
    const status = vi.fn(async () => ({ ok: true, value: undefined }))
    const props = {
      t: mockT,
      status,
      useSession: (sel: (snap: ReturnType<typeof sessionOf>) => unknown) => sel(sessionOf()),
      useSessions: (sel: (snapshot: ReturnType<typeof sessionsOf>) => unknown) => sel(sessionsOf()),
      useChat: () => undefined,
      useProjection: () =>
        workspaceOf([sourceOf({ title: 'Local paper', ref: 'zotero://user/0/item/LOC1' })]),
      useRemoteAccess: () => false,
      useAccess: () => false,
      useZoteroClient: () => zoteroClientStub(),
    } as unknown as SourcesTabProps
    const view = render(<SourcesTab {...props} />)

    expect(await screen.findByText(zh.remoteAccessDenied)).toBeDefined()
    expect((await screen.findAllByText('Local paper')).length).toBeGreaterThan(0)
    expect(status).not.toHaveBeenCalled()
    view.unmount()
  })
})
