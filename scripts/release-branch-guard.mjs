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
