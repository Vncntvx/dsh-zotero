/**
 * The `zotero_export` tool: turn item refs into citations or formatted
 * exports. Citation mode pairs every requested ref with Zotero's own HTML
 * citation, ordered as requested; bibliography mode yields the joined
 * CSL-sorted bibliography; bibtex/biblatex/ris/csljson pass the translator
 * output through verbatim. Export output is never mid-truncated — it either
 * fits the provider's character limit or fails with a typed error.
 * @module dsh-zotero/tools/export
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from '../config.js'
import { ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../errors.js'
import { parseRef, requireLocalRef } from '../refs.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroExportFormat, ZoteroExportRequest } from '../types.js'

const EXPORT_PARAMETERS = {
  refs: {
    type: 'array',
    items: { type: 'string' },
    required: true,
    description: 'zotero://user/0/item/<KEY> refs to export, in the order citations should appear.',
  },
  format: {
    type: 'string',
    enum: ['citation', 'bibliography', 'bibtex', 'biblatex', 'ris', 'csljson'],
    required: true,
    description:
      'citation: per-ref HTML citations; bibliography: joined CSL bibliography; the rest: raw translator exports.',
  },
  style: {
    type: 'string',
    description: 'CSL style id for citation/bibliography (defaults to the configured style).',
  },
  locale: {
    type: 'string',
    description: 'CSL locale for citation/bibliography (defaults to the configured locale).',
  },
} as const

type ExportArgs = InferArgs<typeof EXPORT_PARAMETERS>

const EXPORT_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        format: { type: 'string', const: 'citation', required: true },
        style: { type: 'string' },
        locale: { type: 'string' },
        citations: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ref: { type: 'string', required: true },
              text: { type: 'string', required: true },
            },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        format: {
          type: 'string',
          enum: ['bibliography', 'bibtex', 'biblatex', 'ris', 'csljson'],
          required: true,
        },
        style: { type: 'string' },
        locale: { type: 'string' },
        text: { type: 'string', required: true },
      },
    },
  ],
} as const

type ExportOutput = InferValue<typeof EXPORT_OUTPUT_SCHEMA>

function invalid(message: string): never {
  throw new ZoteroError(message, ZOTERO_INVALID_ARGUMENT)
}

function buildRequest(args: ExportArgs): ZoteroExportRequest {
  if (args.refs.length === 0) invalid('refs must list at least one zotero:// item ref')
  const refs = args.refs.map((value) => {
    const ref = parseRef(value)
    requireLocalRef(ref, ['item'])
    return ref
  })
  const style = args.style?.trim()
  if (style === '') invalid('style must be a non-empty CSL style id when provided')
  const locale = args.locale?.trim()
  if (locale === '') invalid('locale must be a non-empty CSL locale when provided')
  return {
    refs,
    format: args.format as ZoteroExportFormat,
    ...(style !== undefined ? { style } : {}),
    ...(locale !== undefined ? { locale } : {}),
  }
}

export function renderExport(_args: ExportArgs, value: ExportOutput): ContentBlock[] {
  if (value.format === 'citation') {
    return [
      {
        type: 'text',
        text: value.citations.map((entry) => `${entry.ref}: ${entry.text}`).join('\n'),
      },
    ]
  }
  return [{ type: 'text', text: value.text }]
}

export function registerExportTool(
  ctx: Context,
  service: ZoteroService,
  _config: ResolvedConfig,
): void {
  ctx.tools.register(
    defineTool({
      name: 'zotero_export',
      description: [
        'Export Zotero items as citations, a bibliography, or translator formats.',
        'Citation mode pairs each ref with its HTML citation in the requested order;',
        'bibliography mode returns the joined CSL-sorted bibliography; bibtex/biblatex/ris/csljson return raw export text.',
      ].join(' '),
      parameters: EXPORT_PARAMETERS,
      output: {
        schema: EXPORT_OUTPUT_SCHEMA,
        render: renderExport,
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'Export Zotero citations',
        rawInput: `${args.refs.length} refs · ${args.format}`,
      }),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return await service.export(buildRequest(args), exec.signal)
      },
    }),
  )
}
