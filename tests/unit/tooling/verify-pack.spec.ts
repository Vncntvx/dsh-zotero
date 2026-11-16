/**
 * The pack gate's pure helpers. `npm pack --json` stdout is not always pure
 * JSON: a version-pinned npm runs `prepare` even under `--ignore-scripts` and
 * prints its output first, which used to fail `JSON.parse` on the whole
 * stream. The locator keeps the gate green on either kind of npm. The path
 * resolver enumerates wildcard exports from disk instead of restating them,
 * and fails loud when a declared pattern has nothing behind it, so the gate
 * can never narrow itself to "assert only what exists".
 * @module tests/unit/verify-pack
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  expectedPaths,
  installScriptsInRuntimeClosure,
  packReportOf,
  packReportProblems,
} from '../../../scripts/verify-pack.mjs'
import { withTempDir } from '../../helpers/temp-dir.ts'

const REPORT = '[\n  {\n    "name": "dsh-zotero"\n  }\n]'

/** The real manifest's locale shape, read from the repository root. */
const MANIFEST = {
  main: './lib/index.js',
  exports: { '.': './lib/index.js', './locale/*.json': './locale/*.json' },
  files: ['lib', 'locale'],
}

describe('packReportOf', () => {
  it('parses a stream that is already the report', () => {
    expect(JSON.parse(packReportOf(REPORT))).toEqual([{ name: 'dsh-zotero' }])
  })

  it('drops the lifecycle script output npm prints ahead of the report', () => {
    const polluted = `prepare skipped: a full build is already present (127 outputs)\n${REPORT}`
    expect(JSON.parse(packReportOf(polluted))).toEqual([{ name: 'dsh-zotero' }])
  })

  it('accepts the name-keyed object npm answers on newer versions', () => {
    const objectShape = `transpiled 63 Node-half module(s) into lib/\n{"dsh-zotero": {"files": []}}\n`
    expect(JSON.parse(packReportOf(objectShape))).toEqual({ 'dsh-zotero': { files: [] } })
  })

  it('refuses a stream with no report at all instead of enrichment prose', () => {
    expect(() => packReportOf('prepare failed\n')).toThrow(/printed no JSON report/)
    expect(() => packReportOf('')).toThrow(/printed no JSON report/)
  })
})

describe('expectedPaths', () => {
  it('enumerates the locale bundles the repository actually ships', () => {
    const { paths, problems } = expectedPaths(MANIFEST)
    expect(problems).toEqual([])
    expect(paths).toContain('locale/en.json')
    expect(paths).toContain('locale/zh.json')
    expect(paths).toContain('lib/index.js')
  })

  it('enumerates both root and subpath locale bundles from disk', () => {
    const subpathManifest = {
      ...MANIFEST,
      exports: {
        ...MANIFEST.exports,
        './scholarly/locale/*.json': './locale/scholarly/*.json',
      },
    }
    const { paths, problems } = expectedPaths(subpathManifest)
    expect(problems).toEqual([])
    expect(paths).toContain('locale/en.json')
    expect(paths).toContain('locale/zh.json')
    expect(paths).toContain('locale/scholarly/en.json')
    expect(paths).toContain('locale/scholarly/zh.json')
  })

  it('reports a declared locale wildcard with an empty directory on disk', async () => {
    // An empty `locale/`: the manifest still promises the dictionaries, so
    // the gate must fail instead of asserting nothing.
    await withTempDir(async (root) => {
      await mkdir(join(root, 'lib'), { recursive: true })
      await mkdir(join(root, 'locale'), { recursive: true })
      const { paths, problems } = expectedPaths(MANIFEST, root)
      expect(paths).not.toContain('locale/en.json')
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('declares the locale export "./locale/*.json"')
      expect(problems[0]).toContain('carries no *.json bundle')
    })
  })

  it('reports a subpath locale wildcard with an empty directory on disk', async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, 'lib'), { recursive: true })
      await mkdir(join(root, 'locale', 'scholarly'), { recursive: true })
      const manifest = {
        main: './lib/index.js',
        exports: { './scholarly/locale/*.json': './locale/scholarly/*.json' },
        files: ['lib', 'locale'],
      }
      const { paths, problems } = expectedPaths(manifest, root)
      expect(paths).not.toContain('locale/scholarly/en.json')
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('declares the locale export "./scholarly/locale/*.json"')
      expect(problems[0]).toContain('locale/scholarly carries no *.json bundle')
    })
  })

  it('reports a non-locale wildcard export whose directory is gone', async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, 'README.md'), 'x', 'utf8')
      const manifest = { files: ['README.md'], exports: { './styles/*.css': './styles/*.css' } }
      const { problems } = expectedPaths(manifest, root)
      expect(problems).toEqual([
        'the manifest declares the wildcard export "./styles/*.css" but ./styles does not exist' +
          ' on disk — the tarball would ship an export that resolves to nothing',
      ])
    })
  })

  it('reports a files entry that the disk never had', async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, 'README.md'), 'x', 'utf8')
      const manifest = { files: ['README.md', 'nodir'] }
      const { problems } = expectedPaths(manifest, root)
      expect(problems).toEqual(['the manifest "files" entry "nodir" does not exist on disk'])
    })
  })

  it('leaves a manifest with no locale wildcard alone', () => {
    const { paths, problems } = expectedPaths({ main: './lib/index.js' }, '/nonexistent-root')
    expect(problems).toEqual([])
    expect(paths).toEqual(['README.md', 'lib/index.js', 'package.json'])
  })

  it('includes non-directory entries from manifest.files such as README.en.md', async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, 'lib'), { recursive: true })
      await mkdir(join(root, 'locale'), { recursive: true })
      await writeFile(join(root, 'lib', 'index.js'), 'x', 'utf8')
      await writeFile(join(root, 'README.md'), 'x', 'utf8')
      await writeFile(join(root, 'README.en.md'), 'x', 'utf8')
      await writeFile(join(root, 'cordis.patch.yml'), 'x', 'utf8')
      const manifest = {
        main: './lib/index.js',
        files: ['lib', 'README.md', 'README.en.md', 'cordis.patch.yml', 'locale'],
      }
      const { paths, problems } = expectedPaths(manifest, root)
      expect(problems).toEqual([])
      expect(paths).toContain('README.en.md')
      expect(paths).toContain('cordis.patch.yml')
      expect(paths).toContain('README.md')
      expect(paths).toContain('package.json')
      expect(paths).toContain('lib/index.js')
      expect(paths).not.toContain('lib')
      expect(paths).not.toContain('locale')
    })
  })
})

