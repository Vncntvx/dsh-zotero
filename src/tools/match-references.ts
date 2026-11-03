/** Match BibTeX-like reference metadata against the local Zotero library. */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools'
import { invalid } from '../errors.js'
import { projectMatchReferencesMeta } from '../presentation-meta.js'
import { identityToolWrapper, type ToolWrapper } from '../result-delivery.js'
import type { ZoteroMatchReferencesRequest, ZoteroMatchReferencesResult } from '../types.js'
import type { ZoteroService } from '../service.js'

const PARAMETERS = {
  references: {
    type: 'array',
    required: true,
    description: 'Reference fingerprints; provide a unique inputId and DOI or title. Maximum 50.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        inputId: { type: 'string', required: true },
        bibKey: { type: 'string' },
        doi: { type: 'string' },
        title: { type: 'string' },
        authors: { type: 'array', items: { type: 'string' } },
        year: { type: 'integer' },
        venue: { type: 'string' },
      },
    },
  },
  includeFieldDiff: {
    type: 'boolean',
    description: 'Include input/Zotero field differences where available.',
  },
} as const

type Args = InferArgs<typeof PARAMETERS>
type Output = InferValue<typeof OUTPUT>
const OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          inputId: { type: 'string', required: true },
          status: {
            type: 'string',
            enum: ['matched', 'ambiguous', 'notFound', 'conflict'],
            required: true,
          },
          bibKey: { type: 'string' },
          reason: { type: 'string' },
          selected: { type: 'object', additionalProperties: true },
          candidates: { type: 'array', items: { type: 'object', additionalProperties: true } },
          fieldDiff: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
} as const

function buildRequest(args: Args): ZoteroMatchReferencesRequest {
  if (args.references.length === 0 || args.references.length > 50)
    invalid('references must contain 1-50 entries')
  return {
    references: args.references,
    ...(args.includeFieldDiff === undefined ? {} : { includeFieldDiff: args.includeFieldDiff }),
  }
}

export function renderMatchReferences(_args: Args, value: Output): ContentBlock[] {
  return [
    {
      type: 'text',
      text: value.items
        .map((item) => {
          const selected = item.selected as
            | {
                ref?: string
                citationKey?: string
                exportKey?: string
                title?: string
                matchMethod?: string
                confidence?: string
              }
            | undefined
          const candidates = Array.isArray(item.candidates) ? item.candidates : []
          const mapped =
            selected ??
            (candidates.length === 1
              ? (candidates[0] as {
                  ref?: string
                  citationKey?: string
                  exportKey?: string
                  title?: string
                  matchMethod?: string
                  confidence?: string
                })
              : undefined)
          if (mapped === undefined)
            return `${item.inputId}: ${item.status}${item.reason ? ` — ${item.reason}` : ''}`
          const identity = [
            mapped.ref,
            mapped.citationKey && `citationKey=${mapped.citationKey}`,
            mapped.exportKey && `exportKey=${mapped.exportKey}`,
            mapped.title,
          ]
            .filter(Boolean)
            .join(' · ')
          return `${item.inputId}: ${item.status} -> ${identity} (${mapped.matchMethod}, ${mapped.confidence})${item.reason ? ` — ${item.reason}` : ''}`
        })
        .join('\n'),
    },
  ]
}

export function registerMatchReferencesTool(
  ctx: Context,
  service: ZoteroService,
  wrap: ToolWrapper = identityToolWrapper,
): void {
  ctx.tools.register(
    wrap(
      defineTool({
        name: 'zotero_match_references',
        description:
          'Match up to 50 external reference fingerprints to local Zotero refs. Exact DOI matching scans paged top-level local metadata once per call because Zotero quick search does not index DOI fields; ambiguous or conflicting matches are reported for review. Use zotero_get_batch for details after matching.',
        parameters: PARAMETERS,
        output: {
          schema: OUTPUT,
          render: renderMatchReferences,
          presentationMeta: (_args, value) =>
            projectMatchReferencesMeta(value as unknown as ZoteroMatchReferencesResult),
        },
        presentCall: (args) => ({
          card: 'generic',
          kind: 'read',
          title: 'Match Zotero references',
          rawInput: `${args.references.length} references`,
        }),
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          return (await service.matchReferences(
            buildRequest(args),
            exec.signal,
          )) as unknown as Output
        },
      }),
    ),
  )
}
