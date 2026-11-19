/** Concrete package-install examples follow the package being released. */
export const PACKAGE_VERSION_DOCS = [
  'README.md',
  'README.en.md',
  'docs/getting-started.md',
  'docs/getting-started.en.md',
]
const version = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?`

/**
 * @param {string} text - document text carrying install examples.
 * @param {string} current - the package version the examples must show.
 * @returns {string} the text with every install example rewritten.
 */
export function withPackageDocVersion(text, current) {
  return text
    .replace(new RegExp('dsh-zotero@' + version, 'g'), 'dsh-zotero@' + current)
    .replace(
      new RegExp('github:Vncntvx/dsh-zotero#v' + version, 'g'),
      'github:Vncntvx/dsh-zotero#v' + current,
    )
}
/**
 * @param {string} path - document path, for problem messages.
 * @param {string} text - document text carrying install examples.
 * @param {string} current - the package version the examples must show.
 * @returns {string[]} human-readable problems; empty when the examples agree.
 */
export function packageDocVersionProblems(path, text, current) {
  return text === withPackageDocVersion(text, current)
    ? []
    : [
        `${path} install example differs from package version ${current}; run npm run harness:pin with the current harness pin to refresh generated examples`,
      ]
}
