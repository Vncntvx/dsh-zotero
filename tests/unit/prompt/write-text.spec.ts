/** The write policy generator: the full text stays stable, subsets name only admitted tools. */
import { describe, expect, it } from 'vitest'
import { SCHOLARLY_SAVE_TOOL_NAME, ZOTERO_WRITE_TOOL_NAMES } from '../../../src/constants.ts'
import { writePolicyTextOf, WRITE_POLICY_SENTENCE } from '../../../src/prompt.ts'

describe('writePolicyTextOf', () => {
  it('renders the canonical policy when every core write tool is admitted', () => {
    expect(writePolicyTextOf(ZOTERO_WRITE_TOOL_NAMES)).toBe(WRITE_POLICY_SENTENCE)
  })

  it('returns nothing when no write tool is admitted', () => {
    expect(writePolicyTextOf([])).toBe('')
  })

  it('names only the scholarly save entry in a save-only step', () => {
    const text = writePolicyTextOf([SCHOLARLY_SAVE_TOOL_NAME])
    expect(text).toContain(`Writes (${SCHOLARLY_SAVE_TOOL_NAME}):`)
    expect(text).toContain('Create only from closed schema; no BibTeX/CSL-JSON.')
    expect(text).toContain('All writes require session approval and an approved plan')
    expect(text).toContain('Success is authoritative')
    expect(text).not.toContain('zotero_create_note')
    expect(text).not.toContain('notes use Markdown')
    expect(text).not.toContain('Collection deletion')
  })

  it('keeps the note clauses without naming another write tool', () => {
    const text = writePolicyTextOf(['zotero_create_note'])
    expect(text).toContain('Writes (zotero_create_note): Notes use Markdown')
    expect(text).toContain('sources are refs')
    expect(text).toContain('child notes cannot take collections')
    expect(text).not.toContain('zotero_update_note')
    expect(text).not.toContain('Tag/membership changes')
  })

  it('keeps the membership clause for a tag-only step', () => {
    const text = writePolicyTextOf(['zotero_update_item_tags'])
    expect(text).toContain('Writes (zotero_update_item_tags): Sources are refs.')
    expect(text).toContain('Tag/membership changes are atomic and version-guarded.')
    expect(text).not.toContain('notes use Markdown')
  })

  it('keeps collection deletion without the library-tag clause', () => {
    const text = writePolicyTextOf(['zotero_delete_collection'])
    expect(text).toContain(
      'Collection deletion is irreversible (items stay, child collections go); plans state counts.',
    )
    expect(text).not.toContain('library-tag deletion')
  })

  it('capitalizes a tag-only deletion clause', () => {
    const text = writePolicyTextOf(['zotero_delete_library_tags'])
    expect(text).toContain('Library-tag deletion removes all item tags; plans state counts.')
    expect(text).not.toContain('Collection deletion')
  })

  it('keeps the scalar-patch clause for update-item only', () => {
    expect(writePolicyTextOf(['zotero_update_item'])).toContain('Skip unchanged scalar PATCHes.')
    expect(writePolicyTextOf(['zotero_update_collection'])).not.toContain(
      'Skip unchanged scalar PATCHes.',
    )
  })

  it('keeps the batch-only clauses together', () => {
    const text = writePolicyTextOf(['zotero_batch_items'])
    expect(text).toContain('Tag/membership changes are atomic')
    expect(text).toContain('Create only from closed schema')
    expect(text).toContain('Item deletion verifies item and all children')
    expect(text).not.toContain('Collection deletion')
  })

  it('adds the scholarly save entry beside the full core set', () => {
    const text = writePolicyTextOf([...ZOTERO_WRITE_TOOL_NAMES, SCHOLARLY_SAVE_TOOL_NAME])
    expect(text).toContain(
      `Writes (${ZOTERO_WRITE_TOOL_NAMES.join(', ')}, ${SCHOLARLY_SAVE_TOOL_NAME}):`,
    )
  })
})
