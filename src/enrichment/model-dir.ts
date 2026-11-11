/**
 * Resolves the directory where local semantic models are stored.
 *
 * Models default to ~/.dsh/models (`dshHomePath('models')`), outside the plugin
 * source tree and package bundle. A custom path expands ~ to the user's home
 * directory. Files are stored under their physical model key (e.g.
 * `qwen3-0.6b`); semantic tier keys (e.g. `balanced`) map to them without disk
 * migration.
 * @module dsh-zotero/enrichment/model-dir
 */

import { join } from 'node:path'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { isSemanticModelKey, semanticModelOf } from '../enrichment-model-catalog.js'

/**
 * Resolve the root directory for semantic models on disk.
 * Empty or whitespace-only input falls back to `dshHomePath('models')` (~/.dsh/models).
 */
export function resolveSemanticModelRoot(configuredDir?: string): string {
  const trimmed = configuredDir?.trim()
  if (!trimmed) {
    return dshHomePath('models')
  }
  return expandHomePath(trimmed)
}

/**
 * Resolve the directory for a specific model key on disk.
 * Stable semantic keys (e.g. `balanced`) resolve to their backing physical model directory.
 */
export function resolveSemanticModelDir(modelKey: string, configuredDir?: string): string {
  const subDir = isSemanticModelKey(modelKey) ? semanticModelOf(modelKey).physicalKey : modelKey
  return join(resolveSemanticModelRoot(configuredDir), subDir)
}
