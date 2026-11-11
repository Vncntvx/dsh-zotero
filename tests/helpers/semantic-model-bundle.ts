/** Synthetic, tiny model assets shared by host-manager and CLI installer tests. */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SemanticModelEntry } from '../../src/enrichment-model-catalog.ts'
import type { DownloadClientDeps, FetchLike } from '../../src/enrichment/model-download-client.ts'

export const modelBytes: Readonly<Record<string, Buffer>> = {
  'config.json': Buffer.from('alpha'),
  'onnx/model_quantized.onnx': Buffer.from('beta!'),
}

export const tinyModel: SemanticModelEntry = {
  key: 'balanced',
  physicalKey: 'wp4-tiny',
  label: 'Synthetic installer fixture',
  physicalModel: 'Synthetic installer fixture',
  note: 'Synthetic bytes; no inference or external model download.',
  modelId: 'test/wp4-tiny',
  revision: 'b'.repeat(40),
  dimension: 2,
  maxTokens: 16,
  languages: ['*'],
  license: 'MIT',
  pooling: 'mean',
  normalize: true,
  queryPrefix: '',
  documentPrefix: '',
  files: Object.entries(modelBytes).map(([path, bytes]) => ({
    path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })),
}

/** Independently specified schema-2 commit marker for the synthetic bundle. */
export function tinyManifest() {
  return {
    schema: 2,
    key: tinyModel.key,
    physicalKey: tinyModel.physicalKey,
    modelId: tinyModel.modelId,
    revision: tinyModel.revision,
    dimension: tinyModel.dimension,
    maxTokens: tinyModel.maxTokens,
    pooling: tinyModel.pooling,
    normalize: tinyModel.normalize,
    queryPrefix: tinyModel.queryPrefix,
    documentPrefix: tinyModel.documentPrefix,
    files: Object.fromEntries(tinyModel.files.map(({ path, ...entry }) => [path, entry])),
  }
}

export async function writeTinyBundle(
  root: string,
  marker: unknown = tinyManifest(),
): Promise<string> {
  const dir = join(root, tinyModel.physicalKey)
  for (const [path, bytes] of Object.entries(modelBytes)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), bytes)
  }
  if (marker !== undefined) await writeFile(join(dir, 'manifest.json'), JSON.stringify(marker))
  return dir
}

export function modelResponse(url: string): Awaited<ReturnType<FetchLike>> {
  const path = new URL(url).pathname.split(`/resolve/${tinyModel.revision}/`)[1]
  const bytes = path === undefined ? undefined : modelBytes[path]
  if (bytes === undefined) throw new Error(`Unscripted model URL: ${url}`)
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
  }
}

/** The only substituted boundaries are HTTP/DNS and its connection handle. */
export function modelClient(
  fetch: FetchLike = async (url) => modelResponse(url),
): DownloadClientDeps {
  return {
    fetch,
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    dispatcher: () => ({ dispatcher: {}, close: async () => {} }),
  }
}
