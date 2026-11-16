export interface ReleaseProvenance {
  version: number
  name: string
  packageVersion: string
  sourceSha: string
  buildDigest: string
  artifactDigest: string
  files: Record<string, string>
}
export interface ReleaseArtifact {
  stage: string
  tarball: string
  provenance: ReleaseProvenance
}
export function releaseManifestOf(
  manifest: Record<string, unknown> & { files?: string[] },
): Record<string, unknown>
export function prepareReleaseArtifact(
  out: string,
  sourceSha: string,
  base?: string,
): ReleaseArtifact
export function verifyReleaseArtifact(out: string, sourceSha: string): ReleaseArtifact
