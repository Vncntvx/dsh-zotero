/** Deployment limits for complete parsed-document preparation. */
export interface ArtifactReaderPreferences {
  readonly maxOpen: number
  readonly maxBytes: number
  readonly preparedMaxBytes: number
  readonly idleTimeoutMs: number
  readonly maxLifetimeMs: number
  readonly concurrency: number
  readonly archiveConcurrency: number
  readonly archiveQueueLimit: number
}

export const ARTIFACT_READER_DEFAULTS: ArtifactReaderPreferences = Object.freeze({
  maxOpen: 8,
  maxBytes: 256 * 1024 * 1024,
  preparedMaxBytes: 512 * 1024 * 1024,
  idleTimeoutMs: 120_000,
  maxLifetimeMs: 600_000,
  concurrency: 4,
  archiveConcurrency: 2,
  archiveQueueLimit: 8,
})

export function artifactReaderPreferencesOf(value: unknown): ArtifactReaderPreferences {
  if (value === undefined) return ARTIFACT_READER_DEFAULTS
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid artifact reader limits')
  const input = value as Record<string, unknown>
  const result = { ...ARTIFACT_READER_DEFAULTS }
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(result, key)) throw new Error(`Unknown artifact reader limit: ${key}`)
    const number = input[key]
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1)
      throw new Error(`Invalid artifact reader limit: ${key}`)
    result[key as keyof ArtifactReaderPreferences] = number
  }
  return Object.freeze(result)
}
