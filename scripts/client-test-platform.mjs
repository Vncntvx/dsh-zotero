/** Resolve loader-only browser entries to their published production source for jsdom. */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Node cannot import exports from a browser loader registration. The package's
 * types entry identifies its production source, and its explicit ./src/* export
 * authorizes this test-only resolution. Missing source is an installation error.
 * @param {string} [root] package root containing node_modules
 * @returns {{ find: RegExp; replacement: string }[]} exact client-entry aliases
 */
export function clientTestAliasesOf(root = repository) {
  const directory = join(root, 'node_modules/@deepseek-ai')
  return readdirSync(directory).flatMap((name) => {
    const packageRoot = join(directory, name)
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    const entry = manifest.exports?.['./client']
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.types !== 'string' ||
      typeof entry.default !== 'string'
    )
      return []
    if (
      !readFileSync(join(packageRoot, entry.default), 'utf8').includes(
        'window.__ModuleLoader__.load(',
      )
    )
      return []
    if (manifest.exports?.['./src/*'] !== './src/*' || !entry.types.startsWith('./lib/types/'))
      throw new Error(`${name}/client has no published production source contract`)
    const source = join(
      packageRoot,
      entry.types.replace('./lib/types/', './src/').replace(/\.d\.ts$/, '.ts'),
    )
    const resolved = existsSync(source) ? source : `${source}x`
    if (!existsSync(resolved))
      throw new Error(`Missing published production source for ${name}/client`)
    return [{ find: new RegExp(`^@deepseek-ai/${name}/client$`), replacement: resolved }]
  })
}
