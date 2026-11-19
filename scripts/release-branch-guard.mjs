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

/** The reviewed channels: `release` follows main; `stable` follows tag releases. */
export const RELEASE_CHANNELS = Object.freeze(['release', 'stable'])

/**
 * The installation channel is one reviewed branch on the project's own remote.
 * @param target {ReleaseTargetFacts} the branch, remote name, and remote URL.
 * @returns {void}
 */
export function assertReleaseTarget({ branch, remote, remoteUrl }) {
  if (!RELEASE_CHANNELS.includes(branch) || remote !== 'origin')
    throw new Error(
      '[release-branch] Only origin refs/heads/release and refs/heads/stable are release targets',
    )
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
 * The rolling channel mirrors current main, so a rewritten main reinitializes
 * it; the stable channel only moves forward along main history.
 * @param advance {{
 *   branch: string,
 *   sourceSha: string,
 *   mainSha: string,
 *   previous: ReleaseChannelState | undefined,
 *   sourceDescendsFromPrevious: boolean,
 *   mainDescendsFromSource: boolean,
 *   artifactDigest: string,
 * }} the candidate release move.
 * @returns {void}
 */
export function assertReleaseAdvance({
  branch,
  sourceSha,
  mainSha,
  previous,
  sourceDescendsFromPrevious,
  mainDescendsFromSource,
  artifactDigest,
}) {
  if (!RELEASE_CHANNELS.includes(branch))
    throw new Error(`[release-branch] Unknown release channel: ${branch}`)
  if (previous === undefined) {
    if (branch === 'release') {
      if (sourceSha !== mainSha)
        throw new Error('[release-branch] Initialize the rolling channel from current main')
    } else if (!mainDescendsFromSource) {
      throw new Error('[release-branch] Initialize the stable channel from main history')
    }
    return
  }
  if (!sourceDescendsFromPrevious) {
    if (branch === 'release' && sourceSha === mainSha) return
    throw new Error(
      `[release-branch] Refusing to move the ${branch} channel backwards or across unrelated history (HEAD ${sourceSha} does not descend from previous release source ${previous.sourceSha})`,
    )
  }
  if (previous.sourceSha === sourceSha && previous.artifactDigest !== artifactDigest)
    throw new Error('[release-branch] The same source commit produced different release bytes')
}