describe('installScriptsInRuntimeClosure', () => {
  it('names every closure package that declares an install script', () => {
    const lock = {
      packages: {
        '': {},
        'node_modules/a': { version: '1.0.0', dependencies: { b: '^2' } },
        'node_modules/b': { version: '2.0.0', hasInstallScript: true },
        'node_modules/outside': { version: '3.0.0', hasInstallScript: true },
      },
    }
    expect(installScriptsInRuntimeClosure({ dependencies: { a: '^1' } }, lock)).toEqual(['b@2.0.0'])
  })

  it('walks nested install paths and optional dependencies', () => {
    const lock = {
      packages: {
        '': {},
        'node_modules/a': { version: '1.0.0', dependencies: { b: '2.0.0' } },
        'node_modules/a/node_modules/b': {
          version: '2.0.0',
          optionalDependencies: { c: '^3' },
        },
        'node_modules/a/node_modules/c': { version: '3.0.0', hasInstallScript: true },
        'node_modules/c': { version: '3.0.0' },
      },
    }
    expect(installScriptsInRuntimeClosure({ dependencies: { a: '^1' } }, lock)).toEqual(['c@3.0.0'])
  })

  it('answers nothing for a manifest without runtime dependencies', () => {
    const lock = { packages: { 'node_modules/dev': { version: '1.0.0', hasInstallScript: true } } }
    expect(installScriptsInRuntimeClosure({ devDependencies: { dev: '^1' } }, lock)).toEqual([])
  })

  it('refuses a required dependency the lockfile cannot resolve', () => {
    expect(() =>
      installScriptsInRuntimeClosure({ dependencies: { ghost: '^1' } }, { packages: {} }),
    ).toThrow('missing from the lockfile')
  })

  it('walks root optional dependencies and required peer edges at every level', () => {
    const lock = {
      packages: {
        'node_modules/root-peer': { version: '1.0.0', hasInstallScript: true },
        'node_modules/optional': { version: '1.0.0', peerDependencies: { 'nested-peer': '^1' } },
        'node_modules/nested-peer': { version: '1.0.0', hasInstallScript: true },
      },
    }
    expect(
      installScriptsInRuntimeClosure(
        {
          optionalDependencies: { optional: '^1', absent: '^1' },
          peerDependencies: { 'root-peer': '^1', 'optional-peer': '^1' },
          peerDependenciesMeta: { 'optional-peer': { optional: true } },
        },
        lock,
      ),
    ).toEqual(['nested-peer@1.0.0', 'root-peer@1.0.0'])
  })
})

describe('the complete packed file set', () => {
  const manifest = { name: 'dsh-zotero', version: '1.0.0' }
  const entry = { ...manifest, size: 100, unpackedSize: 200, files: [{ path: 'package.json' }] }
  it('accepts only the exact package identity and expected files within the size limits', () => {
    expect(packReportProblems(entry, manifest, ['package.json'])).toEqual([])
    expect(packReportProblems({ ...entry, name: 'other' }, manifest, ['package.json'])).toContain(
      'Packed name or version differs from the checked manifest',
    )
    expect(
      packReportProblems({ ...entry, size: 40 * 1024 * 1024 + 1 }, manifest, ['package.json']),
    ).toContain('Packed size must be within 40 MiB')
    expect(
      packReportProblems({ ...entry, unpackedSize: 200 * 1024 * 1024 + 1 }, manifest, [
        'package.json',
      ]),
    ).toContain('Unpacked size must be within 200 MiB')
    expect(
      packReportProblems(
        { ...entry, files: [...entry.files, { path: 'lib/old-module.js' }] },
        manifest,
        ['package.json'],
      ),
    ).toContain('Unexpected packed file: lib/old-module.js')
    expect(packReportProblems(entry, manifest, ['package.json', 'lib/index.js'])).toContain(
      'Missing packed file: lib/index.js',
    )
  })
})
