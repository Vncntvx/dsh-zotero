/**
 * The ZoteroWorkspaceView specs' shared fixtures and mount: the connected
 * connection view the toolbar renders and `mountView`: the view mounted over a
 * fixture workspace with a spied refresh. The workspace fixture gallery itself
 * lives in `source-fixtures.ts`; `ZoteroWorkspaceView.helpers`, `.states` and
 * `.interaction` share this one copy of what sits on top of it.
 * @module tests/client/helpers/workspace-harness
 */

import { render } from '@testing-library/react'
import { vi } from 'vitest'
import type { SourceWorkspace } from '../../../src/sources/model.js'
import type { ConnectionView } from '../../../src/client/components/workspace/connection.ts'
import { ZoteroWorkspaceView } from '../../../src/client/components/workspace/ZoteroWorkspaceView.tsx'
import { mockT } from './mock-translate.ts'
import { statusView } from '../../helpers/status-view.ts'

/** The healthy probe, with the answering build named. */
export const CONNECTED: ConnectionView = {
  kind: 'connected',
  data: statusView({
    apiVersion: '3',
    schemaVersion: '37',
    serverId: 'sPMHtLD6HHBd',
    zoteroVersion: '10.0.2-beta.9+c77df79af',
    diagnosis: 'ok',
  }),
  checkedAt: '10:00:00',
}

/** Render the view over a fixture workspace; `onRefresh` is asserted by the toolbar test. */
export function mountView(
  workspace: SourceWorkspace,
  connection: ConnectionView = CONNECTED,
  setDraft: ((text: string) => void) | undefined = undefined,
): { view: ReturnType<typeof render>; onRefresh: ReturnType<typeof vi.fn> } {
  const onRefresh = vi.fn()
  const view = render(
    <ZoteroWorkspaceView
      workspace={workspace}
      connection={connection}
      setDraft={setDraft}
      onRefresh={onRefresh}
      t={mockT}
    />,
  )
  return { view, onRefresh }
}
