/**
 * The `scholarly_citations` tool: follows a paper's citation network (cites, references, related works).
 * @module dsh-zotero/scholarly/tools/citations
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { formatPaperItem, fuseRankedLists } from '../fusion.js'
import { parsePaperIdentifier } from '../fulltext/resolve.js'
import { lookupOpenAlex, openalexLinkedWorks } from '../sources/openalex.js'
import { attachLibraryStatus } from '../zotero-link.js'
import { SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR, type ScholarlyToolHost } from './search.js'

export function createScholarlyCitationsTool(host: ScholarlyToolHost): ToolDefinition {
  return defineTool({
    name: 'scholarly_citations',
    description:
      "Follow a paper's citation network: find papers that cite it (citations), " +
      'papers it cites (references), or similar related papers (related).',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'DOI (e.g. 10.1038/nature1234), arXiv ID, or PMID.',
      },
      direction: {
        type: 'string',
        required: true,
        enum: ['citations', 'references', 'related'],
        description:
          'citations = papers citing this work; references = bibliography list; related = similar papers.',
      },
      limit: {
        type: 'integer',
        default: 10,
        description: 'Maximum papers to return (default 10).',
      },
    },
    output: SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR,
    isConcurrencySafe: () => true,
    timeoutMs: 60_000,
    async execute(args, exec): Promise<{ text: string }> {
      const input = args as {
        id: string
        direction: 'citations' | 'references' | 'related'
        limit?: number
      }
      const raw = input.id.trim()
      const parsedId = parsePaperIdentifier(raw)
      if (!parsedId || parsedId.kind === 'url') {
        throw new Error('Please provide a valid DOI, an arXiv ID, or a PMID.')
      }

      const limit = Math.min(
        host.maxResults(),
        Math.max(1, input.limit ?? Math.min(10, host.maxResults())),
      )
      const keys = host.keys()

      const openAlexLookupId =
        parsedId.kind === 'arxiv'
          ? `doi:10.48550/arXiv.${parsedId.id}`
          : parsedId.kind === 'doi'
            ? `doi:${parsedId.id}`
            : `pmid:${parsedId.id}`

      const work = await lookupOpenAlex(openAlexLookupId, host.http, keys, exec.signal)
      if (!work?.openalex) {
        return {
          text: `OpenAlex citation index does not recognize identifier "${raw}". Recent preprints may not have citation links yet.`,
        }
      }

      const relation =
        input.direction === 'citations'
          ? 'cites'
          : input.direction === 'references'
            ? 'cited_by'
            : 'related_to'

      const { papers, total } = await openalexLinkedWorks(
        work.openalex,
        relation,
        limit,
        host.http,
        keys,
        exec.signal,
      )

      const relDesc =
        input.direction === 'citations'
          ? 'cite'
          : input.direction === 'references'
            ? 'are referenced by'
            : 'are related to'

      if (papers.length === 0) {
        return {
          text: `No papers found that ${relDesc} "${work.title}" in OpenAlex.`,
        }
      }

      const fused = fuseRankedLists([{ sourceId: 'openalex', papers }])

      // Check collision with Zotero
      const zotero = host.zoteroService?.()
      let libraryNotice = ''
      if (zotero) {
        const library = await attachLibraryStatus(fused, zotero)
        if (library.failed > 0) {
          libraryNotice = `\n\nLibrary status unavailable for ${library.failed} of ${fused.length} results (local Zotero lookup failed).`
        }
      }

      const countDesc =
        total !== undefined && total > fused.length
          ? `${total} total papers ${relDesc} "${work.title}"; showing top ${fused.length} most cited:`
          : `${fused.length} papers ${relDesc} "${work.title}":`

      const lines = fused.map((p, idx) => formatPaperItem(p, idx + 1, 200)).join('\n\n')

      return {
        text: `${countDesc}\n\n${lines}${libraryNotice}`,
      }
    },
    presentCall: (args) => {
      const dir = (args as { direction?: string }).direction
      const id = String((args as { id?: string }).id ?? '')
      const title =
        dir === 'references'
          ? 'Get paper references'
          : dir === 'related'
            ? 'Get related papers'
            : 'Get citing papers'
      return { card: 'generic', title, rawInput: id, kind: 'search' }
    },
  })
}
