/** The write form: a submission opens the session approval and plan card of the matching write tool. */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroLibraryWriteRequestView,
  ZoteroLibraryWriteResultView,
} from '../../../contract.ts'
import { zoteroLibraryWriteRequestSchema } from '../../../wire-schemas.ts'
import { messageOf } from '../../error-text.ts'
import { savedSearchConditionsOf } from './write-draft.ts'
import css from './library.module.css'

type Operation = ZoteroLibraryWriteRequestView['operation']

/** The fields each operation's draft carries, in the order the form renders them. */
const FIELDS = {
  updateItem: ['ref', 'set'],
  updateTags: ['ref', 'add', 'remove'],
  updateMembership: ['ref', 'add', 'remove'],
  createItem: [
    'itemType',
    'title',
    'url',
    'date',
    'doi',
    'publicationTitle',
    'abstractNote',
    'creators',
    'tags',
    'collections',
  ],
  createNote: ['parentItem', 'markdown', 'tags', 'collections', 'sourceRefs'],
  updateNote: ['ref', 'markdown'],
  createCollection: ['name', 'parent'],
  updateCollection: ['collection', 'name', 'parent'],
  deleteCollection: ['collection'],
  createSavedSearch: ['name', 'conditions'],
  updateSavedSearch: ['search', 'name', 'conditions'],
  deleteSavedSearch: ['search'],
  trash: ['refs'],
  restore: ['refs'],
  batch: ['create', 'update', 'delete'],
} as const satisfies Record<Operation, readonly string[]>

/** The operation picker's order; the contract's union must cover every entry. */
const OPERATIONS = Object.keys(FIELDS) as Operation[]
/** The item fields the `set` operation edits. */
const METADATA = [
  'title',
  'date',
  'url',
  'doi',
  'abstractNote',
  'publicationTitle',
  'extra',
] as const
type Field = (typeof FIELDS)[Operation][number] | (typeof METADATA)[number]
const LISTS = new Set<Field>([
  'add',
  'remove',
  'tags',
  'collections',
  'sourceRefs',
  'refs',
  'delete',
])
const JSON_FIELDS = new Set<Field>(['creators', 'create', 'update'])

/** Which lane a successful write invalidates; every other operation changes items. */
const AFFECTED_LANE: Partial<Record<Operation, 'collections' | 'savedSearches'>> = {
  createCollection: 'collections',
  updateCollection: 'collections',
  deleteCollection: 'collections',
  createSavedSearch: 'savedSearches',
  updateSavedSearch: 'savedSearches',
  deleteSavedSearch: 'savedSearches',
}

