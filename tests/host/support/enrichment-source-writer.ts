/** Child-process fixture: real store, real filesystem and public cross-process lock. */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import {
  ParsedArtifactStore,
  type ArtifactStoreDeps,
  type SourceIndexRecord,
} from '../../../src/enrichment/artifact-store.ts'

const [root, key, body, hold] = process.argv.slice(2)
if (root === undefined || key === undefined || body === undefined)
  throw new Error('Missing source-writer fixture arguments')
const record: SourceIndexRecord = JSON.parse(body)
let release: () => void = () => {}
const released = new Promise<void>((resolve) => {
  release = resolve
})
process.on('message', (message: unknown) => {
  if (message === 'release') release()
})
const deps: ArtifactStoreDeps = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  readFile,
  writeFile: async (path, data) => {
    await writeFile(path, data, { mode: 0o600 })
  },
  rename,
  rm,
  withSourceLock: async (path, operation, options) => {
    process.send?.('requesting')
    return await withFileLock(
      path,
      async () => {
        process.send?.('acquired')
        if (hold === 'hold') await released
        return await operation()
      },
      options,
    )
  },
}
try {
  await new ParsedArtifactStore(root, deps).putSource(key, record)
  process.send?.('committed')
} catch (error) {
  process.stderr.write(String(error))
  process.exitCode = 1
} finally {
  process.disconnect?.()
}
