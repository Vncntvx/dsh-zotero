/** Browser setup must leave the Node lanes' native missing APIs observable. */
import { expect, it } from 'vitest'

it('keeps DOM and browser-only shims out of the Node environment', () => {
  expect('window' in globalThis).toBe(false)
  expect('ResizeObserver' in globalThis).toBe(false)
  expect('clipboard' in navigator).toBe(false)
})
