/**
 * The `scholarly_verify` tool: checks reference lists against official registry records.
 * Catches fake DOIs, mismatched titles/authors/years, and retracted publications.
 * @module dsh-zotero/scholarly/tools/verify
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { mapWithConcurrency } from '../../concurrency.js'
import { ZoteroError, ZOTERO_INVALID_ARGUMENT } from '../../errors.js'
import { titleKey, titleTokens } from '../normalize.js'
import {
  crossrefMatchReference,
  lookupCrossref,
  paperFromCrossref,
  type CrossrefWork,
} from '../sources/crossref.js'
import { cleanDoi, parseYear } from '../sources/helpers.js'
import type { ScholarlyPaper } from '../types.js'
import { failureTextOf } from './failure.js'
import {
  SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR,
  toCleanJsonRecords,
  type ScholarlyToolHost,
  type ScholarlyToolOutput,
} from './common.js'

/**
 * What one reference check concluded.
 *
 * Four values, because four different facts must stay distinguishable:
 *
 * - `verified`: the registry holds the work and every compared field agrees.
 * - `check`: the registry holds the work, but a field disagrees (or it is retracted).
 * - `not_found`: the registry answered and holds no such work.
 * - `unverified`: the registry could not be reached, so nothing is known.
 *
 * Collapsing `unverified` into `not_found` would report a rate limit or a
 * timeout as a fabricated citation, which is exactly the reading this tool
 * exists to prevent.
 */
export type VerificationVerdict = 'verified' | 'check' | 'not_found' | 'unverified'

export interface ReferenceCheckResult {
  raw: string
  verdict: VerificationVerdict
  doi?: string
  foundPaper?: ScholarlyPaper
  notes: string[]
}

