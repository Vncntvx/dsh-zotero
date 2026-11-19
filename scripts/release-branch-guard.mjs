/** Pure source identity checks used before a release branch can move. */

/**
 * The release source facts the publishing workflow reads from git.
 * @typedef {{ actualSha: string, expectedSha: string, status: string }} ReleaseSourceFacts
 */

/**
 * The release target facts the publishing workflow reads from git.
 * @typedef {{ branch: string, remote: string, remoteUrl?: string }} ReleaseTargetFacts
 */

/**
 * The release channel state the provenance records for the previous release.
 * @typedef {{ sourceSha: string, artifactDigest: string }} ReleaseChannelState
 */

/**
 * Reject a HEAD that does not match the checked source or a dirty worktree.
 * @param source {ReleaseSourceFacts} the HEAD sha, the sha the run checked out, and `git status --porcelain`.
 * @returns {void}
 */
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

/**
 * The installation channel is one reviewed branch on the project's own remote.
 * @param target {ReleaseTargetFacts} the branch, remote name, and remote URL.
 * @returns {void}
 */
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

/**
 * A legacy channel can be initialized only from current main; later moves are
 * monotonic.
 * @param advance {{
 *   sourceSha: string,
 *   mainSha: string,
 *   previous: ReleaseChannelState | undefined,
 *   sourceDescendsFromPrevious: boolean,
 *   artifactDigest: string,
 * }} the candidate release move.
 * @returns {void}
 */
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
