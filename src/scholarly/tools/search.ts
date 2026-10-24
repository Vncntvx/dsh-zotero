/**
 * The `scholarly_search` tool: multi-source literature retrieval across 6 academic indexes.
 * Supports intelligent routing, weighted RRF fusion, collision check against Zotero, and background promotion.
 * @module dsh-zotero/scholarly/tools/search
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  formatPaperItem,
  fuseRankedLists,
  postProcessRanked,
  type RankedSourceList,
} from '../fusion.js'
import { routeQuery } from '../router.js'
import { SOURCE_SEARCHERS } from '../sources/index.js'
import { SCHOLARLY_SOURCE_IDS, SCHOLARLY_SOURCE_NAMES, type ScholarlyQuery } from '../types.js'
import { annotateWithLibraryStatus } from '../zotero-link.js'
import { ZoteroError, ZOTERO_INVALID_ARGUMENT } from '../../errors.js'
import {
  SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR,
  toCleanJsonRecords,
  type ScholarlyToolHost,
  type ScholarlyToolOutput,
} from './common.js'

const CITE_HINT = 'Tip: Cite a paper from these results using its title link or ID.'

export function createScholarlySearchTool(host: ScholarlyToolHost): ToolDefinition {
  return defineTool({
    name: 'scholarly_search',
    description:
      'Search global scholarly literature across arXiv, OpenAlex, Crossref, Semantic Scholar, PubMed, Europe PMC, and DBLP. ' +
      'Deduplicates records across indexes into unified entries with citations, open-access status, and local Zotero library markers. ' +
      'Use this for academic papers, preprints, and journals (not general web pages).',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Topic keywords, a paper title, or author with topic in English.',
      },
      sources: {
        type: 'array',
        items: { type: 'string', enum: [...SCHOLARLY_SOURCE_IDS] },
        description:
          'Optional: limit to specific indexes. Default routes automatically by topic keyword semantics.',
      },
      year_from: {
        type: 'integer',
        description:
          'Published in this year or later. If omitted with sort="date", defaults to the previous year.',
      },
      year_to: { type: 'integer', description: 'Published in this year or earlier.' },
      open_access: { type: 'boolean', description: 'Only return papers with free full text.' },
      sort: {
        type: 'string',
        enum: ['relevance', 'date', 'citations'],
        default: 'relevance',
        description:
          'Result order: relevance, date (newest first; defaults to the previous year if year_from omitted), citations (most cited first).',
      },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'arXiv categories like cs.CL, stat.ML (applies to arXiv).',
      },
      limit: { type: 'integer', default: 8, description: 'How many papers to return (default 8).' },
      abstract: {
        type: 'string',
        enum: ['none', 'snippet', 'full'],
        default: 'snippet',
        description: 'How much abstract to display in the text summary.',
      },
    },
    output: SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR,
    isConcurrencySafe: () => true,
    timeoutMs: 180_000,
    async execute(args, exec): Promise<ScholarlyToolOutput> {
      const input = args as {
        query: string
        sources?: string[]
        year_from?: number
        year_to?: number
        open_access?: boolean
        sort?: 'relevance' | 'date' | 'citations'
        categories?: string[]
        limit?: number
        abstract?: 'none' | 'snippet' | 'full'
      }

      const text = input.query.trim()
      if (!text) throw new ZoteroError('query parameter cannot be empty.', ZOTERO_INVALID_ARGUMENT)

      const limit = Math.min(
        host.maxResults(),
        Math.max(1, input.limit ?? Math.min(8, host.maxResults())),
      )
      const selectedSources = routeQuery(text, input.sources)
      const thisYear = new Date().getFullYear()
      const isDateSort = input.sort === 'date'

      const yearFrom = input.year_from ?? (isDateSort ? thisYear - 1 : undefined)
      const yearTo =
        yearFrom === undefined && input.year_to === undefined
          ? undefined
          : Math.min(input.year_to ?? thisYear + 1, thisYear + 1)

      const queryObj: ScholarlyQuery = {
        query: text,
        sort: input.sort === 'citations' ? 'relevance' : (input.sort ?? 'relevance'),
        limit: Math.min(
          50,
          input.sort === 'citations'
            ? limit * 4
            : selectedSources.length === 1
              ? limit
              : Math.max(5, Math.ceil(limit * 0.8)),
        ),
        ...(yearFrom !== undefined ? { yearFrom } : {}),
        ...(yearTo !== undefined ? { yearTo } : {}),
        ...(input.open_access ? { openAccess: true } : {}),
        ...(input.categories && input.categories.length > 0
          ? { categories: input.categories }
          : {}),
      }

      const keys = host.keys()
      const failedSources: string[] = []

      const sourceResults = await Promise.all(
        selectedSources.map(async (sourceId) => {
          try {
            // Total over `ScholarlySourceId`: the registry and the id union are
            // declared together, so this lookup cannot be undefined.
            const searcher = SOURCE_SEARCHERS[sourceId]
            const queryForSource =
              isDateSort && sourceId !== 'arxiv'
                ? { ...queryObj, sort: 'relevance' as const, limit: Math.min(50, limit * 3) }
                : queryObj

            const papers = await searcher(queryForSource, host.http, keys, exec.signal)
            const weight =
              sourceId === 'arxiv' || sourceId === 'dblp'
                ? 1.2
                : sourceId === 'pubmed' || sourceId === 'europepmc'
                  ? 1.2
                  : 1.0

            return {
              sourceId,
              weight,
              papers,
            } satisfies RankedSourceList
          } catch (error) {
            if (exec.signal.aborted) throw error
            const msg = error instanceof Error ? error.message : String(error)
            failedSources.push(`${SCHOLARLY_SOURCE_NAMES[sourceId]} (${msg})`)
            return {
              sourceId,
              weight: 1.0,
              papers: [],
            } satisfies RankedSourceList
          }
        }),
      )

      // 1. Fuse multiple ranked lists with Match Lattice & Weighted RRF
      let papers = fuseRankedLists(sourceResults)

      // 2. Post-process rankings (title exact match, date/citation sorting, OA filter, limit slice)
      papers = postProcessRanked(papers, { ...queryObj, limit, sort: input.sort ?? 'relevance' })

      // 3. Cross-component collision check against the local Zotero library (top N only).
      //    A lookup that could not run reports "unavailable" instead of leaving
      //    hits unmarked, where a reader would take them for "not held".
      const { notice: libraryNotice } = await annotateWithLibraryStatus(
        papers,
        host.zoteroService?.(),
        exec.signal,
      )

      if (papers.length === 0) {
        const attempted = selectedSources.map((s) => SCHOLARLY_SOURCE_NAMES[s]).join(', ')
        const failureNotice =
          failedSources.length > 0 ? `\nUnanswered sources: ${failedSources.join('; ')}.` : ''
        return {
          text: `No papers found for "${text}" across ${attempted}.${failureNotice} Try fewer or alternative keywords.`,
          papers: [],
          issues: failedSources,
        }
      }

      const answeredSources = selectedSources
        .filter((_, idx) => sourceResults[idx]!.papers.length > 0)
        .map((s) => SCHOLARLY_SOURCE_NAMES[s])

      const abstractChars = input.abstract === 'none' ? 0 : input.abstract === 'full' ? 4000 : 300
      const summaryHeader = `${papers.length} papers found for "${text}" (via ${answeredSources.join(
        ', ',
      )}).`
      const failureNote = failedSources.length > 0 ? `\nNotice: ${failedSources.join('; ')}.` : ''

      const formattedLines = papers
        .map((p, idx) => formatPaperItem(p, idx + 1, abstractChars))
        .join('\n\n')

      return {
        text: `${summaryHeader}${failureNote}${libraryNotice}\n${CITE_HINT}\n\n${formattedLines}`,
        papers: toCleanJsonRecords(papers),
        issues: failedSources,
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Search scholarly literature',
      rawInput: String((args as { query?: string }).query ?? ''),
      kind: 'search',
    }),
  })
}
