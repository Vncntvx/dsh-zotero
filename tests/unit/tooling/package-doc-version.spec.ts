/** A release cannot keep concrete install examples on an older plugin version. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PACKAGE_VERSION_DOCS,
  packageDocVersionProblems,
  withPackageDocVersion,
} from '../../../scripts/shared/package-doc-version.mjs'

const root = new URL('../../../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))

describe('concrete installation examples', () => {
  it.each(PACKAGE_VERSION_DOCS)('matches the released package in %s', (path) => {
    expect(
      packageDocVersionProblems(path, readFileSync(new URL(path, root), 'utf8'), manifest.version),
    ).toEqual([])
  })
  it('rewrites registry versions and GitHub tags while keeping placeholders and latest', () => {
    const text =
      'dsh-zotero@1.0.1 github:Vncntvx/dsh-zotero#v1.0.1 dsh-zotero@latest dsh-zotero@<version>'
    expect(withPackageDocVersion(text, '1.1.0')).toBe(
      'dsh-zotero@1.1.0 github:Vncntvx/dsh-zotero#v1.1.0 dsh-zotero@latest dsh-zotero@<version>',
    )
    expect(packageDocVersionProblems('README.md', text, '1.1.0')).toHaveLength(1)
  })
})