export function parseReferenceSnippet(text: string): {
  doi?: string
  year?: number
  firstAuthor?: string
} {
  const doiMatch = /(10\.\d{4,9}\/\S+)/i.exec(text)
  const doi = doiMatch ? cleanDoi(doiMatch[1]) : undefined
  const year = parseYear(text)

  const stripped = text.trim().replace(/^(?:\[\d+\]|\d+\.?)\s*/, '')
  const authorMatch = /^([A-Z\p{L}][\p{L}'-]+)/u.exec(stripped)
  const firstAuthor = authorMatch ? authorMatch[1].toLowerCase() : undefined

  return { doi, year, firstAuthor }
}

/**
 * Compare one parsed reference against the registry record it matched, pushing
 * a note per discrepancy. Returns false as soon as one is found.
 *
 * A DOI path and a search path hold the same work to different bars. A DOI
 * names one specific record, so a title mismatch means the DOI was misquoted,
 * while a search hit only has to be the closest match.
 * @param parsed - the fields read out of the reference snippet.
 * @param paper - the registry record.
 * @param rawReference - the reference text, for token comparison.
 * @param notes - the note list, appended in place.
 * @param source - 'doi' or 'search', which bar to apply.
 * @returns true when the reference and the record agree.
 */
function checkDiscrepancies(
  parsed: ReturnType<typeof parseReferenceSnippet>,
  paper: ScholarlyPaper,
  rawReference: string,
  notes: string[],
  source: 'doi' | 'search',
): boolean {
  if (paper.retracted) {
    notes.push(
      source === 'doi'
        ? 'CRITICAL: This paper has been officially RETRACTED.'
        : 'CRITICAL: This matched paper has been RETRACTED.',
    )
    return false
  }

  const queryTokens = titleTokens(rawReference)
  const paperTokens = titleTokens(paper.title)
  let tokenMatches = 0
  for (const t of paperTokens) {
    if (queryTokens.has(t)) tokenMatches++
  }
  // How much of the paper's title the reference covers; a short title makes a
  // single shared token meaningful, a long one does not.
  const titleCoverage = paperTokens.size > 0 ? tokenMatches / paperTokens.size : 0

  if (source === 'doi') {
    // A DOI names one record. If the title shares almost nothing with it, the
    // reference quoted the wrong DOI, and that is worth saying plainly.
    const titleMismatch =
      (titleCoverage < 0.35 && paperTokens.size >= 3) ||
      (paperTokens.size < 3 && tokenMatches === 0)
    if (titleMismatch) {
      notes.push(`DOI mismatch: DOI ${parsed.doi} belongs to a different paper ("${paper.title}").`)
      return false
    }
  } else {
    // A search hit only needs to be the closest match: substring containment
    // plus shared tokens, so a truncated or differently worded reference still
    // counts as the same paper.
    const isTitleMatch =
      titleKey(rawReference).includes(titleKey(paper.title)) ||
      (titleCoverage >= 0.5 && tokenMatches >= Math.min(2, paperTokens.size))
    if (!isTitleMatch) {
      notes.push(`Closest match differed significantly ("${paper.title}").`)
      return false
    }
  }

  if (parsed.year && paper.year && Math.abs(parsed.year - paper.year) > 1) {
    notes.push(`Year discrepancy: reference says ${parsed.year}, registry says ${paper.year}.`)
    return false
  }

  if (parsed.firstAuthor && paper.authors.length > 0) {
    const authorMatch = paper.authors.some((a) => a.toLowerCase().includes(parsed.firstAuthor!))
    if (!authorMatch) {
      notes.push(
        `Author discrepancy: reference indicates author "${parsed.firstAuthor}", but registry lists "${paper.authors[0]}".`,
      )
      return false
    }
  }

  return true
}

export async function verifySingleReference(
  rawReference: string,
  host: ScholarlyToolHost,
  signal?: AbortSignal,
): Promise<ReferenceCheckResult> {
  const parsed = parseReferenceSnippet(rawReference)
  const notes: string[] = []

  let record: CrossrefWork | undefined

  if (parsed.doi) {
    try {
      const paper = await lookupCrossref(parsed.doi, host.http, host.keys(), signal)
      if (paper) {
        const ok = checkDiscrepancies(parsed, paper, rawReference, notes, 'doi')
        return {
          raw: rawReference,
          verdict: ok ? 'verified' : 'check',
          doi: parsed.doi,
          foundPaper: paper,
          notes,
        }
      }
    } catch (error) {
      // `lookupCrossref` normalizes a 404 to `undefined` and rethrows everything
      // else, so a throw here is a transport or registry failure, never proof
      // that the DOI does not exist.
      notes.push(`Crossref lookup failed for ${parsed.doi}: ${failureTextOf(error)}`)
      return { raw: rawReference, verdict: 'unverified', doi: parsed.doi, notes }
    }
  }

  // If no DOI or DOI not found: search Crossref bibliographic match
  try {
    const hits = await crossrefMatchReference(rawReference, 3, host.http, host.keys(), signal)
    record = hits[0]
  } catch (error) {
    notes.push(`Crossref search failed: ${failureTextOf(error)}`)
    return { raw: rawReference, verdict: 'unverified', notes }
  }

  if (!record || !record.title?.[0]) {
    notes.push('No matching publication record found in Crossref.')
    return { raw: rawReference, verdict: 'not_found', notes }
  }

  const paper = paperFromCrossref(record)
  const ok = checkDiscrepancies(parsed, paper, rawReference, notes, 'search')
  if (ok && paper.doi && !parsed.doi) {
    notes.push(`Found with DOI: ${paper.doi}.`)
  }
  return {
    raw: rawReference,
    verdict: ok ? 'verified' : 'check',
    doi: paper.doi,
    foundPaper: paper,
    notes,
  }
}

/** Badge shown for each verdict: the label a reader quotes back. */
const VERDICT_BADGE: Record<VerificationVerdict, string> = {
  verified: 'VERIFIED',
  check: 'CHECK',
  not_found: 'NOT FOUND',
  unverified: 'UNVERIFIED',
}

export function formatVerificationResult(result: ReferenceCheckResult, index: number): string {
  const badge = VERDICT_BADGE[result.verdict]

  const lines = [`[${index}] ${badge} ${result.raw.slice(0, 160)}`]
  if (result.doi) lines.push(`    DOI: https://doi.org/${result.doi}`)
  if (result.foundPaper?.title) lines.push(`    Registry Title: ${result.foundPaper.title}`)
  if (result.foundPaper?.authors.length) {
    lines.push(`    Registry Authors: ${result.foundPaper.authors.slice(0, 3).join(', ')}`)
  }
  if (result.notes.length > 0) {
    for (const note of result.notes) lines.push(`    • ${note}`)
  }
  return lines.join('\n')
}

export function createScholarlyVerifyTool(host: ScholarlyToolHost): ToolDefinition {
  return defineTool({
    name: 'scholarly_verify',
    description: [
      'Audit and verify a list of academic references or citations against Crossref official registry records.',
      'Checks for phantom/hallucinated DOIs, title discrepancies, author/year mismatches, and retracted papers.',
      'Accepts raw bibliographic citation strings (APA, MLA, IEEE, etc.) or DOIs. Verifies up to 40 references.',
    ].join(' '),
    parameters: {
      references: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'List of reference citation strings (up to 40) to verify.',
      },
    },
    output: SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR,
    isConcurrencySafe: () => true,
    timeoutMs: 240_000,
    async execute(args, exec): Promise<ScholarlyToolOutput> {
      const input = args as { references: string[] }
      const list = input.references
        .map((r) => r.trim())
        .filter(Boolean)
        .slice(0, 40)
      if (list.length === 0) {
        throw new ZoteroError('references parameter cannot be empty.', ZOTERO_INVALID_ARGUMENT)
      }

      const counts: Record<VerificationVerdict, number> = {
        verified: 0,
        check: 0,
        not_found: 0,
        unverified: 0,
      }

      const results = await mapWithConcurrency(
        list,
        5,
        async (refStr) => {
          try {
            return await verifySingleReference(refStr, host, exec.signal)
          } catch (error) {
            if (exec.signal.aborted) throw error
            // An unexpected failure while checking one reference says nothing
            // about the work itself, so it is `unverified`, never `not_found`.
            return {
              raw: refStr,
              verdict: 'unverified' as const,
              notes: [`Verification error: ${failureTextOf(error)}`],
            }
          }
        },
        { signal: exec.signal },
      )

      for (const checked of results) counts[checked.verdict] += 1

      const summary =
        `Reference verification summary: ${counts.verified} verified, ${counts.check} to check, ` +
        `${counts.not_found} not found, ${counts.unverified} unverified (of ${list.length} checked).\n` +
        'VERIFIED: official record exists and matches.\n' +
        'CHECK: record found but discrepancies detected (mismatched DOI/year or retracted).\n' +
        'NOT FOUND: no matching record found in official registries; verify before using.\n' +
        'UNVERIFIED: the registry could not be reached; nothing is known about this entry.'

      const lines = results.map((r, i) => formatVerificationResult(r, i + 1)).join('\n\n')

      return {
        text: `${summary}\n\n${lines}`,
        checks: toCleanJsonRecords(results),
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Verify references',
      rawInput: `${((args as { references?: string[] }).references ?? []).length} items`,
      kind: 'search',
    }),
  })
}
