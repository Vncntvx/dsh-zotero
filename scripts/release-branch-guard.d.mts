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
  sourceSha: string
  mainSha: string
  previous?: { sourceSha: string; artifactDigest: string }
  sourceDescendsFromPrevious: boolean
  artifactDigest: string
}): void
