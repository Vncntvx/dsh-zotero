import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  IconChevronDownOutlineMedium,
  IconSearchOutlineRegular,
  Input,
  Menu,
  Modal,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  SupportedLocalLibrary,
  ZoteroBatchCatalogView,
  ZoteroDocumentMaintenanceRemote,
  ZoteroStartBatchParseRequestView,
} from '../../contract.ts'
import { messageOf } from '../error-text.ts'
import { documentParseText, typedRemoteResult } from './parse-controller.ts'
import type { DocumentParseDeployment } from './parse-surface.tsx'
import { batchDone, BatchProgressBar } from './BatchProgressBar.tsx'
import { batchIsActive, type BatchParseStatus } from './use-batch-parse-status.ts'
import { formatParseFileLimit } from './parse-locales.ts'
import css from './parse.module.css'

type Catalog = Extract<ZoteroBatchCatalogView, { kind: 'pdfs' }>
type Library = Extract<ZoteroBatchCatalogView, { kind: 'libraries' }>['libraries'][number]
const PDF_PAGE = 50
const FAILURE_PAGE = 25
const libraryKey = (library: SupportedLocalLibrary) => `${library.type}/${library.id}`

interface Props {
  remote: ZoteroDocumentMaintenanceRemote
  sessionId: string
  deployment: DocumentParseDeployment
  canStart: boolean
  canSelect: boolean
  canCancel: boolean
  status: BatchParseStatus
  onClose(): void
  t: TranslateNS<'zotero'>
}

