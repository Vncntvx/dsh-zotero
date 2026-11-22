/** Execute the emitted Worker in the exact file layout shipped by npm. */
import { mkdtemp, readFile, readdir, symlink, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { zipSync } from 'fflate'

/**
 * Exercise the packed parsed-index worker from compiled JS alone: one put,
 * then one match against its SQLite FTS5 partition.
 * @param {string} packedRoot - unpacked package root holding lib/.
 * @param {string} staging - scratch directory for the synthetic index database.
 */
async function smokeParsedIndexWorker(packedRoot, staging) {
  const worker = new Worker(join(packedRoot, 'lib/enrichment/parsed-index-worker.js'), {
    execArgv: [],
    workerData: join(staging, 'index.db'),
  })
  try {
    const partition = '0'.repeat(128)
    const document = { artifactId: 'synthetic', sourceId: 'paper', generation: '1', digest: 'test' }
    /** @param {object} operation */
    const send = (operation) =>
      new Promise((resolve, reject) => {
        const onError = (/** @type {Error} */ error) => {
          worker.off('message', onMessage)
          reject(error)
        }
        const onMessage = (
          /** @type {{ok: boolean, message?: string, value?: unknown}} */ reply,
        ) => {
          worker.off('error', onError)
          if (reply.ok) resolve(reply.value)
          else reject(new Error(reply.message))
        }
        worker.once('error', onError).once('message', onMessage)
        worker.postMessage({ id: 1, operation })
      })
    await send({ kind: 'put', partition, document, markdown: '# Evidence\n\nAquifer recharge.' })
    const result = await send({
      kind: 'match',
      partition,
      allowed: [document],
      variants: [['aquifer']],
      limit: 1,
      isolate: true,
    })
    if (!Array.isArray(result) || result[0]?.artifactId !== document.artifactId)
      throw new Error('Packed parsed index Worker could not find the indexed document')
    console.log('parsed-index-worker pack smoke ok: emitted JS and FTS5 without a peer resolver')
  } finally {
    await worker.terminate()
  }
}

/** @param {string} root - the package root to pack and smoke. */
export async function smokeArchiveWorker(root) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const staging = await mkdtemp(join(tmpdir(), 'zotero-worker-pack-'))
  try {
    // `npm publish --dry-run` runs this gate with npm_config_dry_run set, and
    // the nested pack would then write no archive at all. The smoke needs a
    // real tarball to execute, so the child loses that one setting.
    const env = { ...process.env }
    delete env.npm_config_dry_run
    execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', staging], {
      cwd: root,
      stdio: 'pipe',
      env,
    })
    const archives = (await readdir(staging)).filter((name) => name.endsWith('.tgz'))
    if (archives.length !== 1) throw new Error('npm pack did not produce exactly one tarball')
    execFileSync('tar', ['-xzf', join(staging, archives[0]), '-C', staging])
    // The actual tarball supplies every plugin file. Only installed dependencies
    // resolve through the checkout; no source file or TypeScript loader is used.
    const packedRoot = join(staging, 'package')
    await smokeParsedIndexWorker(packedRoot, staging)
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
    const { openWorkerEmbedder } = await import(
      pathToFileURL(join(packedRoot, 'lib/enrichment/semantic/worker-embedder.js')).href
    )
    const { SEMANTIC_MODELS } = await import(
      pathToFileURL(join(packedRoot, 'lib/enrichment-model-catalog.js')).href
    )
    let refused = false
    try {
      await openWorkerEmbedder(SEMANTIC_MODELS[0], join(staging, 'absent-model-bundle'))
    } catch (error) {
      if (!(error instanceof Error) || !/not installed|missing|unusable/i.test(error.message))
        throw error
      refused = true
    }
    if (!refused) throw new Error('Packed semantic Worker accepted a missing model bundle')
    console.log(
      `semantic-worker pack smoke ok: ${manifest.name}, emitted JS verified a missing bundle without loading a model`,
    )
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await smokeArchiveWorker(resolve(new URL('..', import.meta.url).pathname))
