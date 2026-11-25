import { createHash } from 'node:crypto'
import { credentialRef, normalizeApiKey } from '@deepseek-ai/dsh-credentials'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type {
  ZoteroJournalMetricsRefreshView,
  ZoteroJournalMetricsRequestView,
  ZoteroJournalMetricsView,
} from '../contract.js'
import { journalNameOf } from '../journal-metrics.js'
import { asRecord } from '../json.js'
import { awaitSharedWaiter, raceWithSignal } from '../race-signal.js'
import { readBoundedText, ResponseTooLargeError } from '../transport-bounds.js'
import { LruTtlCache } from '../ttl-cache.js'
import {
  JOURNAL_METRICS_CACHE_LIMIT,
  JournalMetricsCache,
  type ReadyJournalMetrics as Ready,
} from './journal-metrics-cache.js'

const ENDPOINT = 'https://www.easyscholar.cc/open/getPublicationRank'
const RANK_LABELS = ['oneRankText', 'twoRankText', 'threeRankText', 'fourRankText', 'fiveRankText']
const MIN_INTERVAL_MS = 500
const MAX_IN_FLIGHT = 4
const MAX_PENDING = 128
const MAX_BYTES = 128 * 1024
const QUOTA_RECHECK_MS = 60_000
const REFRESH_TIMEOUT_MS = 10 * 60_000
const FRESH_MS = 6 * 60 * 60 * 1000
const UNAVAILABLE = { status: 'unavailable' } as const
const DISABLED = { status: 'disabled' } as const
const CREDENTIAL = { status: 'credential' } as const
const QUOTA_EXCEEDED = { status: 'quotaExceeded' } as const
const INVALID_RESPONSE = { status: 'invalidResponse' } as const
const REQUEST_REJECTED = { status: 'requestRejected' } as const
interface Identity {
  readonly secret: string
  readonly digest: string
  readonly generation: number
}
interface Flight {
  readonly publicationName: string
  readonly identity: Identity
  readonly previous?: Ready
  readonly controller: AbortController
  readonly done: Promise<ZoteroJournalMetricsView>
  readonly finish: (result: ZoteroJournalMetricsView) => void
  detailWaiters: number
  waiters: number
}

function withPrevious(
  result: ZoteroJournalMetricsView,
  previous: Ready | undefined,
): ZoteroJournalMetricsView {
  return previous && result.status !== 'ready' && result.status !== 'disabled'
    ? { ...previous, refreshFailure: result.status }
    : result
}

function parseMetrics(input: unknown, secret: string): ZoteroJournalMetricsView {
  const envelope = asRecord(input)
  if (typeof envelope?.code !== 'number') return INVALID_RESPONSE
  if (envelope.code === 40006) return QUOTA_EXCEEDED
  if (envelope.code === 40005) return CREDENTIAL
  if (envelope.code === 40002 && typeof envelope.msg === 'string' && /key|密钥/i.test(envelope.msg))
    return CREDENTIAL
  if (envelope.code !== 200) return REQUEST_REJECTED
  const data = envelope.data === null ? {} : asRecord(envelope.data)
  if (data === undefined) return INVALID_RESPONSE
  const officialRank = asRecord(data.officialRank)
  const all = asRecord(officialRank?.all)
  const select = asRecord(officialRank?.select)
  const customRank = asRecord(data.customRank)
  if (
    (data.officialRank != null &&
      (!officialRank ||
        (officialRank.all === undefined && officialRank.select === undefined) ||
        (officialRank.all != null && all === undefined) ||
        (officialRank.select != null && select === undefined))) ||
    (data.customRank != null &&
      (!Array.isArray(customRank?.rankInfo) || !Array.isArray(customRank.rank)))
  )
    return INVALID_RESPONSE

  const encoded = encodeURIComponent(secret)
  const formEncoded = new URLSearchParams([['', secret]]).toString().slice(1)
  const text = (value: unknown) => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined
    const result = String(value).trim()
    return result && ![secret, encoded, formEncoded].some((key) => result.includes(key))
      ? result
      : undefined
  }
  const official = Object.entries({ ...select, ...all }).flatMap(([field, raw]) => {
    const value = text(raw)
    return text(field) && value !== undefined ? [{ field, value }] : []
  })
  const datasets = new Map<string, Record<string, unknown>>()
  const rankInfo: unknown[] = Array.isArray(customRank?.rankInfo) ? customRank.rankInfo : []
  for (const entry of rankInfo) {
    const dataset = asRecord(entry)
    if (dataset && typeof dataset.uuid === 'string') datasets.set(dataset.uuid, dataset)
  }
  const custom = new Map<string, Ready['custom'][number]>()
  const ranks: unknown[] = Array.isArray(customRank?.rank) ? customRank.rank : []
  for (const entry of ranks) {
    if (typeof entry !== 'string') continue
    const match = /^([A-Za-z0-9_-]+)&&&([1-5])$/.exec(entry)
    if (!match) continue
    const id = match[1]!
    const level = match[2]!
    const dataset = datasets.get(id)
    const label = text(dataset?.abbName)
    const value = text(dataset?.[RANK_LABELS[Number(level) - 1]!])
    if (text(id) && label !== undefined && value !== undefined) custom.set(id, { id, label, value })
  }
  return { status: 'ready', fetchedAt: Date.now(), official, custom: [...custom.values()] }
}

