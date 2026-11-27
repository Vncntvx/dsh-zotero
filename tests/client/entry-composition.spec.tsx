// @vitest-environment jsdom
/** The browser entry mounts under the production bootClient, Cordis and SlotRegistry. */
import type { Context } from '@deepseek-ai/cordis'
import { ClientRoster } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/roster.ts'
import { TestClient } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/test-client.ts'
import { remoteDefaultResponses } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/remote-default-responses.ts'
import { RemoteMock, ok } from '@deepseek-ai/dsh-remote-mock'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { expect, it } from 'vitest'
import * as feature from '../../src/client/index.ts'
import { fakeWorld } from './helpers/apply-world.ts'

it('boots the actual entry and withdraws its registered surfaces on unload', async () => {
  const ports = fakeWorld()
  const services = ports.ctx as Context
  const mock = RemoteMock.create()
  mock.load(remoteDefaultResponses)
  const roster = ClientRoster.of([
    { name: '@deepseek-ai/dsh-client-modules', inject: ['loader'], immediately: true },
    { name: '@deepseek-ai/dsh-client-connection', inject: [], immediately: true },
    { name: '@deepseek-ai/dsh-api-remote-access', inject: [], immediately: true },
    { name: '@deepseek-ai/dsh-typert-registry', inject: [], immediately: true },
    { name: '@deepseek-ai/dsh-api-gateway', inject: ['typert', 'connection'], immediately: true },
    {
      name: '@deepseek-ai/dsh-api-session-controller',
      inject: ['remote', 'connection'],
      immediately: true,
    },
    {
      name: '@deepseek-ai/dsh-client-ui-session',
      inject: ['slots', 'sessions'],
      immediately: true,
    },
    { name: '@deepseek-ai/dsh-client-ui-renderer', inject: [], immediately: true },
    { name: 'zotero-test-upload', inject: [], immediately: true },
    { name: 'zotero-test-ports', inject: ['slots'], immediately: true },
    {
      name: '@deepseek-ai/dsh-client-ui-context-menu',
      inject: ['slots', 'locale', 'shortcuts'],
      immediately: false,
    },
    { name: 'dsh-zotero', inject: [...feature.inject], immediately: false },
  ])
  const client = await TestClient.start(
    {
      roster,
      provide: {
        'dsh-zotero': feature,
        'zotero-test-upload': {
          apply(ctx: Context) {
            ctx.provide('fileUpload', {
              upload: async () => {
                throw new Error('Unexpected upload')
              },
              uploadImage: async () => {
                throw new Error('Unexpected image upload')
              },
            } as never)
          },
        },
        'zotero-test-ports': {
          inject: ['slots'],
          apply: (ctx: Context) => {
            mock.unary('zotero/status', async () =>
              ok({ providerId: 'local', sourceProjection: { state: 'ready' }, connected: true }),
            )
            mock.unary('zotero/semanticModelStatus', async () =>
              ok({
                model: 'balanced',
                ready: false,
                downloading: false,
                path: '',
                downloadedBytes: 0,
                totalBytes: 0,
                percent: 0,
              }),
            )

            for (const name of [
              'configForms',
              'sidebarRight',
              'sidebarRightTabs',
              'resources',
              'jobs',
            ] as const)
              ctx.provide(name, services[name] as never)
            ctx.provide('locale', services.locale)
            ctx.provide('shortcuts', { catalog: createSnapshotStore([]) } as never)
            ctx.slots.installLocale({
              ...createSnapshotStore({ revision: 0 }),
              bind: services.locale.bind,
            })
            ctx.slots.register(
              {
                name: 'root',
                children: {
                  'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
                  'plugins.bundle.activation': { kind: 'keyed', scope: 'root' },
                  'plugins.detail.section': { kind: 'list', scope: 'root' },
                  'plugins.row.config': { kind: 'keyed', scope: 'root' },
                  'shell.overlay': { kind: 'list', scope: 'root' },
                },
              },
              (props: PropsRenderSlots<'plugins.bundle.config' | 'shell.overlay'>) => (
                <>
                  {props.renderSlot(
                    'plugins.bundle.config',
                    { view: 'page' },
                    { entryKey: 'dsh-zotero' },
                  )}
                  {props.renderSlot('shell.overlay', {})}
                </>
              ),
            )
          },
        },
      },
    },
    mock,
    { mount: true },
  )
  try {
    expect(client.ctx.slots.entries('plugins.bundle.config').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('tab')).toHaveLength(5)
    fireEvent.click(screen.getByRole('tab', { name: 'tabEnrichment' }))
    const language = screen.getByLabelText('enrichmentOcrLanguage')
    expect(language).toHaveProperty('value', 'ch')
    fireEvent.change(language, { target: { value: 'en' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() =>
      expect(ports.enrichmentScope.writes).toContainEqual({
        op: 'set',
        field: 'ocrLanguage',
        value: 'en',
      }),
    )
    const count = client.ctx.slots.entries('plugins.bundle.config').length
    await act(async () => client.reload('dsh-zotero'))
    expect(client.ctx.slots.entries('plugins.bundle.config')).toHaveLength(count)
    expect(client.ctx.contextMenus.registeredKinds.getSnapshot()).toContain('file')
    await client.unload('dsh-zotero')
    expect(client.ctx.slots.entries('plugins.bundle.config')).toEqual([])
    expect(client.ctx.get('remote.zotero')).toBeUndefined()
  } finally {
    await client.dispose()
  }
})
