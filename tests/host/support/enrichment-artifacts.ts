/** Synthetic committed v2 artifact and source record shared by store contract specs. */
import { sourceKeyOf } from '../../../src/enrichment/source-stamp.ts'
import type { ParsedArtifact } from '../../../src/enrichment/types.ts'
import type { SourceIndexRecord } from '../../../src/enrichment/artifact-store.ts'
import { attachmentRef } from '../../helpers/server/keys.ts'
import { GENERATION } from './enrichment-parse-domain.ts'

export const CACHE_KEY = 'a'.repeat(64)
export const SOURCE_KEY = sourceKeyOf(attachmentRef())
export const FILE_STAMP = { kind: 'file', size: 10, mtimeMs: 20 } as const
export const ARTIFACT: ParsedArtifact = {
  markdown: '# Parsed body',
  contentList: '[{"type":"text"}]',
  meta: {
    version: 2,
    parser: 'mineru',
    format: 'markdown',
    sourceId: SOURCE_KEY,
    generation: GENERATION,
    identity: attachmentRef(),
    mode: 'pro',
    contentFingerprint: 'f'.repeat(64),
    taskId: 't1',
    files: ['full.md', 'content_list.json'],
    title: 'Parsed body',
  },
}
export const SOURCE_RECORD: SourceIndexRecord = {
  version: 2,
  cacheKey: CACHE_KEY,
  fingerprint: ARTIFACT.meta.contentFingerprint,
  generation: GENERATION,
  parser: 'mineru',
  format: 'markdown',
  stamp: FILE_STAMP,
}
