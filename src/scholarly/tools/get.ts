/**
 * The `scholarly_get` tool: looks up a single paper by identifier or title across all indexes.
 * @module dsh-zotero/scholarly/tools/get
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { bestIdentifierOf, formatPaperDetail, fuseRankedLists } from '../fusion.js'
import { parsePaperIdentifier } from '../fulltext/resolve.js'
import { lookupArxiv } from '../sources/arxiv.js'
import { lookupCrossref } from '../sources/crossref.js'
import { lookupOpenAlex, searchOpenAlex } from '../sources/openalex.js'
import { lookupEuropePmc } from '../sources/pmc.js'
import { lookupSemanticScholar } from '../sources/semanticscholar.js'
import { titleKey } from '../normalize.js'
import type { ScholarlyPaper } from '../types.js'
import { attachLibraryStatus } from '../zotero-link.js'
import { SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR, type ScholarlyToolHost } from './search.js'

export function createScholarlyGetTool(host: ScholarlyToolHost): ToolDefinition {
  return defineTool({
    name: 'scholarly_get',
    description:
      'Look up one scholarly paper by DOI, arXiv ID, PMID, PMCID, URL, or exact title. ' +
      'Merges metadata across OpenAlex, Crossref, arXiv, Semantic Scholar, and Europe PMC ' +
      'into full abstract, authors, venue, citations, open-access status, and retraction checks.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description:
          'DOI (e.g. 10.1038/nature1234), arXiv ID (e.g. 2301.00001), PMID, PMCID, URL, or exact title.',
      },
    },
    output: SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR,
    isConcurrencySafe: () => true,
    timeoutMs: 60_000,
    async execute(args, exec): Promise<{ text: string }> {
      const raw = (args as { id: string }).id.trim()
      if (!raw) throw new Error('id parameter cannot be empty.')

      const id = parsePaperIdentifier(raw)
      const keys = host.keys()
      const foundLists: Array<{ sourceId: string; papers: ScholarlyPaper[] }> = []

      const addHit = (sourceId: string, paper?: ScholarlyPaper): void => {
        if (paper && paper.title) {
          foundLists.push({ sourceId, papers: [paper] })
        }
      }

      if (id !== undefined && id.kind === 'url') {
        // A bare URL names a resource, not a work: searching an index for the
        // URL string as a *title* returns whatever happens to match, and the
        // result then reads like an exact hit. Point at the tool that reads a
        // URL instead of guessing.
        throw new Error(
          'A URL has no scholarly record to look up. Use scholarly_read with that URL to read its text, ' +
            'or pass a DOI, arXiv ID, PMID, or PMCID instead.',
        )
      }

      if (id === undefined) {
        // Not a structured ID: search OpenAlex for closest match by title.
        const hits = await searchOpenAlex(
          { query: raw, limit: 3, sort: 'relevance' },
          host.http,
          keys,
          exec.signal,
        ).catch(() => [])

        const wanted = titleKey(raw)
        const exact = hits.find((h) => titleKey(h.title) === wanted)
        addHit('openalex', exact ?? hits[0])
      } else if (id.kind === 'arxiv') {
        const [arx, s2, oa] = await Promise.all([
          lookupArxiv(id.id, host.http, exec.signal).catch(() => undefined),
          lookupSemanticScholar(`ARXIV:${id.id}`, host.http, keys, exec.signal).catch(
            () => undefined,
          ),
          lookupOpenAlex(`doi:10.48550/arXiv.${id.id}`, host.http, keys, exec.signal).catch(
            () => undefined,
          ),
        ])
        addHit('arxiv', arx)
        addHit('semanticscholar', s2)
        addHit('openalex', oa)
      } else if (id.kind === 'doi') {
        const [cr, oa, s2, pmc] = await Promise.all([
          lookupCrossref(id.id, host.http, keys, exec.signal).catch(() => undefined),
          lookupOpenAlex(`doi:${id.id}`, host.http, keys, exec.signal).catch(() => undefined),
          lookupSemanticScholar(`DOI:${id.id}`, host.http, keys, exec.signal).catch(
            () => undefined,
          ),
          lookupEuropePmc({ doi: id.id }, host.http, keys, exec.signal).catch(() => undefined),
        ])
        addHit('crossref', cr)
        addHit('openalex', oa)
        addHit('semanticscholar', s2)
        addHit('europepmc', pmc)
      } else if (id.kind === 'pmid' || id.kind === 'pmcid') {
        const pmc = await lookupEuropePmc(
          id.kind === 'pmid' ? { pmid: id.id } : { pmcid: id.id },
          host.http,
          keys,
          exec.signal,
        ).catch(() => undefined)
        addHit('europepmc', pmc)

        if (pmc?.doi) {
          const oa = await lookupOpenAlex(`doi:${pmc.doi}`, host.http, keys, exec.signal).catch(
            () => undefined,
          )
          addHit('openalex', oa)
        }
      }

      const fused = fuseRankedLists(foundLists)
      const paper = fused[0]

      if (!paper) {
        return {
          text: `No scholarly index found a paper matching "${raw}". Please verify the identifier.`,
        }
      }

      // Check collision with Zotero
      const zotero = host.zoteroService?.()
      let libraryNotice = ''
      if (zotero) {
        const library = await attachLibraryStatus([paper], zotero)
        if (library.failed > 0) {
          libraryNotice = '\n\nLibrary status unavailable (local Zotero lookup failed).'
        }
      }

      const idHint = bestIdentifierOf(paper)
      const titlePrefix = id === undefined ? 'Closest match found by title:\n\n' : ''

      return {
        text: `${titlePrefix}${formatPaperDetail(paper)}\n\nCanonical ID for other scholarly tools: ${idHint}${libraryNotice}`,
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Get scholarly paper detail',
      rawInput: String((args as { id?: string }).id ?? ''),
      kind: 'read',
    }),
  })
}