export function LibraryWrite({
  t,
  write,
  sessionId,
  sessionRunning,
  selectedRef,
  collectionRef,
  searchRef,
  refreshAffected,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly write: (
    request: ZoteroLibraryWriteRequestView,
  ) => Promise<RemoteResult<ZoteroLibraryWriteResultView>>
  /** The conversation this panel belongs to; the only write target. */
  readonly sessionId: string
  /** Whether that conversation can currently receive approvals. */
  readonly sessionRunning: boolean
  readonly selectedRef?: string
  readonly collectionRef?: string
  readonly searchRef?: string
  readonly refreshAffected: (kind: 'items' | 'collections' | 'savedSearches') => void
}) {
  const [operation, setOperation] = useState<Operation>('updateItem')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [conditions, setConditions] = useState([{ condition: '', operator: '', value: '' }])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ZoteroLibraryWriteResultView>()
  const mounted = useRef(true)
  const inFlight = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const labels: Record<Field, string> = {
    ref: t('libraryWriteRef'),
    refs: t('libraryWriteRefs'),
    parentItem: t('libraryWriteParentItem'),
    collection: t('libraryWriteCollection'),
    parent: t('libraryWriteParentCollection'),
    search: t('libraryWriteSearch'),
    title: t('libraryWriteTitle'),
    name: t('libraryWriteName'),
    itemType: t('libraryWriteItemType'),
    url: t('libraryMetaUrl'),
    date: t('libraryMetaDate'),
    doi: t('libraryMetaDoi'),
    publicationTitle: t('libraryMetaVenue'),
    abstractNote: t('libraryMetaAbstract'),
    extra: t('libraryMetaExtra'),
    markdown: t('libraryWriteMarkdown'),
    tags: t('libraryMetaTags'),
    collections: t('libraryMetaCollections'),
    sourceRefs: t('libraryWriteSources'),
    add: t('libraryWriteAdd'),
    remove: t('libraryWriteRemove'),
    set: t('libraryWriteMetadata'),
    conditions: t('librarySearchConditions'),
    creators: t('libraryWriteCreators'),
    create: t('libraryWriteBatchCreate'),
    update: t('libraryWriteBatchUpdate'),
    delete: t('libraryWriteTrashRefs'),
  }
  const operationLabels: Record<Operation, string> = {
    updateItem: t('libraryWriteUpdateItem'),
    updateTags: t('libraryWriteTags'),
    updateMembership: t('libraryWriteMembership'),
    createItem: t('libraryWriteCreateItem'),
    createNote: t('libraryWriteCreateNote'),
    updateNote: t('libraryWriteUpdateNote'),
    createCollection: t('libraryWriteCreateCollection'),
    updateCollection: t('libraryWriteUpdateCollection'),
    deleteCollection: t('libraryWriteDeleteCollection'),
    createSavedSearch: t('libraryWriteCreateSearch'),
    updateSavedSearch: t('libraryWriteUpdateSearch'),
    deleteSavedSearch: t('libraryWriteDeleteSearch'),
    trash: t('libraryWriteTrash'),
    restore: t('libraryWriteRestore'),
    batch: t('libraryWriteBatch'),
  }
  const initial = (field: Field) =>
    field === 'ref' || field === 'parentItem' || field === 'refs'
      ? (selectedRef ?? '')
      : field === 'collection'
        ? (collectionRef ?? '')
        : field === 'search'
          ? (searchRef ?? '')
          : ''
  const value = (field: Field) => draft[field] ?? initial(field)
  const change = (field: Field, text: string) =>
    setDraft((previous) => ({ ...previous, [field]: text }))
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!sessionRunning || inFlight.current) return
    setResult(undefined)
    let request: ZoteroLibraryWriteRequestView
    try {
      const args: Record<string, unknown> = {}
      for (const field of FIELDS[operation]) {
        if (field === 'set') {
          args.set = Object.fromEntries(
            METADATA.filter((key) => value(key) !== '').map((key) => [key, value(key)]),
          )
          continue
        }
        if (field === 'conditions') {
          const draftConditions = savedSearchConditionsOf(conditions)
          if (draftConditions.kind === 'invalid') {
            setResult({ kind: 'failed', message: t('libraryWriteConditionIncomplete') })
            return
          }
          if (operation === 'createSavedSearch' && draftConditions.kind === 'empty') {
            setResult({ kind: 'failed', message: t('libraryWriteConditionsRequired') })
            return
          }
          if (draftConditions.kind === 'ok') args.conditions = draftConditions.conditions
          continue
        }
        const text = value(field)
        if (text === '') continue
        args[field] = LISTS.has(field)
          ? text
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
          : JSON_FIELDS.has(field)
            ? JSON.parse(text)
            : text
      }
      request = zoteroLibraryWriteRequestSchema.parse({ sessionId, operation, args })
    } catch {
      setResult({ kind: 'failed', message: t('libraryWriteInvalid') })
      return
    }
    inFlight.current = true
    setBusy(true)
    try {
      const answer = await write(request)
      const result = answer.ok
        ? answer.value
        : { kind: 'failed' as const, message: answer.error.message }
      // Refresh before the mount check: the form is re-keyed on a selection
      // change, so the answer can resolve after this instance is gone while
      // the committed write still happened.
      if (result.kind === 'applied' || result.kind === 'committed-unverified')
        refreshAffected(AFFECTED_LANE[operation] ?? 'items')
      if (!mounted.current) return
      setResult(result)
    } catch (error) {
      if (mounted.current)
        setResult({
          kind: 'failed',
          message: messageOf(error),
        })
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <details className={css.writeCard}>
      <summary>{t('libraryWriteActions')}</summary>
      <p className={css.listNote}>{t('libraryWriteApprovalHint')}</p>
      {!sessionRunning && (
        <p className={css.listNote} role="status">
          {t('libraryWriteNeedsSession')}
        </p>
      )}
      <form className={css.writeForm} onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy || !sessionRunning} className={css.writeForm}>
          <label className={css.writeField}>
            <span className={css.writeFieldLabel}>{t('libraryWriteSession')}</span>
            <input className={css.writeInput} value={sessionId} readOnly aria-readonly="true" />
          </label>
          <label className={css.writeField}>
            <span className={css.writeFieldLabel}>{t('libraryWriteOperation')}</span>
            <select
              className={css.writeSelect}
              value={operation}
              onChange={(event) => {
                setOperation(event.target.value as Operation)
                setDraft({})
                setResult(undefined)
                setConditions([{ condition: '', operator: '', value: '' }])
              }}
            >
              {OPERATIONS.map((name) => (
                <option key={name} value={name}>
                  {operationLabels[name]}
                </option>
              ))}
            </select>
          </label>
          {FIELDS[operation]
            .flatMap((field) => (field === 'set' ? METADATA : [field]))
            .map((field) =>
              field === 'conditions' ? (
                <fieldset key={field} className={css.writeField}>
                  <legend className={css.writeFieldLabel}>{labels.conditions}</legend>
                  {conditions.map((row, index) => (
                    <div key={index} className={css.writeConditionRow}>
                      {(['condition', 'operator', 'value'] as const).map((part) => (
                        <label key={part} className={clsx(css.writeField, css.writeConditionField)}>
                          <span className={css.writeFieldLabel}>
                            {part === 'condition'
                              ? t('libraryWriteCondition')
                              : part === 'operator'
                                ? t('libraryWriteOperator')
                                : t('libraryWriteValue')}
                          </span>
                          <input
                            className={css.writeInput}
                            value={row[part]}
                            onChange={(event) =>
                              setConditions((rows) =>
                                rows.map((entry, i) =>
                                  i === index ? { ...entry, [part]: event.target.value } : entry,
                                ),
                              )
                            }
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        className={css.pageButton}
                        disabled={conditions.length === 1}
                        onClick={() => setConditions((rows) => rows.filter((_, i) => i !== index))}
                      >
                        {t('libraryWriteRemoveCondition')}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={css.pageButton}
                    onClick={() =>
                      setConditions((rows) => [...rows, { condition: '', operator: '', value: '' }])
                    }
                  >
                    {t('libraryWriteAddCondition')}
                  </button>
                </fieldset>
              ) : (
                <label className={css.writeField} key={field}>
                  <span className={css.writeFieldLabel}>{labels[field]}</span>
                  {LISTS.has(field) && (
                    <small className={css.listNote}>{t('libraryWriteOnePerLine')}</small>
                  )}
                  {JSON_FIELDS.has(field) && (
                    <small className={css.listNote}>{t('libraryWriteJsonHint')}</small>
                  )}
                  <textarea
                    className={css.writeTextarea}
                    value={value(field)}
                    onChange={(event) => change(field, event.target.value)}
                    rows={field === 'markdown' ? 6 : 2}
                  />
                </label>
              ),
            )}
          <button type="submit" className={clsx(css.pageButton, css.writeSubmitButton)}>
            {busy ? t('libraryWritePending') : t('libraryWriteReview')}
          </button>
        </fieldset>
      </form>
      {result !== undefined && (
        <div
          className={clsx(css.writeResult, result.kind === 'failed' && css.writeResultFailed)}
          role={result.kind === 'failed' ? 'alert' : 'status'}
        >
          <strong>
            {result.kind === 'declined'
              ? t('libraryWriteDeclined')
              : result.kind === 'committed-unverified'
                ? t('libraryWriteUnverified')
                : result.kind === 'failed'
                  ? t('libraryWriteFailed')
                  : t('libraryWriteApplied')}
          </strong>
          <pre>
            {result.code}
            {result.code ? '\n' : ''}
            {result.message}
          </pre>
        </div>
      )}
    </details>
  )
}