export function BatchParseDialog({
  remote,
  sessionId,
  deployment,
  canStart,
  canSelect,
  canCancel,
  status,
  onClose,
  t,
}: Props) {
  const [libraries, setLibraries] = useState<readonly Library[]>()
  const [library, setLibrary] = useState<Library>()
  const [libraryMenu, setLibraryMenu] = useState(false)
  const [catalog, setCatalog] = useState<Catalog>()
  const catalogId = useRef<string>()
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [selection, setSelection] = useState({ all: false, refs: new Set<string>() })
  const [review, setReview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formError, setError] = useState<string>()
  const [choosingAgain, setChoosingAgain] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const request = useRef<ZoteroStartBatchParseRequestView>()
  const rows = useRef<HTMLUListElement>(null)
  const { batch, offset: failureOffset } = status
  const error = formError ?? status.error
  const active = batchIsActive(batch)
  const showingResult = !!batch && (active || !choosingAgain)
  const choosing = batch !== undefined && !showingResult && canSelect
  const connected = deployment.connected
  const selected = selection.all ? (catalog?.total ?? 0) - selection.refs.size : selection.refs.size
  const libraryName = (entry: Library) =>
    entry.library.type === 'user' ? t('batchPersonal') : entry.name
  const reconnect = () => {
    setError(undefined)
    setRefresh((value) => value + 1)
    status.refresh()
  }

  useEffect(() => {
    if (!choosing || !connected || libraries !== undefined) return
    const abort = new AbortController()
    void remote
      .batchPdfCatalog({ sessionId, kind: 'libraries' }, abort.signal)
      .then((value) => {
        if (abort.signal.aborted) return
        const result = typedRemoteResult(value)
        if (result.kind === 'libraries') {
          setLibraries(result.libraries)
          setLibrary(result.libraries[0])
        }
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) setError(messageOf(cause))
      })
    return () => abort.abort()
  }, [choosing, connected, libraries, refresh, remote, sessionId])

  useEffect(() => {
    if (!choosing || !connected || review || library === undefined) return
    const abort = new AbortController()
    const read = async () => {
      try {
        const result = typedRemoteResult(
          await remote.batchPdfCatalog(
            {
              sessionId,
              kind: 'pdfs',
              query,
              offset,
              source:
                catalogId.current === undefined
                  ? { library: library.library }
                  : { catalogId: catalogId.current },
            },
            abort.signal,
          ),
        )
        if (abort.signal.aborted) return
        if (result.kind === 'pdfs') {
          catalogId.current = result.catalogId
          setCatalog(result)
          if (rows.current) rows.current.scrollTop = 0
          setError(undefined)
        }
      } catch (cause) {
        if (!abort.signal.aborted) setError(messageOf(cause))
      } finally {
        if (!abort.signal.aborted) setLoading(false)
      }
    }
    setLoading(true)
    const timer = setTimeout(() => void read(), query === '' ? 0 : 200)
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [choosing, connected, library, offset, query, refresh, remote, review, sessionId])

  const clearSelection = () => setSelection({ all: false, refs: new Set() })
  const resetCatalog = () => {
    catalogId.current = undefined
    setCatalog(undefined)
    setQuery('')
    setOffset(0)
    clearSelection()
    request.current = undefined
  }
  const toggle = (ref: string, checked: boolean) =>
    setSelection((previous) => {
      const refs = new Set(previous.refs)
      if (checked !== previous.all) refs.add(ref)
      else refs.delete(ref)
      return { ...previous, refs }
    })
  const submit = async () => {
    if (!catalog || !canStart || !connected || submitting || selected < 1) return
    request.current ??= {
      sessionId,
      catalogId: catalog.catalogId,
      operationId: randomUUID(),
      selection: { all: selection.all, refs: [...selection.refs] },
    }
    setSubmitting(true)
    setError(undefined)
    try {
      status.accept(typedRemoteResult(await remote.startBatchParse(request.current)))
      request.current = undefined
      setReview(false)
      setChoosingAgain(false)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setSubmitting(false)
    }
  }
  const cancel = async () => {
    if (!batch || !canCancel || !connected || submitting) return
    setSubmitting(true)
    setError(undefined)
    try {
      status.accept(
        typedRemoteResult(
          await remote.cancelBatchParse({ sessionId, operationId: batch.operationId }),
        ),
      )
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('batchTitle')}
      closeLabel={t('parseClose')}
      className={`${css.card} ${css.batchCard}`}
      contentClassName={`${css.content} ${css.batchContent}`}
      footer={
        <div className={css.footer}>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('parseClose')}
          </Button>
          {batch && active && canCancel && (
            <Button
              type="button"
              variant="outline"
              disabled={!connected || submitting || batch.state === 'stopping'}
              onClick={() => void cancel()}
            >
              {t('parseCancel')}
            </Button>
          )}
          {showingResult && !active && canSelect && canStart && (
            <Button
              type="button"
              variant="primary"
              disabled={!connected}
              onClick={() => {
                resetCatalog()
                setChoosingAgain(true)
                setError(undefined)
              }}
            >
              {t('batchNew')}
            </Button>
          )}
          {choosing &&
            (review ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => {
                    if (request.current) {
                      resetCatalog()
                      reconnect()
                    }
                    setReview(false)
                  }}
                >
                  {t('batchBack')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={
                    !connected ||
                    !canStart ||
                    submitting ||
                    !!deployment.error ||
                    deployment.maxFileBytes === 0
                  }
                  onClick={() => void submit()}
                >
                  {t('batchSubmit', { count: selected })}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="primary"
                disabled={!connected || !canStart || loading || selected < 1}
                onClick={() => setReview(true)}
              >
                {t('batchReview')}
              </Button>
            ))}
        </div>
      }
    >
      <div className={`${css.surface} ${css.body} ${css.batchBody}`}>
        {!connected && <p role="status">{t('parseOffline')}</p>}
        {deployment.error && (
          <p className={css.error} role="alert">
            {documentParseText(deployment.error)}
          </p>
        )}
        {error && (
          <div className={css.result}>
            <p className={css.error} role="alert">
              {documentParseText(error)}
            </p>
            <div className={css.batchControls}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!connected}
                onClick={reconnect}
              >
                {t('parseReconnect')}
              </Button>
              {choosing && !review && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!connected}
                  onClick={() => {
                    resetCatalog()
                    reconnect()
                  }}
                >
                  {t('batchReload')}
                </Button>
              )}
            </div>
          </div>
        )}
        {batch === undefined && !error && connected && <p role="status">{t('parseChecking')}</p>}
        {!canSelect && !showingResult && <p role="status">{t('parsePermission')}</p>}
        {choosing && review && library && (
          <>
            <p>{t('batchConsent', { count: selected, library: libraryName(library) })}</p>
            <dl className={css.facts}>
              <dt>{t('parseMode')}</dt>
              <dd>{t(deployment.mode === 'pro' ? 'parseModePro' : 'parseModeFree')}</dd>
            </dl>
            {deployment.maxFileBytes > 0 && (
              <p className={css.secondary}>
                {t('parseLimits', {
                  size: formatParseFileLimit(deployment.maxFileBytes),
                  pages: deployment.maxPages,
                })}
              </p>
            )}
          </>
        )}
        {choosing && !review && (
          <>
            <div className={css.batchControls}>
              <Menu
                open={libraryMenu}
                onClose={() => setLibraryMenu(false)}
                align="start"
                portal
                anchor={
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!connected || libraries === undefined}
                    aria-label={t('batchLibrary')}
                    aria-expanded={libraryMenu}
                    onClick={() => setLibraryMenu(!libraryMenu)}
                  >
                    {library ? libraryName(library) : t('batchLibrary')}{' '}
                    <IconChevronDownOutlineMedium size={13} />
                  </Button>
                }
                items={
                  libraries?.map((entry) => ({
                    id: libraryKey(entry.library),
                    label: libraryName(entry),
                  })) ?? []
                }
                selectedIds={library ? [libraryKey(library.library)] : []}
                onSelect={(id) => {
                  const next = libraries?.find((entry) => libraryKey(entry.library) === id)
                  if (next !== undefined && next !== library) {
                    resetCatalog()
                    setError(undefined)
                    setLibrary(next)
                  }
                  setLibraryMenu(false)
                }}
              />
              <Input
                type="search"
                className={css.batchSearch}
                icon={<IconSearchOutlineRegular size={14} />}
                value={query}
                maxLength={512}
                disabled={!connected || catalog === undefined}
                aria-label={t('batchFind')}
                placeholder={t('batchFind')}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setOffset(0)
                }}
              />
            </div>
            <div className={css.batchControls}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!catalog?.total || selection.all || loading}
                onClick={() => setSelection({ all: true, refs: new Set() })}
              >
                {t('batchSelectAll', { count: catalog?.total ?? 0 })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={selected === 0 && !selection.all}
                onClick={clearSelection}
              >
                {t('batchClear')}
              </Button>
              <span className={css.secondary} role="status">
                {t('batchSelected', { count: selected })}
              </span>
            </div>
            {(!catalog || loading) && !error && connected && (
              <p role="status">{t('batchLoading')}</p>
            )}
            {catalog?.rows.length === 0 && !loading && <p>{t('batchEmpty')}</p>}
            <ul ref={rows} className={css.batchRows} aria-busy={loading}>
              {catalog?.rows.map((row) => {
                const metadata = [row.authors, row.venue, row.year].filter(Boolean).join(' · ')
                const details = [metadata, row.fileLabel].filter(Boolean).join(' · ')
                return (
                  <li key={row.ref} className={css.batchRow}>
                    <Checkbox
                      className={css.batchCheck}
                      label={row.title}
                      title={row.title}
                      disabled={loading}
                      checked={selection.refs.has(row.ref) !== selection.all}
                      onChange={(checked) => toggle(row.ref, checked)}
                    />
                    {details && (
                      <p className={css.batchMetadata} title={details}>
                        {details}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
            {catalog && catalog.matching > PDF_PAGE && (
              <PageControls
                offset={offset}
                count={catalog.rows.length}
                total={catalog.matching}
                page={PDF_PAGE}
                busy={loading}
                onPage={setOffset}
                t={t}
              />
            )}
          </>
        )}
        {batch && showingResult && (
          <>
            <div className={css.batchControls} role="status">
              <StateDot
                size={14}
                state={
                  active
                    ? 'ongoing'
                    : batch.state === 'failed'
                      ? 'error'
                      : batch.failed
                        ? 'warning'
                        : batch.state === 'completed'
                          ? 'done'
                          : 'idle'
                }
              />
              <span>
                {t(
                  batch.state === 'running'
                    ? 'parseRunning'
                    : batch.state === 'stopping'
                      ? 'parseStopping'
                      : batch.state === 'completed'
                        ? 'parseCompleted'
                        : batch.state === 'cancelled'
                          ? 'parseKilled'
                          : 'batchResultFailed',
                )}
              </span>
            </div>
            <BatchProgressBar batch={batch} t={t} />
            <p role="status">
              {t('batchSummary', {
                done: batchDone(batch),
                total: batch.total,
                parsed: batch.parsed,
                reused: batch.reused,
                failed: batch.failed,
                skipped: batch.skipped,
              })}
            </p>
            {batch.current && <p>{t('batchCurrent', { title: batch.current.title })}</p>}
            {active && <p className={css.secondary}>{t('batchCloseHint')}</p>}
            {batch.error && (
              <p className={css.error} role="alert">
                {documentParseText(batch.error)}
              </p>
            )}
            <ul className={css.batchList}>
              {batch.failures.map(({ target, message }) => (
                <li key={target.ref}>
                  {target.title} · {documentParseText(message)}
                </li>
              ))}
            </ul>
            {batch.failed > FAILURE_PAGE && (
              <PageControls
                offset={failureOffset}
                count={batch.failures.length}
                total={batch.failed}
                page={FAILURE_PAGE}
                busy={!connected}
                onPage={status.setOffset}
                t={t}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function PageControls({
  offset,
  count,
  total,
  page,
  busy,
  onPage,
  t,
}: {
  offset: number
  count: number
  total: number
  page: number
  busy: boolean
  onPage(offset: number): void
  t: TranslateNS<'zotero'>
}) {
  return (
    <div className={css.batchControls}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || offset === 0}
        onClick={() => onPage(Math.max(0, offset - page))}
      >
        {t('batchPrevious')}
      </Button>
      <span className={css.secondary}>
        {t('batchPage', { first: offset + 1, last: offset + count, total })}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || offset + page >= total}
        onClick={() => onPage(offset + page)}
      >
        {t('batchNext')}
      </Button>
    </div>
  )
}
