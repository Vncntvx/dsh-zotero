// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'

it('creates and disposes the public production slot runtime', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    expect(runtime.ctx.get('slots')).toBeDefined()
  } finally {
    await runtime.dispose()
  }
})
