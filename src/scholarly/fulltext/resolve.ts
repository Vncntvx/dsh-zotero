/**
 * Lawful Open Access full-text resolver.
 *
 * Tries, in order: arXiv HTML -> ar5iv HTML -> the arXiv PDF; PMC JATS XML via
 * Europe PMC; then an open-access PDF located through OpenAlex, Unpaywall, or
 * Semantic Scholar. Every attempt records why it failed, so the terminal error
 * can name the causes instead of asserting "likely a paywall" — a 429, an
 * oversized PDF, and an absent copy are three different facts.
 * @module dsh-zotero/scholarly/fulltext/resolve
 */

import { errorMessageOf } from '../../errors.js'
import { extractArxivId } from '../sources/arxiv.js'
import { cleanDoi } from '../sources/helpers.js'
import { lookupOpenAlex } from '../sources/openalex.js'
import { fetchPmcFullTextXml, lookupEuropePmc } from '../sources/pmc.js'
import { lookupSemanticScholar } from '../sources/semanticscholar.js'
import type { ScholarlyHttp } from '../transport/http.js'
import type { ScholarlyKeys } from '../types.js'
import type { FullTextRecord, ScholarlyTextStore } from './store.js'
import { arxivHtmlToMarkdown, extractPdfText, jatsToMarkdown } from './markup.js'

export type PaperIdentifier =
  | { kind: 'arxiv'; id: string }
  | { kind: 'doi'; id: string }
  | { kind: 'pmid'; id: string }
  | { kind: 'pmcid'; id: string }
  | { kind: 'url'; id: string }

export function parsePaperIdentifier(raw: string): PaperIdentifier | undefined {
  const text = raw.trim()

  const arxiv = extractArxivId(text)
  if (arxiv) return { kind: 'arxiv', id: arxiv }

  const pmcMatch =
    /^(?:PMCID:\s*)?(PMC\d+)$/i.exec(text)?.[1] ??
    /(?:ncbi\.nlm\.nih\.gov|europepmc\.org)\/.*?(PMC\d+)/i.exec(text)?.[1]
  if (pmcMatch) return { kind: 'pmcid', id: pmcMatch.toUpperCase() }

  const pmidMatch =
    /^(?:PMID:\s*)?(\d{4,9})$/i.exec(text)?.[1] ??
    /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i.exec(text)?.[1]
  if (pmidMatch) return { kind: 'pmid', id: pmidMatch }

  const doi = cleanDoi(text)
  if (doi) return { kind: 'doi', id: doi }

  if (/^https?:\/\/\S+$/i.test(text)) return { kind: 'url', id: text }

  return undefined
}

/**
 * The OpenAlex lookup id for a parsed paper identifier.
 *
 * `scholarly_get` and `scholarly_citations` both need this spelling, and it
 * is the one place the arXiv-as-DOI convention is stated: OpenAlex holds an
 * arXiv preprint under `doi:10.48550/arXiv.<id>`, so the resolver that maps
 * an identifier to an index id is the same one the tools route through.
 * @param id - the parsed identifier.
 * @returns the OpenAlex id, or undefined for kinds it cannot address.
 */
export function openAlexIdOf(id: PaperIdentifier): string | undefined {
  switch (id.kind) {
    case 'arxiv':
      return `doi:10.48550/arXiv.${id.id}`
    case 'doi':
      return `doi:${id.id}`
    case 'pmid':
      return `pmid:${id.id}`
    default:
      return undefined
  }
}

/** Why one PDF attempt produced no readable text. */
type PdfFailure = 'not-a-pdf' | 'too-short' | 'fetch' | 'parse'

/** Outcome of one PDF attempt: text, or the reason it yielded none. */
type PdfOutcome =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'none'; readonly reason: PdfFailure; readonly detail?: string }

/**
 * Fetch and extract one PDF.
 *
 * Every failure is named. The caller composes the terminal message from these
 * reasons, so "the host rejected us" and "the PDF had no extractable text"
 * never collapse into one claim.
 * @param url - the PDF address.
 * @param http - the scholarly transport.
 * @param signal - caller cancellation.
 * @returns the extracted text or a classified reason.
 */
