/** Malicious metadata must not turn a truncated artifact into a successful parse. */
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { extractParsedFiles } from '../../src/enrichment/zip.js'

const text = new TextEncoder().encode('# Document\n' + 'real content '.repeat(200))
function archive(): { bytes: Uint8Array; view: DataView; central: number } {
  const bytes = zipSync({ 'full.md': text })
  const view = new DataView(bytes.buffer)
  let central = 0
  while (view.getUint32(central, true) !== 0x02014b50) central++
  return { bytes, view, central }
}

describe('ZIP entry integrity', () => {
  it.each([100, text.byteLength + 100])(
    'rejects false original length %i in both headers',
    (size) => {
      const { bytes, view, central } = archive()
      view.setUint32(22, size, true)
      view.setUint32(central + 24, size, true)
      expect(() => extractParsedFiles(bytes)).toThrow(/actual output.*declared size/)
    },
  )

  it('rejects a central header that disagrees with its local header', () => {
    const { bytes, view, central } = archive()
    view.setUint32(central + 24, 100, true)
    expect(() => extractParsedFiles(bytes)).toThrow(/local and central/)
  })

  it('rejects matching but false CRC values', () => {
    const { bytes, view, central } = archive()
    const forged = view.getUint32(14, true) ^ 1
    view.setUint32(14, forged, true)
    view.setUint32(central + 16, forged, true)
    expect(() => extractParsedFiles(bytes)).toThrow(/checksum mismatch/)
  })

  it('verifies referenced figure bytes with the same integrity proof', () => {
    const bytes = zipSync({
      'full.md': new TextEncoder().encode('# Image\n![](images/a.png)'),
      'images/a.png': text,
    })
    const view = new DataView(bytes.buffer)
    for (let at = 0; at + 46 < bytes.length; at++) {
      if (view.getUint32(at, true) !== 0x02014b50) continue
      const name = new TextDecoder().decode(
        bytes.subarray(at + 46, at + 46 + view.getUint16(at + 28, true)),
      )
      if (name !== 'images/a.png') continue
      view.setUint32(at + 24, 20, true)
      view.setUint32(view.getUint32(at + 42, true) + 22, 20, true)
      break
    }
    expect(() => extractParsedFiles(bytes)).toThrow(/figure could not be decompressed/)
  })
})
