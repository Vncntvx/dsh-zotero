import { harnessUpperBoundOf } from './harness-version.mjs'
/** Living installation examples follow the manifest pin; historical notes keep their original dates. */
export const HARNESS_PIN_DOCS = [
  'README.md',
  'README.en.md',
  'docs/getting-started.md',
  'docs/getting-started.en.md',
  'docs/skills.md',
  'docs/skills.en.md',
]
const version = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?`

/**
 * @param {string} path - document path; picks the living marker pattern.
 * @param {string} text - document text carrying installation examples.
 * @param {string} pin - the exact harness pin.
 * @returns {string} the text with every living example rewritten.
 */
export function withHarnessDocPin(path, text, pin) {
  if (path.startsWith('README'))
    return text
      .replace(new RegExp(`dsh-v${version}`, 'g'), `dsh-v${pin}`)
      .replace(/badge\/dsh-[^/]+-blue/g, `badge/dsh-${pin.replaceAll('-', '--')}-blue`)
  if (path.includes('getting-started'))
    return text.replace(
      new RegExp('dsh (?:≥ ' + version + '|`>=' + version + ' <' + version + '`)', 'g'),
      'dsh `>=' + pin + ' <' + harnessUpperBoundOf(pin) + '`',
    )
  if (path.includes('skills'))
    return text.replace(new RegExp(`harness:pin -- ${version}`, 'g'), `harness:pin -- ${pin}`)
  throw new Error(`No living pin marker defined for ${path}`)
}

/**
 * @param {string} path - document path; picks the living marker pattern.
 * @param {string} text - document text carrying installation examples.
 * @param {string} pin - the exact harness pin.
 * @returns {string[]} human-readable problems; empty when the examples agree.
 */
export function harnessDocPinProblems(path, text, pin) {
  const marker = path.startsWith('README')
    ? /dsh-v\d/
    : path.includes('getting-started')
      ? /dsh (?:≥ \d|`>=\d)/
      : /harness:pin -- \d/
  if (!marker.test(text)) return [`${path} has no installation pin marker`]
  return text === withHarnessDocPin(path, text, pin)
    ? []
    : [
        `${path} installation example differs from harness pin ${pin}; run npm run harness:pin -- ${pin}`,
      ]
}

/** Review records are checked on upgrades and require a new evidence review before editing. */
export const HARNESS_REVIEW_DOCS = ['docs/development-notes.md', 'docs/development-notes.en.md']
/**
 * @param {string} path - document path, for problem messages.
 * @param {string} text - document text carrying the review record.
 * @param {string} pin - the exact harness pin the review must cover.
 * @returns {string[]} human-readable problems; empty when the record is current.
 */
export function harnessReviewProblems(path, text, pin) {
  const match = text.match(/^<!-- harness-reviewed: ([^ ]+) -->$/m)
  return match?.[1] === pin
    ? []
    : [
        `${path} has no evidence review for harness ${pin}; review each active upstream constraint and update its review record`,
      ]
}
