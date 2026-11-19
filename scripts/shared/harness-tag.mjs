/**
 * Distinguish an absent pin from a missing contract inside an existing pin.
 * @param {((args: string[]) => string)} run - the git runner.
 * @param {string} tag - the harness pin tag.
 * @param {string} path - the contract file path inside the tag.
 */
export function pinnedFileOf(run, tag, path) {
  try {
    run(['rev-parse', '--verify', `${tag}^{commit}`])
  } catch {
    return { kind: 'missing-tag', message: `Harness pin tag ${tag} is unavailable` }
  }
  try {
    return { kind: 'file', source: run(['show', `${tag}:${path}`]) }
  } catch {
    return {
      kind: 'missing-file',
      message: `Harness pin ${tag} exists but its contract file ${path} is unavailable`,
    }
  }
}