async function fetchPdfText(
  url: string,
  http: ScholarlyHttp,
  signal?: AbortSignal,
): Promise<PdfOutcome> {
  let bytes: Uint8Array
  try {
    bytes = await http.bytes(url, {
      signal,
      timeoutMs: 60_000,
      retries: 0,
      allowPublicPdf: true,
      headers: { accept: 'application/pdf,*/*' },
    })
  } catch (error) {
    return { kind: 'none', reason: 'fetch', detail: errorMessageOf(error) }
  }

  // PDF magic bytes: %PDF
  if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return { kind: 'none', reason: 'not-a-pdf', detail: 'response body is not a PDF' }
  }

  let extracted: string
  try {
    extracted = await extractPdfText(bytes)
  } catch (error) {
    return { kind: 'none', reason: 'parse', detail: errorMessageOf(error) }
  }

  if (extracted.replace(/\[page \d+\]/g, '').trim().length < 500) {
    return { kind: 'none', reason: 'too-short', detail: 'no extractable text' }
  }
  return { kind: 'text', text: extracted }
}

/**
 * One attempt's outcome: a record, or the reason it produced none.
 * Reasons accumulate so the terminal error can name every route that failed.
 */
type AttemptOutcome =
  | { readonly kind: 'record'; readonly record: FullTextRecord }
  | { readonly kind: 'none'; readonly reason: string }

/**
 * Try one HTML route and convert it to Markdown.
 * @param url - the HTML address.
 * @param http - the scholarly transport.
 * @param label - how this route is named in a failure reason.
 * @param signal - caller cancellation.
 * @returns a record, or the named reason it failed.
 */
async function tryHtmlRoute(
  url: string,
  http: ScholarlyHttp,
  label: string,
  signal?: AbortSignal,
): Promise<AttemptOutcome> {
  let html: string
  try {
    html = await http.text(url, { signal, timeoutMs: 35_000, retries: 0 })
  } catch (error) {
    return { kind: 'none', reason: `${label}: ${errorMessageOf(error)}` }
  }
  const markdown = arxivHtmlToMarkdown(html)
  if (markdown === undefined) {
    return { kind: 'none', reason: `${label}: no article body found` }
  }
  return {
    kind: 'record',
    record: { text: markdown, source: label, structured: true, url },
  }
}

/**
 * Resolve an arXiv identifier through HTML, ar5iv, then the PDF.
 * @param id - the arXiv identifier.
 * @param http - the scholarly transport.
 * @param signal - caller cancellation.
 * @returns a record, or the accumulated reasons every route failed.
 */
async function resolveArxivFullText(
  id: string,
  http: ScholarlyHttp,
  signal?: AbortSignal,
): Promise<{ record: FullTextRecord } | { reasons: string[] }> {
  const reasons: string[] = []

  const html = await tryHtmlRoute(
    `https://arxiv.org/html/${id}`,
    http,
    "arXiv's HTML version (LaTeXML)",
    signal,
  )
  if (html.kind === 'record') return { record: html.record }
  reasons.push(html.reason)

  const ar5iv = await tryHtmlRoute(
    `https://ar5iv.labs.arxiv.org/html/${id}`,
    http,
    "ar5iv's HTML version",
    signal,
  )
  if (ar5iv.kind === 'record') return { record: ar5iv.record }
  reasons.push(ar5iv.reason)

  const pdfUrl = `https://arxiv.org/pdf/${id}`
  const pdf = await fetchPdfText(pdfUrl, http, signal)
  if (pdf.kind === 'text') {
    return {
      record: { text: pdf.text, source: 'the arXiv PDF', structured: false, url: pdfUrl },
    }
  }
  reasons.push(`arXiv PDF: ${pdf.reason}${pdf.detail === undefined ? '' : ` (${pdf.detail})`}`)

  return { reasons }
}