interface JournalMetricsDependencies {
  readonly reference: () => string | undefined
  readonly credential: (ref: ReturnType<typeof credentialRef>) => Promise<string | undefined>
  readonly fetch: (url: URL, signal: AbortSignal) => Promise<Response>
  readonly cacheDirectory?: string
  readonly onCacheWriteError?: () => void
}

/** A shared queue and cache for every panel caller of this host service. */
export class JournalMetrics {
  private reference?: string
  private credentialDigest?: string
  private generation = 0
  private disposed = false
  private readonly cache = new LruTtlCache<Ready>(JOURNAL_METRICS_CACHE_LIMIT, FRESH_MS)
  private readonly store?: JournalMetricsCache
  private readonly refreshes = new Map<
    number,
    {
      controller: AbortController
      done: Promise<ZoteroJournalMetricsRefreshView>
    }
  >()
  private readonly flights = new Map<string, Flight>()
  private readonly queued = new Set<Flight>()
  private readonly running = new Set<Promise<void>>()
  private timer?: ReturnType<typeof setTimeout>
  private nextStart = 0
  private cooldownUntil = 0
  private quotaUntil = 0

  constructor(private readonly deps: JournalMetricsDependencies) {
    if (deps.cacheDirectory) this.store = new JournalMetricsCache(deps.cacheDirectory)
  }

  sync(): string | undefined {
    const current = this.disposed ? undefined : this.deps.reference()
    if (current !== this.reference) {
      this.reference = current
      this.invalidate()
    }
    return current
  }

  credentialChanged(reference: string): void {
    if (this.sync() === reference) this.invalidate()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.invalidate()
    await Promise.allSettled([
      ...this.running,
      ...Array.from(this.refreshes.values(), ({ done }) => done),
    ])
  }

  private invalidate(): void {
    const previousGeneration = this.generation++
    this.credentialDigest = undefined
    this.cache.clear()
    this.refreshes.get(previousGeneration)?.controller.abort()
    this.quotaUntil = 0
    this.stopFlights(DISABLED)
  }

  private stopFlights(result: ZoteroJournalMetricsView): void {
    clearTimeout(this.timer)
    this.timer = undefined
    for (const flight of this.flights.values()) {
      flight.controller.abort()
      flight.finish(withPrevious(result, flight.previous))
    }
    this.flights.clear()
    this.queued.clear()
  }

  private async identity(
    signal: AbortSignal,
  ): Promise<Identity | typeof DISABLED | typeof CREDENTIAL> {
    signal.throwIfAborted()
    const reference = this.sync()
    if (reference === undefined) return DISABLED
    const generation = this.generation
    let raw: string | undefined
    try {
      raw = await raceWithSignal(this.deps.credential(credentialRef(reference)), signal)
    } catch {
      signal.throwIfAborted()
      return CREDENTIAL
    }
    signal.throwIfAborted()
    if (this.sync() !== reference || generation !== this.generation) return DISABLED
    const secret = normalizeApiKey(raw ?? '')
    if (!secret.ok) return CREDENTIAL
    const digest = createHash('sha256').update(secret.value).digest('hex')
    if (this.credentialDigest !== undefined && this.credentialDigest !== digest) this.invalidate()
    this.credentialDigest = digest
    return { secret: secret.value, digest, generation: this.generation }
  }

