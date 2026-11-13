/** Execute the emitted Worker in the exact file layout shipped by npm. */
import { mkdtemp, readFile, readdir, symlink, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { zipSync } from 'fflate'

export async function smokeArchiveWorker(root) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const staging = await mkdtemp(join(tmpdir(), 'zotero-worker-pack-'))
  try {
    execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', staging], {
      cwd: root,
      stdio: 'pipe',
    })
    const archives = (await readdir(staging)).filter((name) => name.endsWith('.tgz'))
    if (archives.length !== 1) throw new Error('npm pack did not produce exactly one tarball')
    execFileSync('tar', ['-xzf', join(staging, archives[0]), '-C', staging])
    // The actual tarball supplies every plugin file. Only installed dependencies
    // resolve through the checkout; no source file or TypeScript loader is used.
    const packedRoot = join(staging, 'package')
    await symlink(join(root, 'node_modules'), join(packedRoot, 'node_modules'), 'dir')
    const { ArchiveProcessor } = await import(
      pathToFileURL(join(packedRoot, 'lib/enrichment/archive-worker.js')).href
    )
    const encoder = new TextEncoder()
    const processor = new ArchiveProcessor()
    const signal = new AbortController().signal
    const result = await processor.run(signal, async () =>
      processor.extract(
        zipSync({
          'full.md': encoder.encode('# Packed Worker\n\n![figure](images/figure.png)'),
          'images/figure.png': new Uint8Array([137, 80, 78, 71]),
          'images/unused.png': new Uint8Array([1, 2, 3]),
        }),
        signal,
      ),
    )
    if (
      result.markdown.indexOf('# Packed Worker') !== 0 ||
      result.images.length !== 1 ||
      result.images[0].name !== 'images/figure.png'
    )
      throw new Error('Packed archive Worker returned an unexpected document')
    console.log(`archive-worker pack smoke ok: ${manifest.name}, emitted JS entry executed`)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await smokeArchiveWorker(resolve(new URL('..', import.meta.url).pathname))
