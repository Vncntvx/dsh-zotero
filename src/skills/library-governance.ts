import { EXAMPLE_REF, type ResearchSop } from './definition.js'

export const libraryGovernance: ResearchSop = {
  name: 'zotero-library-governance',
  component: 'core',
  description:
    'Audit an existing personal library scope for metadata, tags, collections and changes; apply only explicitly requested reviewed fixes. Not discovery or external intake.',
  whenToUse:
    'Use for existing-library organization and quality checks. Default to a read-only difference report. No automatic merge, purge or inferred duplicate deletion.',
  triggerKeywords: [
    'library governance',
    'tag cleanup',
    'collection cleanup',
    'metadata cleanup',
    'field reconciliation',
  ],
  phases: [
    {
      name: 'Bound the audit',
      instruction:
        'Record requested library, scope and defect criteria. Browse relevant collections/tags first; use exact observed refs/names. Default audit budget: five search/browse pages and 100 top-level items; a larger explicit user scope may raise this once before execution. Never claim whole-library health from a subset.',
    },
    {
      name: 'Inspect and diff',
      instruction:
        'Use zotero_search with explicit scope/itemLevel and returned nextOffset; use zotero_get_batch for selected refs. Read each page once; stop on absent nextOffset, repeated offset/version mismatch or budget. Use zotero_changes for a requested one-time baseline/diff only, passing a returned cursor unchanged as since. No fabricated cursor or background watcher.',
    },
    {
      name: 'Prepare changes',
      instruction:
        'List per-item before/after values, scope and destructive blast radius. Distinguish duplicate candidates from proven identity: no merge API exists. Incomplete pagination, uncertain target or changed versions blocks execution. Group tag/membership updates using zotero_batch_items; its update arm cannot change scalar metadata.',
    },
    {
      name: 'Approve and reconcile',
      instruction:
        'Only root may execute explicitly requested fixes through normal approval. Use zotero_update_item for supported scalar fields; exact collection/tag operations for directory changes. Batch combined create/update/delete entries at min(50, configured writeListMaxItems); updates/deletes are not transactional. Stop on refusal or uncertain commit, read back returned refs once, and report per-item applied/unchanged/failed/unverified.',
    },
  ],
  recipes: [
    {
      tool: 'zotero_browse',
      args: { kind: 'collections', library: { type: 'user', id: 0 }, limit: 20 },
      purpose: 'Observe directory refs before planning',
    },
    {
      tool: 'zotero_browse',
      args: { kind: 'tags', library: { type: 'user', id: 0 }, limit: 20 },
      purpose: 'Observe exact tag names',
    },
    {
      tool: 'zotero_search',
      args: { scope: { kind: 'library' }, itemLevel: 'top', limit: 20, offset: 0 },
      purpose: 'Bounded existing-library audit',
    },
    {
      tool: 'zotero_changes',
      args: { include: ['items', 'collections', 'deleted'] },
      purpose: 'One-time baseline; reuse its real cursor for later since',
    },
    {
      tool: 'zotero_batch_items',
      args: { update: [{ ref: EXAMPLE_REF, addTags: ['reviewed'], removeTags: ['to-review'] }] },
      requires: 'Root agent, explicit user write request and both approvals',
      purpose: 'One reviewed batch of tag/membership changes',
    },
    {
      tool: 'zotero_update_item',
      args: { ref: EXAMPLE_REF, set: { title: 'User-confirmed corrected title' } },
      requires: 'Root agent, verified field discrepancy and both approvals',
      purpose: 'Scalar metadata correction outside batch update',
    },
    {
      tool: 'zotero_create_collection',
      args: { name: 'User-confirmed collection' },
      requires: 'Root agent, explicit directory creation and both approvals',
      purpose: 'Create a confirmed destination',
    },
    {
      tool: 'zotero_delete_library_tags',
      args: { tags: ['user-confirmed-obsolete-tag'] },
      requires: 'Root agent, exact observed tag, explicit library-wide deletion and both approvals',
      purpose: 'Library-wide deletion only after blast-radius review',
    },
  ],
  failureModes: [
    'Group libraries are read-only; do not rewrite refs to user/0 to bypass this.',
    'Trash search is panel-only. Restore only explicitly supplied known trashed refs through the dedicated tool; never invent a trash search scope.',
    'Incomplete changes cursor/coverage: report limits and do not advance a checkpoint. No merge or PDF attachment creation is supported.',
    'A write failure, partial batch or uncertain commit ends execution; reconcile, never automatically resend the remainder.',
  ],
  output:
    'Audited scope and coverage; evidence-based before/after proposal; approval outcomes and per-item receipts if execution was requested; unresolved conflicts. No automatic duplicate removal.',
}