  async refresh(signal: AbortSignal): Promise<ZoteroJournalMetricsRefreshView> {
    const identity = await this.identity(signal)
    if ('status' in identity) return identity
    signal.throwIfAborted()
    if (identity.generation !== this.generation) return DISABLED
    if (this.refreshes.has(identity.generation)) return { status: 'running' }
    const controller = new AbortController()
    using timeout = deadline(
      AbortSignal.any([signal, controller.signal]),
      REFRESH_TIMEOUT_MS,
      'zotero/journal-metrics-refresh-timeout',
    )
    const done = this.refreshSaved(identity, timeout.signal)
    this.refreshes.set(identity.generation, { controller, done })
    try {
      const result = await done
      signal.throwIfAborted()
      return result
    } catch (error) {
      if (identity.generation !== this.generation) return DISABLED
      throw error
    } finally {
      this.refreshes.delete(identity.generation)
    }
  }

  private async refreshSaved(
    identity: Identity,
    signal: AbortSignal,
  ): Promise<ZoteroJournalMetricsRefreshView> {
    const journals = (await this.store?.journals(identity.digest, signal)) ?? []
    let refreshed = 0
    let failure: Ready['refreshFailure']
    let index = 0
    const stop = new AbortController()
    const lookupSignal = AbortSignal.any([signal, stop.signal])
    const worker = async () => {
      while (!lookupSignal.aborted) {
        const journal = journals[index++]
        if (journal === undefined) return
        if (performance.now() < this.cooldownUntil) {
          failure = 'rateLimited'
          stop.abort()
          return
        }
        const result = await this.lookupJournal(journal, false, identity, lookupSignal, true)
        if (result.status === 'disabled') {
          stop.abort()
          return
        }
        const issue = result.status === 'ready' ? result.refreshFailure : result.status
        if (issue === undefined) refreshed += 1
        else if (issue === 'credential' || issue === 'quotaExceeded' || issue === 'rateLimited') {
          failure = issue
          stop.abort()
        } else failure ??= issue
      }
    }
    await Promise.allSettled([worker(), worker()]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected' && !lookupSignal.aborted) throw result.reason
      }
    })
    if (identity.generation !== this.generation) return DISABLED
    if (signal.aborted) failure ??= 'unavailable'
    return {
      status: 'finished',
      total: journals.length,
      refreshed,
      ...(failure ? { failure } : {}),
    }
  }

  async lookup(
    request: ZoteroJournalMetricsRequestView,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ZoteroJournalMetricsView> {
    signal.throwIfAborted()
    const publicationName = journalNameOf(request.publicationName)
    if (publicationName === undefined) return UNAVAILABLE
    const identity = await this.identity(signal)
    if ('status' in identity) return identity
    return await this.lookupJournal(
      publicationName,
      request.priority === 'detail',
      identity,
      signal,
    )
  }

  private async lookupJournal(
    publicationName: string,
    detail: boolean,
    identity: Identity,
    signal: AbortSignal,
    force = false,
  ): Promise<ZoteroJournalMetricsView> {
    signal.throwIfAborted()
    let cached = this.cache.get(publicationName)
    if (!cached && this.store) {
      const saved = await raceWithSignal(this.store.read(identity.digest, publicationName), signal)
      cached = this.cache.get(publicationName) ?? saved?.result
      this.sync()
      if (identity.generation !== this.generation) return DISABLED
      if (cached && Date.now() - cached.fetchedAt < FRESH_MS)
        this.cache.set(publicationName, cached)
      if (saved && saved.publicationName === undefined) {
        await this.save(identity, publicationName, saved.result)
      }
    }
    signal.throwIfAborted()
    this.sync()
    if (identity.generation !== this.generation) return DISABLED
    if (!force && cached && Date.now() - cached.fetchedAt < FRESH_MS) return cached
    if (performance.now() < this.quotaUntil) return withPrevious(QUOTA_EXCEEDED, cached)

    let flight = this.flights.get(publicationName)
    if (!flight) {
      if (this.flights.size >= MAX_PENDING) return withPrevious(UNAVAILABLE, cached)
      let finish!: Flight['finish']
      const done = new Promise<ZoteroJournalMetricsView>((resolve) => {
        finish = resolve
      })
      flight = {
        publicationName,
        identity,
        previous: cached,
        controller: new AbortController(),
        done,
        finish,
        waiters: 0,
        detailWaiters: 0,
      }
      this.flights.set(publicationName, flight)
      this.queued.add(flight)
    }
    const task = flight
    return await awaitSharedWaiter(task.done, signal, {
      onJoin: () => {
        task.waiters += 1
        if (detail) task.detailWaiters += 1
        this.pump()
      },
      onLeave: (aborted) => {
        task.waiters -= 1
        if (detail) task.detailWaiters -= 1
        if (aborted && task.waiters === 0 && this.flights.get(publicationName) === task) {
          this.flights.delete(publicationName)
          this.queued.delete(task)
          task.controller.abort()
          task.finish(DISABLED)
          this.pump()
        }
      },
    })
  }

  private pump(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.queued.size || this.running.size >= MAX_IN_FLIGHT || this.sync() === undefined) return
    const now = performance.now()
    const delay = Math.max(this.nextStart, this.cooldownUntil) - now
    if (delay > 0) {
      this.timer = setTimeout(() => this.pump(), Math.min(Math.ceil(delay), 2_147_483_647))
      return
    }
    const queued = [...this.queued]
    const flight = queued.find((entry) => entry.detailWaiters > 0) ?? queued[0]
    if (!flight) return
    this.queued.delete(flight)
    this.nextStart = now + MIN_INTERVAL_MS
    const running = this.run(flight).finally(() => {
      this.running.delete(running)
      this.pump()
    })
    this.running.add(running)
    this.pump()
  }

  private async run(flight: Flight): Promise<void> {
    const result = await this.fetchMetrics(flight)
    if (this.flights.get(flight.publicationName) !== flight) return
    if (result.status === 'quotaExceeded') {
      this.quotaUntil = performance.now() + QUOTA_RECHECK_MS
      this.stopFlights(result)
      return
    }
    this.flights.delete(flight.publicationName)
    if (result.status === 'ready') this.cache.set(flight.publicationName, result)
    flight.finish(withPrevious(result, flight.previous))
    if (result.status === 'ready') {
      await this.save(flight.identity, flight.publicationName, result)
    }
  }

  private async save(identity: Identity, journal: string, result: Ready): Promise<void> {
    await this.store?.write(identity.digest, journal, result).catch(() => {
      this.deps.onCacheWriteError?.()
    })
  }

  private async fetchMetrics(flight: Flight): Promise<ZoteroJournalMetricsView> {
    using timeout = deadline(flight.controller.signal, 10_000, 'zotero/journal-metrics-timeout')
    try {
      const url = new URL(ENDPOINT)
      url.searchParams.set('publicationName', flight.publicationName)
      url.searchParams.set('secretKey', flight.identity.secret)
      const response = await this.deps.fetch(url, timeout.signal)
      flight.controller.signal.throwIfAborted()
      if (response.status === 429) {
        const header = response.headers.get('retry-after')?.trim()
        const retry = !header
          ? NaN
          : /^\d+$/.test(header)
            ? Number(header) * 1000
            : Date.parse(header) - Date.now()
        this.cooldownUntil = Math.max(
          this.cooldownUntil,
          performance.now() + (Number.isFinite(retry) ? Math.max(0, retry) : 30_000),
        )
        this.pump()
      }
      if (!response.ok) {
        await response.body?.cancel()
        if (response.status === 429) return { status: 'rateLimited' }
        if (response.status === 401 || response.status === 403) return { status: 'credential' }
        if (response.status >= 500) return { status: 'serviceUnavailable' }
        return response.status >= 400 ? REQUEST_REJECTED : INVALID_RESPONSE
      }
      return parseMetrics(
        JSON.parse(await readBoundedText(response, MAX_BYTES)),
        flight.identity.secret,
      )
    } catch (error) {
      // Provider errors can echo the credential-bearing URL. Send only a status.
      if (timeoutOf(timeout.signal)) return { status: 'timedOut' }
      if (error instanceof SyntaxError || error instanceof ResponseTooLargeError)
        return INVALID_RESPONSE
      return { status: 'connectionFailed' }
    }
  }
}
