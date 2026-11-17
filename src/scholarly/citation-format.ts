/**
 * Structural and identity validation for citation bodies returned by DOI
 * content negotiation.
 *
 * A citation is accepted when the body parses as the requested format and
 * names the requested DOI. Other responses become failed items with reasons.
 * @module dsh-zotero/scholarly/citation-format
 */

import { cleanDoi } from './sources/helpers.js'

/** The citation formats this tool asks a registration agency for. */
export type CiteFormat = 'bibtex' | 'ris' | 'csljson' | 'text'

export type CitationValidation =
  { ok: true; value: string; resolvedDoi: string } | { ok: false; reason: string }

/** Compare DOIs case-insensitively after the same cleanup the registry output uses. */
export function normalizeDoiForCompare(value: string): string | undefined {
  return cleanDoi(value)?.toLowerCase()
}

function requestedOf(requestedDoi: string): string | undefined {
  return normalizeDoiForCompare(requestedDoi)
}

function doiMismatch(
  format: string,
  responseDoi: string,
  requestedDoi: string,
): CitationValidation {
  return {
    ok: false,
    reason: `the ${format} record names DOI ${responseDoi}, not the requested ${requestedDoi}`,
  }
}

function emptyBody(): CitationValidation {
  return { ok: false, reason: 'the registry returned an empty body' }
}

/** CSL-JSON: one object (or a one-element array) with a title and the requested DOI. */
export function validateCslJson(body: string, requestedDoi: string): CitationValidation {
  const text = body.trim()
  if (!text) return emptyBody()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'the response is not valid JSON' }
  }

  if (Array.isArray(parsed) && parsed.length !== 1) {
    return {
      ok: false,
      reason: `expected one CSL-JSON record for one DOI, got ${parsed.length}`,
    }
  }
  const record = Array.isArray(parsed) ? parsed[0] : parsed
  if (record === null || typeof record !== 'object') {
    return { ok: false, reason: 'the response is not a CSL-JSON record' }
  }

  const item = record as Record<string, unknown>
  const rawDoi =
    typeof item['DOI'] === 'string'
      ? item['DOI']
      : typeof item['doi'] === 'string'
        ? item['doi']
        : undefined
  const responseDoi = rawDoi ? normalizeDoiForCompare(rawDoi) : undefined
  if (!responseDoi) return { ok: false, reason: 'the CSL-JSON record has no DOI' }

  const requested = requestedOf(requestedDoi)
  if (!requested || responseDoi !== requested) {
    return doiMismatch('CSL-JSON', responseDoi, requestedDoi)
  }

  const title = item['title']
  const hasTitle =
    (typeof title === 'string' && title.trim().length > 0) ||
    (Array.isArray(title) &&
      title.some((value) => typeof value === 'string' && value.trim().length > 0))
  if (!hasTitle) return { ok: false, reason: 'the CSL-JSON record has no title' }

  return { ok: true, value: text, resolvedDoi: responseDoi }
}

function hasBalancedBraces(value: string): boolean {
  let depth = 0
  for (const char of value) {
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth < 0) return false
    }
  }
  return depth === 0
}

/** BibTeX: an `@type{...}` entry carrying the requested DOI field. */
export function validateBibtex(body: string, requestedDoi: string): CitationValidation {
  const text = body.trim()
  if (!text) return emptyBody()
  if (text.startsWith('<')) {
    return { ok: false, reason: 'the response is markup, not a BibTeX entry' }
  }

  const start = text.indexOf('@')
  if (start < 0) return { ok: false, reason: 'the response contains no BibTeX entry' }
  const entry = text.slice(start).trim()
  if (!/^@[a-zA-Z]+\s*[{(]/.test(entry)) {
    return { ok: false, reason: 'the response does not start with a BibTeX entry' }
  }
  if (!hasBalancedBraces(entry)) {
    return { ok: false, reason: 'the BibTeX entry has unbalanced braces' }
  }

  // The DOI field may sit on any line; a quoted or braced value is equally valid.
  const doiField = /\bdoi\s*=\s*[{"]\s*([^}"]+?)\s*[}"]/i.exec(entry)
  const responseDoi = doiField ? normalizeDoiForCompare(doiField[1]!) : undefined
  if (!responseDoi) {
    return {
      ok: false,
      reason: 'the BibTeX entry has no DOI field to confirm its identity',
    }
  }

  const requested = requestedOf(requestedDoi)
  if (!requested || responseDoi !== requested) {
    return doiMismatch('BibTeX', responseDoi, requestedDoi)
  }

  return { ok: true, value: entry.replace(/^\s+@/, '@'), resolvedDoi: responseDoi }
}

/** RIS: `TY  - <type>` ... `DO  - <doi>` ... `ER  -`. */
export function validateRis(body: string, requestedDoi: string): CitationValidation {
  const text = body.trim()
  if (!text) return emptyBody()
  if (text.startsWith('<')) {
    return { ok: false, reason: 'the response is markup, not a RIS record' }
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  if (!/^TY {1,2}- \S/.test(lines[0]!)) {
    return { ok: false, reason: 'the response does not start with a RIS TY field' }
  }
  if (!/^ER {1,2}-(?:\s*)$/.test(lines.at(-1)!)) {
    return { ok: false, reason: 'the response has no RIS ER terminator' }
  }

  const doiLine = lines.find((line) => /^DO {1,2}- /.test(line))
  const responseDoi = doiLine
    ? normalizeDoiForCompare(doiLine.replace(/^DO {1,2}- /, ''))
    : undefined
  if (!responseDoi) {
    return { ok: false, reason: 'the RIS record has no DO field to confirm its identity' }
  }

  const requested = requestedOf(requestedDoi)
  if (!requested || responseDoi !== requested) {
    return doiMismatch('RIS', responseDoi, requestedDoi)
  }

  return { ok: true, value: lines.join('\n'), resolvedDoi: responseDoi }
}

/** Formatted text: non-empty prose, never an HTML or plain error page. */
export function validateFormattedText(body: string, requestedDoi: string): CitationValidation {
  const text = body.trim()
  if (!text) return emptyBody()
  if (
    /^<!doctype/i.test(text) ||
    /<html[\s>]/i.test(text) ||
    /<body[\s>]/i.test(text) ||
    /^<[a-z!/?]/i.test(text)
  ) {
    return { ok: false, reason: 'the response is HTML, not a formatted citation' }
  }
  if (text.length < 20) {
    return { ok: false, reason: 'the response is too short to be a formatted citation' }
  }
  if (!/[\p{L}\p{N}]/u.test(text)) {
    return { ok: false, reason: 'the response contains no citation text' }
  }
  if (
    text.length < 300 &&
    /^(?:error|not found|forbidden|access denied|service unavailable|rate limit)\b/i.test(text)
  ) {
    return { ok: false, reason: 'the response is an error page, not a formatted citation' }
  }

  const resolvedDoi = requestedOf(requestedDoi)
  if (!resolvedDoi) {
    return { ok: false, reason: `the requested identifier ${requestedDoi} is not a DOI` }
  }
  return { ok: true, value: text, resolvedDoi }
}

/** Validate one response against the format that was requested. */
export function validateCitation(
  format: CiteFormat,
  body: string,
  requestedDoi: string,
): CitationValidation {
  switch (format) {
    case 'csljson':
      return validateCslJson(body, requestedDoi)
    case 'bibtex':
      return validateBibtex(body, requestedDoi)
    case 'ris':
      return validateRis(body, requestedDoi)
    case 'text':
      return validateFormattedText(body, requestedDoi)
  }
}
