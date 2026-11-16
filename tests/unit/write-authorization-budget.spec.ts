/** User-driven authorization waits for the rolling window and remains cancellable. */
import { expect, it, vi } from 'vitest'
import { WriteAuthorizationBudget } from '../../src/write-authorization-budget.js'
import { deferred } from '../helpers/sync.js'

it('admits five prompts and waits for the oldest prompt to leave the rolling window', async () => {
  let now = 0
  const pause = vi.fn(async (milliseconds: number) => {
    now += milliseconds
  })
  const budget = new WriteAuthorizationBudget(() => now, pause)
  for (let index = 0; index < 5; index++) {
    await budget.reserve()
    now += 1000
  }
  await budget.reserve()
  expect(pause).toHaveBeenCalledWith(55_000, undefined)
  expect(now).toBe(60_000)
})

it('cancels a waiting prompt without consuming a future reservation', async () => {
  let now = 0
  const entered = deferred<void>()
  const controller = new AbortController()
  const budget = new WriteAuthorizationBudget(
    () => now,
    async (_milliseconds, signal) => {
      entered.resolve()
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
      )
    },
  )
  for (let index = 0; index < 5; index++) await budget.reserve()
  const waiting = budget.reserve(controller.signal)
  await entered.promise
  controller.abort(new Error('cancelled prompt'))
  await expect(waiting).rejects.toThrow('cancelled prompt')
  now = 60_000
  await expect(budget.reserve()).resolves.toBeUndefined()
})

it('rejects an already cancelled request before reserving a prompt', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled prompt'))
  const budget = new WriteAuthorizationBudget()
  await expect(budget.reserve(controller.signal)).rejects.toThrow('cancelled prompt')
})

it('cancels the native foreground timer at a full rolling window', async () => {
  const budget = new WriteAuthorizationBudget(() => 0)
  for (let index = 0; index < 5; index++) await budget.reserve()
  const controller = new AbortController()
  const waiting = budget.reserve(controller.signal)
  controller.abort()
  await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
})
