// @vitest-environment jsdom
/** A stored acknowledgement applies to one host mount, including off/on cycles missed by the browser. */
import { afterEach, expect, it } from 'vitest'
import {
  clientAcknowledgement,
  EnableNoticeArbiter,
  EnableNoticeController,
  withEnableEpoch,
} from '../../src/client/enable-notice.ts'
import { namespaceStatusSourceOf } from './helpers/namespace-status-source.ts'
import { deferred, snapshotWhen } from '../helpers/sync.ts'

afterEach(() => localStorage.clear())

it('reopens the notice when the browser returns to a different enable epoch', async () => {
  localStorage.setItem('epoch-notice', 'old-host-enable')
  const base = namespaceStatusSourceOf('ready')
  const source = withEnableEpoch(base, async () => 'new-host-enable')
  const controller = new EnableNoticeController(
    source,
    'scholarlyEnableNotice',
    clientAcknowledgement('epoch-notice'),
    new EnableNoticeArbiter(),
  )
  try {
    await snapshotWhen(source, (value) => value.namespaceStatus === 'ready')
    const open = () => controller.inject().hooks.scholarlyEnableNotice.getSnapshot().open
    expect(open()).toBe(true)
    controller.dismiss()
    expect(open()).toBe(false)
    expect(localStorage.getItem('epoch-notice')).toBe('new-host-enable')
    expect(clientAcknowledgement('epoch-notice').read('old-host-enable')).toBe(false)
    expect(clientAcknowledgement('epoch-notice').read('new-host-enable')).toBe(true)
  } finally {
    controller.dispose()
    source.dispose()
  }
})

it('drops a late epoch after disable and still discloses when the host read fails', async () => {
  const pending = deferred<string | undefined>()
  const base = namespaceStatusSourceOf('ready')
  let read = () => pending.promise
  const source = withEnableEpoch(base, () => read())
  const controller = new EnableNoticeController(
    source,
    'enrichmentEnableNotice',
    clientAcknowledgement('epoch-failure'),
    new EnableNoticeArbiter(),
  )
  try {
    base.publish('unavailable')
    pending.resolve('stale-enable')
    await pending.promise
    expect(source.getSnapshot().namespaceStatus).toBe('unavailable')
    read = async () => {
      throw new Error('status disconnected')
    }
    base.publish('ready')
    await snapshotWhen(source, (value) => value.namespaceStatus === 'ready')
    expect(controller.inject().hooks.enrichmentEnableNotice.getSnapshot().open).toBe(true)
    controller.dismiss()
    expect(localStorage.getItem('epoch-failure')).toBeNull()
    expect(clientAcknowledgement('epoch-failure').read()).toBe(false)
  } finally {
    controller.dispose()
    source.dispose()
  }
})

it('does not publish an epoch response after its source is disposed', async () => {
  const pending = deferred<string | undefined>()
  const source = withEnableEpoch(namespaceStatusSourceOf('ready'), () => pending.promise)
  source.dispose()
  pending.resolve('late')
  await pending.promise
  expect(source.getSnapshot()).toEqual({ namespaceStatus: 'loading' })
})
