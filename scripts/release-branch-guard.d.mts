export const RELEASE_CHANNELS: readonly string[]
export function assertReleaseSource(args: {
  actualSha: string
  expectedSha: string
  status: string
}): void
export function assertReleaseTarget(args: {
  branch: string
  remote: string
  remoteUrl: string
}): void
export function assertReleaseAdvance(args: {
  branch: string
  sourceSha: string
  mainSha: string
  previous?: { sourceSha: string; artifactDigest: string }
  sourceDescendsFromPrevious: boolean
  mainDescendsFromSource: boolean
  artifactDigest: string
}): void
