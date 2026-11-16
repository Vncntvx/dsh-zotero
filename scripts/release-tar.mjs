/** Read npm's regular-file tar format without extracting untrusted paths. */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

const decoder = new TextDecoder('utf-8', { fatal: true })
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
function text(bytes) {
  const end = bytes.indexOf(0)
  return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end))
}
function octal(bytes) {
  const value = text(bytes).trim()
  if (!/^[0-7]+$/.test(value)) throw new Error('Invalid tar integer')
  const number = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(number)) throw new Error('Tar integer exceeds safe range')
  return number
}
function pax(bytes) {
  const result = {}
  let offset = 0
  while (offset < bytes.length) {
    const separator = bytes.indexOf(32, offset)
    const rawLength = decoder.decode(bytes.subarray(offset, separator))
    if (separator < offset || !/^[1-9][0-9]*$/.test(rawLength))
      throw new Error('Invalid tar PAX record')
    const length = Number(rawLength)
    if (
      !Number.isSafeInteger(length) ||
      length <= separator - offset + 1 ||
      offset + length > bytes.length ||
      bytes[offset + length - 1] !== 10
    )
      throw new Error('Invalid tar PAX record length')
    const record = decoder.decode(bytes.subarray(separator + 1, offset + length - 1))
    const equals = record.indexOf('=')
    if (equals <= 0) throw new Error('Invalid tar PAX attribute')
    const key = record.slice(0, equals)
    if (key === 'linkpath' || Object.hasOwn(result, key))
      throw new Error('Unsafe tar PAX attribute')
    result[key] = record.slice(equals + 1)
    offset += length
  }
  return result
}

export function tarFileDigests(compressed) {
  const bytes = gunzipSync(compressed, { maxOutputLength: 512 * 1024 * 1024 })
  const files = {}
  let attributes = {}
  let offset = 0
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) {
      if (
        Object.keys(attributes).length ||
        bytes.length - offset < 1024 ||
        !bytes.subarray(offset).every((byte) => byte === 0)
      )
        throw new Error('Invalid tar terminator')
      return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')))
    }
    const checksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    )
    if (checksum !== octal(header.subarray(148, 156)))
      throw new Error('Tar header checksum mismatch')
    let size = octal(header.subarray(124, 136))
    const kind = header[156]
    if (attributes.size !== undefined) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(attributes.size)) throw new Error('Invalid tar PAX size')
      size = Number(attributes.size)
    }
    if (!Number.isSafeInteger(size) || size < 0 || size > bytes.length - offset - 512)
      throw new Error('Truncated tar entry')
    const body = bytes.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (kind === 120) {
      if (Object.keys(attributes).length) throw new Error('Stacked tar PAX records')
      attributes = pax(body)
      continue
    }
    const name = text(header.subarray(0, 100))
    const prefix = text(header.subarray(345, 500))
    const path = attributes.path ?? (prefix ? `${prefix}/${name}` : name)
    attributes = {}
    if (
      !path.startsWith('package/') ||
      path.includes('\\') ||
      path.includes('\0') ||
      path.split('/').some((part) => part === '.' || part === '..' || part === '')
    )
      throw new Error('Unsafe tar path')
    if (kind !== 0 && kind !== 48) throw new Error('Release tarball requires regular files')
    const relative = path.slice('package/'.length)
    if (Object.hasOwn(files, relative)) throw new Error('Duplicate tar path')
    files[relative] = digest(body)
  }
  throw new Error('Missing tar terminator')
}