export async function resolveScholarlyFullText(
  target: PaperIdentifier,
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  store?: ScholarlyTextStore,
  signal?: AbortSignal,
): Promise<FullTextRecord> {
  const cacheKey = `${target.kind}-${target.id}`
  const reasons: string[] = []

  if (store !== undefined) {
    const cached = await store.get(cacheKey)
    if (cached.kind === 'hit') return cached.record
    if (cached.kind === 'corrupt') {
      // A corrupt entry is evicted and re-fetched; it is a fact worth naming,
      // not a silent miss.
      reasons.push(`cache: evicted an unusable entry (${cached.reason})`)
    }
  }

  /**
   * Persist one record. A store that refuses the write must not fail the read
   * it served: the text is in hand, so the cache is an optimization whose
   * failure leaves a record behind for diagnostics, not a lost answer.
   */
  const remember = async (record: FullTextRecord): Promise<FullTextRecord> => {
    if (store !== undefined) {
      try {
        await store.set(cacheKey, record)
      } catch (error) {
        reasons.push(`cache: write failed (${errorMessageOf(error)})`)
      }
    }
    return record
  }

  // 1. arXiv directly
  if (target.kind === 'arxiv') {
    const resolved = await resolveArxivFullText(target.id, http, signal)
    if ('record' in resolved) return await remember(resolved.record)
    throw new Error(
      `arXiv has no readable copy of ${target.id} right now. Tried: ${resolved.reasons.join('; ')}.`,
    )
  }

  // 2. Direct PDF URL
  if (target.kind === 'url') {
    const pdf = await fetchPdfText(target.id, http, signal)
    if (pdf.kind === 'text') {
      return await remember({
        text: pdf.text,
        source: 'the PDF at that URL',
        structured: false,
        url: target.id,
      })
    }
    throw new Error(
      `That URL did not yield readable PDF text (${pdf.reason}${
        pdf.detail === undefined ? '' : `: ${pdf.detail}`
      }).`,
    )
  }

  // 3. DOI / PMID / PMCID resolution
  let pmcid: string | undefined = target.kind === 'pmcid' ? target.id : undefined
  let doi: string | undefined = target.kind === 'doi' ? target.id : undefined

  // Check Europe PMC
  let epmc: Awaited<ReturnType<typeof lookupEuropePmc>>
  try {
    epmc = await lookupEuropePmc(
      target.kind === 'doi'
        ? { doi: target.id }
        : target.kind === 'pmid'
          ? { pmid: target.id }
          : { pmcid: target.id },
      http,
      keys,
      signal,
    )
  } catch (error) {
    epmc = undefined
    reasons.push(`Europe PMC lookup: ${errorMessageOf(error)}`)
  }

  if (epmc !== undefined) {
    if (pmcid === undefined && epmc.pmcid !== undefined) pmcid = epmc.pmcid
    if (doi === undefined && epmc.doi !== undefined) doi = epmc.doi
  }

  // If PMC JATS XML is available, this is the highest-priority structured source
  if (pmcid !== undefined) {
    let xml: string | undefined
    try {
      xml = await fetchPmcFullTextXml(pmcid, http, signal)
    } catch (error) {
      reasons.push(`PMC full text (${pmcid}): ${errorMessageOf(error)}`)
    }
    if (xml !== undefined) {
      const markdown = jatsToMarkdown(xml)
      if (markdown !== undefined) {
        return await remember({
          text: markdown,
          source: `PubMed Central (${pmcid})`,
          structured: true,
          url: `https://europepmc.org/article/PMC/${pmcid}`,
        })
      }
      reasons.push(`PMC full text (${pmcid}): JATS XML carried no article body`)
    }
  }

  // Candidate open-access PDFs, in discovery order
  const candidatePdfUrls: Array<{ url: string; from: string }> = []
  if (epmc?.pdfUrl !== undefined) candidatePdfUrls.push({ url: epmc.pdfUrl, from: 'Europe PMC' })

  const attemptedArxivIds = new Set<string>()

  if (doi !== undefined) {
    // OpenAlex may name a preprint that carries the same work
    let work: Awaited<ReturnType<typeof lookupOpenAlex>>
    try {
      work = await lookupOpenAlex(`doi:${doi}`, http, keys, signal)
    } catch (error) {
      work = undefined
      reasons.push(`OpenAlex lookup: ${errorMessageOf(error)}`)
    }
    if (work !== undefined) {
      const preprintId = work.arxiv ?? (work.pdfUrl ? extractArxivId(work.pdfUrl) : undefined)
      if (preprintId !== undefined) {
        attemptedArxivIds.add(preprintId)
        const preprint = await resolveArxivFullText(preprintId, http, signal)
        if ('record' in preprint) {
          return await remember({
            ...preprint.record,
            source: `${preprint.record.source} (arXiv:${preprintId}, preprint of this paper)`,
          })
        }
        reasons.push(`preprint arXiv:${preprintId}: ${preprint.reasons.join('; ')}`)
      }
      if (work.pdfUrl !== undefined && !candidatePdfUrls.some((c) => c.url === work.pdfUrl)) {
        candidatePdfUrls.push({ url: work.pdfUrl, from: 'OpenAlex' })
      }
    }

    if (keys?.email !== undefined) {
      try {
        const oa = await http.json<{
          best_oa_location?: { url_for_pdf?: string | null } | null
          oa_locations?: Array<{ url_for_pdf?: string | null }>
        }>(
          `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(
            keys.email,
          )}`,
          { signal, timeoutMs: 25_000 },
        )
        const pdf = oa.best_oa_location?.url_for_pdf
        if (pdf !== undefined && pdf !== null && !candidatePdfUrls.some((c) => c.url === pdf)) {
          candidatePdfUrls.push({ url: pdf, from: 'Unpaywall' })
        }
      } catch (error) {
        reasons.push(`Unpaywall lookup: ${errorMessageOf(error)}`)
      }
    }

    if (candidatePdfUrls.length === 0) {
      let s2: Awaited<ReturnType<typeof lookupSemanticScholar>>
      try {
        s2 = await lookupSemanticScholar(`DOI:${doi}`, http, keys, signal)
      } catch (error) {
        s2 = undefined
        reasons.push(`Semantic Scholar lookup: ${errorMessageOf(error)}`)
      }
      if (s2?.pdfUrl !== undefined && !candidatePdfUrls.some((c) => c.url === s2.pdfUrl)) {
        candidatePdfUrls.push({ url: s2.pdfUrl, from: 'Semantic Scholar' })
      }
    }
  }

  // Iterate the discovered PDF addresses
  for (const candidate of candidatePdfUrls.slice(0, 4)) {
    const arxivPreprint = extractArxivId(candidate.url)
    if (arxivPreprint !== undefined && !attemptedArxivIds.has(arxivPreprint)) {
      attemptedArxivIds.add(arxivPreprint)
      const preprint = await resolveArxivFullText(arxivPreprint, http, signal)
      if ('record' in preprint) {
        return await remember({
          ...preprint.record,
          source: `${preprint.record.source} (found via ${candidate.from})`,
        })
      }
      reasons.push(`arXiv:${arxivPreprint} via ${candidate.from}: ${preprint.reasons.join('; ')}`)
      continue
    }

    const pdf = await fetchPdfText(candidate.url, http, signal)
    if (pdf.kind === 'text') {
      return await remember({
        text: pdf.text,
        source: `an open-access PDF (found via ${candidate.from})`,
        structured: false,
        url: candidate.url,
      })
    }
    reasons.push(
      `open-access PDF via ${candidate.from}: ${pdf.reason}${
        pdf.detail === undefined ? '' : ` (${pdf.detail})`
      }`,
    )
  }

  const tried =
    reasons.length === 0 ? 'no route was available for this identifier' : reasons.join('; ')
  throw new Error(
    `No open-access full text found for ${target.id}. Tried: ${tried}. ` +
      `If a route above reports a transport failure, the copy may exist but be unreachable right now — ` +
      `retry before concluding it is paywalled. ` +
      `If the user has it in their local Zotero library, read it with zotero_retrieve; ` +
      `otherwise work from the abstract (scholarly_get) and say plainly that no open copy was reachable.`,
  )
}
