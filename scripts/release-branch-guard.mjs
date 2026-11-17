/** Pure source identity checks used before a release branch can move. */

export function assertReleaseSource({ actualSha, expectedSha, status }) {
  if (actualSha !== expectedSha) {
    throw new Error(
      `[release-branch] HEAD ${actualSha} does not match checked source ${expectedSha}`,
    )
  }
  if (status !== '') {
    throw new Error('[release-branch] Refusing to publish from a dirty worktree')
  }
}

/** The installation channel is one reviewed branch on the project's own remote. */
export function assertReleaseTarget({ branch, remote, remoteUrl }) {
  if (branch !== 'release' || remote !== 'origin')
    throw new Error('[release-branch] Only origin refs/heads/release is a release target')
  const normalized = (remoteUrl ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  if (
    ![
      'https://github.com/Vncntvx/dsh-zotero',
      'git@github.com:Vncntvx/dsh-zotero',
      'ssh://git@github.com/Vncntvx/dsh-zotero',
    ].includes(normalized)
  )
    throw new Error('[release-branch] The release remote is not the trusted project repository')
}

/** A legacy channel can be initialized only from current main; later moves are monotonic. */
export function assertReleaseAdvance({
  sourceSha,
  mainSha,
  previous,
  sourceDescendsFromPrevious,
  artifactDigest,
}) {
  if (previous === undefined) {
    if (sourceSha !== mainSha)
      throw new Error('[release-branch] Initialize provenance from current main')
    return
  }
  if (!sourceDescendsFromPrevious)
    throw new Error(
      `[release-branch] Refusing to move the release channel backwards or across unrelated history (HEAD ${sourceSha} does not descend from previous release source ${previous.sourceSha})`,
    )
  if (previous.sourceSha === sourceSha && previous.artifactDigest !== artifactDigest)
    throw new Error('[release-branch] The same source commit produced different release bytes')
}
