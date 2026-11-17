/** Verify submitted content against Zotero's echo, allowing only known wire normalization. */
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import { asRecord } from '../json.js'
import { relationTargetRef } from '../refs.js'
import { normalizeCreator } from '../write-item-rules.js'
import type { ZoteroCreator } from '../types.js'

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((value, index) => equal(value, right[index]))
  const a = asRecord(left),
    b = asRecord(right)
  return (
    a !== undefined &&
    b !== undefined &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  )
}

function stringSet(value: unknown, tags: boolean): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.map((entry) =>
    tags ? (typeof entry === 'string' ? entry : asRecord(entry)?.tag) : entry,
  )
  if (strings.some((entry) => typeof entry !== 'string')) return undefined
  return [...new Set(strings as string[])].sort()
}

function creatorsOf(value: unknown): readonly ZoteroCreator[] | undefined {
  if (!Array.isArray(value)) return undefined
  try {
    return value.map((entry, index) => {
      const row = asRecord(entry)
      if (row === undefined || typeof row.creatorType !== 'string')
        throw new Error('Invalid creator')
      for (const key of ['name', 'firstName', 'lastName'])
        if (row[key] !== undefined && typeof row[key] !== 'string')
          throw new Error('Invalid creator name')
      return normalizeCreator(
        {
          creatorType: row.creatorType,
          ...(typeof row.name === 'string' ? { name: row.name } : {}),
          ...(typeof row.firstName === 'string' ? { firstName: row.firstName } : {}),
          ...(typeof row.lastName === 'string' ? { lastName: row.lastName } : {}),
        },
        index,
      )
    })
  } catch {
    return undefined
  }
}

function relationSet(value: unknown): readonly string[] | undefined {
  const targets = stringSet(typeof value === 'string' ? [value] : value, false)
  return targets === undefined
    ? undefined
    : [
        ...new Set(
          targets.map((uri) => relationTargetRef(uri, undefined, { personalContext: true }) ?? uri),
        ),
      ].sort()
}

function canonicalNote(html: string): unknown {
  // Zotero setNote removes controls and trims; save adds this exact note envelope.
  const fragment = parseFragment(
    html.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim(),
  )
  let nodes = fragment.childNodes
  const only = nodes.length === 1 ? nodes[0] : undefined
  if (
    only &&
    'tagName' in only &&
    only.tagName === 'div' &&
    only.attrs.length === 1 &&
    only.attrs[0].name === 'class' &&
    /^zotero-note znv\d+$/.test(only.attrs[0].value)
  )
    nodes = only.childNodes
  const walk = (node: DefaultTreeAdapterTypes.ChildNode): unknown => {
    if ('tagName' in node)
      return [
        node.namespaceURI,
        node.tagName,
        node.attrs
          .map((attr) => [attr.namespace ?? '', attr.name, attr.value])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        ('content' in node ? node.content.childNodes : node.childNodes).map(walk),
      ]
    if (node.nodeName === '#text') return ['text', node.value]
    return ['comment', 'data' in node ? node.data : '']
  }
  return nodes.map(walk)
}

export function submittedFieldsMatch(
  data: Readonly<Record<string, unknown>>,
  submitted: Readonly<Record<string, unknown>>,
): boolean {
  for (const [field, expected] of Object.entries(submitted)) {
    const actual = data[field]
    if (field === 'deleted') {
      if (Boolean(actual) !== Boolean(expected)) return false
    } else if (field === 'note') {
      if (
        typeof actual !== 'string' ||
        typeof expected !== 'string' ||
        !equal(canonicalNote(actual), canonicalNote(expected))
      )
        return false
    } else if (field === 'creators') {
      const actualCreators = creatorsOf(actual),
        expectedCreators = creatorsOf(expected)
      if (
        actualCreators === undefined ||
        expectedCreators === undefined ||
        !equal(actualCreators, expectedCreators)
      )
        return false
    } else if (field === 'tags' || field === 'collections') {
      const actualSet = stringSet(actual, field === 'tags'),
        expectedSet = stringSet(expected, field === 'tags')
      if (actualSet === undefined || expectedSet === undefined || !equal(actualSet, expectedSet))
        return false
    } else if (field === 'relations') {
      const relations = asRecord(actual),
        expectedRelations = asRecord(expected)
      if (relations === undefined || expectedRelations === undefined) return false
      for (const [predicate, targets] of Object.entries(expectedRelations)) {
        const saved = relations[predicate]
        const actualSet = relationSet(saved)
        const expectedSet = relationSet(targets)
        if (actualSet === undefined || expectedSet === undefined || !equal(actualSet, expectedSet))
          return false
      }
    } else if (!equal(actual, expected)) return false
  }
  return true
}
