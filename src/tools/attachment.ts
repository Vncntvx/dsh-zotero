/**
 * The `zotero_attachment` tool: resolve an attachment ref to a location the
 * Agent can act on — an on-disk file path (verified to exist) or the linked
 * URL. This is the escalation path for PDFs Zotero has not full-text-indexed.
 * @module dsh-zotero/tools/attachment
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools'
import { withConnectivityAsk } from '../ask.js'
import { boundedPresentationMeta, projectAttachmentMeta } from '../presentation-meta.js'
import { parseRef, requireLocalRef } from '../refs.js'
import type { ZoteroService } from '../service.js'

const ATTACHMENT_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description:
      'An item ref (Zotero resolves its best attachment) or a zotero://user/0/attachment/<KEY> ref for one specific attachment.',
  },
} as const

type AttachmentArgs = InferArgs<typeof ATTACHMENT_PARAMETERS>

const ATTACHMENT_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ref: { type: 'string', required: true },
        title: { type: 'string', required: true },
        contentType: { type: 'string', required: true },
        kind: { type: 'string', const: 'file', required: true },
        path: { type: 'string', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ref: { type: 'string', required: true },
        title: { type: 'string', required: true },
        contentType: { type: 'string', required: true },
        kind: { type: 'string', const: 'url', required: true },
        url: { type: 'string', required: true },
      },
    },
  ],
} as const

type AttachmentOutput = InferValue<typeof ATTACHMENT_OUTPUT_SCHEMA>

function renderAttachment(_args: AttachmentArgs, value: AttachmentOutput): ContentBlock[] {
  const label = value.title === '' ? value.ref : `${value.title} (${value.ref})`
  const target = value.kind === 'file' ? value.path : value.url
  return [{ type: 'text', text: `${label} ${value.contentType || 'unknown type'} → ${target}` }]
}

export function registerAttachmentTool(ctx: Context, service: ZoteroService): void {
  ctx.tools.register(
    defineTool({
      name: 'zotero_attachment',
      description: [
        'Resolve a Zotero ref to a usable attachment location: an item ref yields the best attachment Zotero itself picks,',
        'an attachment ref pinpoints one attachment. Returns the verified on-disk file path, or the linked URL for web-linked attachments.',
      ].join(' '),
      parameters: ATTACHMENT_PARAMETERS,
      output: {
        schema: ATTACHMENT_OUTPUT_SCHEMA,
        render: renderAttachment,
        presentationMeta: (_args, value) =>
          boundedPresentationMeta(projectAttachmentMeta(value), ['path', 'url']),
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'read',
        title: 'Resolve Zotero attachment',
        rawInput: args.ref,
      }),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const ref = parseRef(args.ref)
        requireLocalRef(ref, ['item', 'attachment'])
        return await withConnectivityAsk(ctx, exec, () => service.attachment(ref, exec.signal))
      },
    }),
  )
}
