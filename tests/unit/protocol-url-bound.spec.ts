/** Protocol dispatch rejects oversized wire values before invoking any launcher. */
import { expect, it } from 'vitest'
import { zoteroProtocolUrlSchema } from '../../src/wire-schemas.js'
it('accepts the 2048-character wire ceiling and rejects the next character', () => {
  const prefix = 'zotero://'
  expect(zoteroProtocolUrlSchema.safeParse(prefix + 'a'.repeat(2048 - prefix.length)).success).toBe(
    true,
  )
  expect(zoteroProtocolUrlSchema.safeParse(prefix + 'a'.repeat(2049 - prefix.length)).success).toBe(
    false,
  )
})
