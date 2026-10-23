/**
 * The `scholarly_read` tool: reads open-access full text of papers (arXiv, PMC, OA PDF).
 * Provides section outlines, section extraction, and natural-language BM25 passage matching.
 * @module dsh-zotero/scholarly/tools/read
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ScholarlyTextStore } from '../fulltext/store.js'
import { extractOutline, findSection, rankPassagesWithBM25 } from '../fulltext/evidence-bridge.js'
import { parsePaperIdentifier, resolveScholarlyFullText } from '../fulltext/resolve.js'
import {
  SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR,
  type ScholarlyToolHost,
  type ScholarlyToolOutput,
} from './search.js'

export interface ScholarlyReadHost extends ScholarlyToolHost {
  cache?: ScholarlyTextStore
  maxContentChars?(): number
}

export function createScholarlyReadTool(host: ScholarlyReadHost): ToolDefinition {
  return defineTool({
    name: 'scholarly_read',
    description:
      'Read the open-access full text of a paper (arXiv, PubMed Central, or an open-access PDF). ' +
      'Use outline=true to list sections, section="..." to read a specific section, ' +
      'or query="..." to find the passages answering a specific question with BM25 ranking.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'arXiv ID, DOI, PMID, PMCID, or a direct PDF URL.',
      },
      outline: {
        type: 'boolean',
        description: 'Set to true to inspect the hierarchical table of contents.',
      },
      section: {
        type: 'string',
        description:
          'Read a specific section by section number (e.g. "3" or "3.1") or title (e.g. "Methods").',
      },
      query: {
        type: 'string',
        description: 'Find passages matching a question or concept using BM25 ranking.',
      },
      passages: {
        type: 'integer',
        default: 5,
        description: 'With query: how many passages to return (default 5, max 12).',
      },
      start: {
        type: 'integer',
        default: 0,
        description: 'Character offset for continuation in chunked reading.',
      },
      max_chars: {
        type: 'integer',
        description: 'Maximum characters per chunk (defaults to the configured maxContentChars).',
      },
    },
    output: SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR,
    isConcurrencySafe: () => true,
    timeoutMs: 180_000,
    async execute(args, exec): Promise<ScholarlyToolOutput> {
      const input = args as {
        id: string
        outline?: boolean
        section?: string
        query?: string
        passages?: number
        start?: number
        max_chars?: number
      }

      const raw = input.id.trim()
      const parsedId = parsePaperIdentifier(raw)
      if (!parsedId) {
        throw new Error('Please provide a valid arXiv ID, DOI, PMID, PMCID, or public PDF URL.')
      }

      const fullText = await resolveScholarlyFullText(parsedId, {
        http: host.http,
        keys: host.keys(),
        store: host.cache,
        signal: exec.signal,
      })

      const sections = fullText.structured ? extractOutline(fullText.text) : []
      const header = `${raw} — ${fullText.text.length} characters (source: ${fullText.source})${
        fullText.url ? `\nLink: ${fullText.url}` : ''
      }`

      // 1. Inspect Table of Contents
      if (input.outline) {
        if (sections.length === 0) {
          return {
            text: `${header}\n\nNotice: This document was read from an unstructured PDF and has no section headings. Please read in chunks or search with query.`,
            document: {
              id: raw,
              source: fullText.source,
              url: fullText.url,
              sections: [],
            } as Record<string, JsonValue>,
          }
        }
        const outlineText = sections
          .map(
            (sec) =>
              `${'  '.repeat(Math.min(3, sec.level - 1))}${sec.id}. ${sec.title} (${
                sec.end - sec.start
              } chars)`,
          )
          .join('\n')
        return {
          text: `${header}\n\nSections (use section="..." to read):\n${outlineText}`,
          document: {
            id: raw,
            source: fullText.source,
            url: fullText.url,
            sections: sections.map((sec) => ({ id: sec.id, title: sec.title, level: sec.level })),
          } as unknown as Record<string, JsonValue>,
        }
      }

      let activeText = fullText.text
      let scopeLabel = ''

      // 2. Read specific Section
      if (input.section?.trim()) {
        const sec = findSection(sections, input.section)
        if (!sec) {
          const available = sections
            .filter((s) => s.level <= 2)
            .map((s) => `"${s.id}. ${s.title}"`)
            .join(', ')
          throw new Error(
            sections.length === 0
              ? 'This copy has no structured headings; please read in chunks or use query.'
              : `Section "${input.section}" not found. Available main sections: ${available}`,
          )
        }
        activeText = fullText.text.slice(sec.start, sec.end)
        scopeLabel = ` [Section ${sec.id}: ${sec.title}]`
      }

      // 3. BM25 Natural Language Question Matching
      if (input.query?.trim()) {
        const numPassages = Math.min(12, Math.max(1, input.passages ?? 5))
        const ranked = rankPassagesWithBM25(activeText, input.query.trim(), numPassages)
        if (ranked.length === 0) {
          return {
            text: `${header}${scopeLabel}\n\nNo relevant passage found matching "${input.query}". Try alternative phrasing.`,
            document: {
              id: raw,
              source: fullText.source,
              query: input.query,
              passages: [],
            } as Record<string, JsonValue>,
          }
        }

        const passagesText = ranked
          .map(
            (p, idx) =>
              `--- Passage ${idx + 1} (Score: ${p.score.toFixed(2)}, chars ${p.start}-${p.end}) ---\n${p.text.trim()}`,
          )
          .join('\n\n')

        return {
          text: `${header}${scopeLabel}\n\nTop passages matching "${input.query}":\n\n${passagesText}`,
          document: {
            id: raw,
            source: fullText.source,
            query: input.query,
            passages: ranked,
          } as unknown as Record<string, JsonValue>,
        }
      }

      // 4. Default Chunked Reading
      const maxChars = host.maxContentChars ? host.maxContentChars() : 12_000
      const start = Math.min(activeText.length, Math.max(0, input.start ?? 0))
      const chunkSize = Math.min(maxChars, Math.max(500, input.max_chars ?? maxChars))
      const end = Math.min(activeText.length, start + chunkSize)

      const isTruncated = end < activeText.length
      const statusTail = isTruncated
        ? `is_truncated: true, next_start: ${end}`
        : 'is_truncated: false (end of section/text)'

      const hint =
        start === 0 && isTruncated && sections.length > 0 && !scopeLabel
          ? ' (Tip: This paper has structured sections; use outline=true to inspect them).'
          : ''

      return {
        text: `${header}${scopeLabel}\nCharacters ${start}–${end}; ${statusTail}.${hint}\n\n${activeText.slice(
          start,
          end,
        )}`,
        document: {
          id: raw,
          source: fullText.source,
          url: fullText.url,
          start,
          end,
          isTruncated,
          text: activeText.slice(start, end),
        } as Record<string, JsonValue>,
      }
    },
    presentCall: (args) => {
      const isOutline = Boolean((args as { outline?: boolean }).outline)
      const id = String((args as { id?: string }).id ?? '')
      return {
        card: 'generic',
        title: isOutline ? 'Read paper outline' : 'Read paper full text',
        rawInput: id,
        kind: 'read',
      }
    },
  })
}
