/**
 * The `zotero_export` tool: turn item refs into citations or formatted
 * exports. Citation mode pairs every requested ref with Zotero's own HTML
 * citation, ordered as requested; bibliography mode yields the joined
 * CSL-sorted bibliography; bibtex/biblatex/ris/csljson/csv pass the translator
 * output through verbatim and itemize each exported document (its citation
 * key and title) paired with its ref. Export output is never mid-truncated:
 * it either fits the provider's character limit or fails with a typed error.
 * @module dsh-zotero/tools/export
 */
import { identityToolWrapper } from '../result-delivery.js';
import { defineTool, } from '@deepseek-ai/dsh-tools';
import { invalid } from '../errors.js';
import { parseSupportedRef } from '../refs.js';
import { formatCitationKeyConflict } from '../citation-key.js';
import { assertExportRefsWithinCap } from '../export-limits.js';
import { boundedPresentationMeta, projectExportMeta } from '../presentation-meta.js';
import { metaRecordOf, textOfBlocks } from './present.js';
import { ZOTERO_EXPORT_FORMATS, ZOTERO_ITEMKEY_BATCH, ZOTERO_ITEMIZED_EXPORT_FORMATS, } from '../constants.js';
import { assertNonEmptyList, REF_ARG_HINT } from './validate.js';
import { BACKGROUND_OUTPUT_PROPERTIES, PROMOTED_OUTPUT_PROPERTIES, RUN_IN_BACKGROUND_PARAMETER, executeWithJobs, isJobArm, jobPolicyOf, presentJobArm, renderJobArm, } from '../job-runner.js';
const BASE_EXPORT_PARAMETERS = {
    refs: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: `${REF_ARG_HINT} refs in output order; maxExportRefs applies. citation batches above ${ZOTERO_ITEMKEY_BATCH}; other formats require batching above that cap.`,
    },
    format: {
        type: 'string',
        enum: [...ZOTERO_EXPORT_FORMATS],
        required: true,
        description: 'citation: per-ref HTML; bibliography: joined CSL; other formats: translator exports.',
    },
    style: {
        type: 'string',
        description: 'CSL style id for citation/bibliography (defaults to the configured style).',
    },
    locale: {
        type: 'string',
        description: 'CSL locale for citation/bibliography (defaults to the configured locale).',
    },
    outputFile: {
        type: 'string',
        description: 'Optional session-workspace path for the exported bibliography, translator, or CSV text.',
    },
};
const EXPORT_WITH_BACKGROUND_PARAMETERS = {
    ...BASE_EXPORT_PARAMETERS,
    ...RUN_IN_BACKGROUND_PARAMETER,
};
const EXPORT_OUTPUT_SCHEMA = {
    oneOf: [
        {
            type: 'object',
            additionalProperties: false,
            properties: BACKGROUND_OUTPUT_PROPERTIES,
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: PROMOTED_OUTPUT_PROPERTIES,
        },
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
                format: { type: 'string', const: 'bibliography', required: true },
                style: { type: 'string' },
                locale: { type: 'string' },
                text: { type: 'string', required: true },
                outputFile: { type: 'string' },
                delivered: { type: 'boolean' },
            },
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                format: { type: 'string', const: 'csv', required: true },
                text: { type: 'string', required: true },
                outputFile: { type: 'string' },
                delivered: { type: 'boolean' },
            },
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                format: {
                    type: 'string',
                    enum: [...ZOTERO_ITEMIZED_EXPORT_FORMATS],
                    required: true,
                },
                style: { type: 'string' },
                locale: { type: 'string' },
                text: { type: 'string', required: true },
                outputFile: { type: 'string' },
                delivered: { type: 'boolean' },
                metadataIncomplete: { type: 'boolean' },
                items: {
                    type: 'array',
                    required: true,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            ref: { type: 'string', required: true },
                            exportKey: { type: 'string' },
                            citationKey: { type: 'string' },
                            citationKeySource: { type: 'string', enum: ['native', 'extra'] },
                            citationKeyConflict: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    native: { type: 'string', required: true },
                                    extra: { type: 'string', required: true },
                                },
                            },
                            title: { type: 'string' },
                            entryIndex: { type: 'integer' },
                            start: { type: 'integer' },
                            end: { type: 'integer' },
                        },
                    },
                },
            },
        },
    ],
};
/** The model-facing message for an empty refs list. */
export const EXPORT_REFS_EMPTY_MESSAGE = 'refs must list at least one zotero:// item ref';
// The shared cap message stays importable from the tool module: the tool spec
// asserts it by identity and the library endpoint refuses with the same text.
export { exportRefsOverCapMessage } from '../export-limits.js';
/** The model-facing messages for a blank style or locale argument. */
export const EXPORT_STYLE_BLANK_MESSAGE = 'style must be a non-empty CSL style id when provided';
export const EXPORT_LOCALE_BLANK_MESSAGE = 'locale must be a non-empty CSL locale when provided';
function buildRequest(args, config) {
    assertNonEmptyList(args.refs, EXPORT_REFS_EMPTY_MESSAGE);
    assertExportRefsWithinCap(args.refs.length, config.maxExportRefs);
    const refs = args.refs.map((value) => {
        const ref = parseSupportedRef(value, ['item']);
        return ref;
    });
    if (args.outputFile !== undefined &&
        (args.outputFile.trim() === '' || args.format === 'citation'))
        invalid('outputFile requires a non-empty path and a bibliography, translator, or CSV export');
    const style = args.style?.trim();
    if (style === '')
        invalid(EXPORT_STYLE_BLANK_MESSAGE);
    const locale = args.locale?.trim();
    if (locale === '')
        invalid(EXPORT_LOCALE_BLANK_MESSAGE);
    return {
        refs,
        format: args.format,
        ...(style !== undefined ? { style } : {}),
        ...(locale !== undefined ? { locale } : {}),
    };
}
// The render signature is the union of both parameter shapes: with the
// background arm available the model may pass `run_in_background`, without
// it that key is not part of the contract. `unknown` keeps the render honest
// about both shapes instead of narrowing it to one of them.
function renderExport(_args, value) {
    if (isJobArm(value))
        return renderJobArm(value);
    if (value.format === 'citation') {
        return [
            {
                type: 'text',
                text: value.citations.map((entry) => `${entry.ref}: ${entry.text}`).join('\n'),
            },
        ];
    }
    // Preserve translator bytes, including whitespace and BOM.
    const text = value.text;
    const outputFile = value.outputFile;
    const delivered = value.delivered;
    const notes = [];
    if (value.metadataIncomplete === true) {
        notes.push('Citekey and field alignment is partial: the raw metadata batch failed, so the body is complete but per-document facts are missing.');
    }
    if (outputFile !== undefined) {
        notes.push(delivered
            ? `Export written to ${outputFile} and declared as a deliverable.`
            : `Export written to ${outputFile}.`);
    }
    const mapped = 'items' in value && Array.isArray(value.items)
        ? value.items.map((item) => {
            const identity = [
                `ref: ${item.ref}`,
                item.exportKey === undefined ? undefined : `exportKey: ${item.exportKey}`,
                item.citationKey === undefined ? undefined : `citationKey: ${item.citationKey}`,
                item.title,
                item.entryIndex === undefined ? undefined : `entryIndex: ${item.entryIndex}`,
                item.citationKeyConflict === undefined
                    ? undefined
                    : `citationKey conflict: ${formatCitationKeyConflict(item.citationKeyConflict)}`,
            ]
                .filter((part) => part !== undefined)
                .join(' · ');
            const unavailable = item.exportKey === undefined && item.title === undefined
                ? ' (mapping unavailable; do not pair by raw order)'
                : '';
            return `- ${identity}${unavailable}`;
        })
        : [];
    const mapping = mapped.length > 0 ? `Mapped items:\n${mapped.join('\n')}\n\n` : '';
    const footer = notes.length > 0 ? `\n\n(${notes.join(' ')})` : '';
    return [{ type: 'text', text: `${mapping}${text}${footer}` }];
}
/**
 * The completed export card: the exported citation count in citation mode,
 * else the requested ref count with the translator format. `meta` is absent
 * on nested code dispatch or malformed replay records, and a failed call
 * keeps the raw error content; both fall back to the generic card.
 */
function presentExportResult(_args, result) {
    const record = metaRecordOf(result);
    if (record === undefined)
        return undefined;
    const jobArm = presentJobArm('Zotero export', record);
    if (jobArm !== undefined)
        return jobArm;
    if (typeof record.format !== 'string' || record.format === '')
        return undefined;
    if (record.format === 'citation') {
        if (typeof record.count !== 'number')
            return undefined;
        return { card: 'generic', title: `Zotero export: ${record.count} citations` };
    }
    if (typeof record.requested !== 'number')
        return undefined;
    return { card: 'generic', title: `Zotero export: ${record.requested} refs as ${record.format}` };
}
/**
 * Register the `zotero_export` tool once, statically: the
 * `run_in_background` parameter is always declared, and a background request
 * the composition cannot serve (the flag off, or no jobs service mounted) is
 * refused from execute with a structured error instead of the parameter being
 * hidden from the schema. The service's live config is read per request so a
 * settings edit takes effect on the next call without re-registration.
 * @param ctx - the plugin context.
 * @param service - the zotero service owning the request path.
 */
export function registerExportTool(ctx, service, wrap = identityToolWrapper) {
    const parameters = EXPORT_WITH_BACKGROUND_PARAMETERS;
    return ctx.tools.register(wrap(defineTool({
        name: 'zotero_export',
        description: [
            'Export Zotero items as citations, a bibliography, or translator formats (bibtex, biblatex, ris, csljson, csv).',
            `Citation mode pairs each ref with its HTML citation in the requested order and batches past Zotero's ${ZOTERO_ITEMKEY_BATCH}-key request cap;`,
            `bibliography returns the joined CSL-sorted text; translator formats return Zotero's raw ordering and are itemized by ref, exportKey, citationKey, and title, never by position. Itemized formats use one export request and one bounded metadata batch, up to ${ZOTERO_ITEMKEY_BATCH} refs.`,
        ].join(' '),
        parameters,
        output: {
            schema: EXPORT_OUTPUT_SCHEMA,
            render: renderExport,
            // Drop optional document previews while retaining citation attribution.
            presentationMeta: (args, value) => {
                if (isJobArm(value))
                    return value;
                return boundedPresentationMeta(projectExportMeta(value, args.refs), ['items']);
            },
        },
        presentCall: (args) => ({
            card: 'generic',
            title: 'Export Zotero citations',
            rawInput: `${args.refs.length} refs · ${args.format}`,
        }),
        presentResult: presentExportResult,
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            // The parameters are two shapes (the background arm registers only
            // while the jobs service is available), so defineTool infers a union;
            // both arms carry the export fields, and the background key is read
            // through the same alias below.
            const exportArgs = args;
            const request = buildRequest(exportArgs, service.config);
            const session = exec.agent?.session;
            const fs = ctx.get('fs');
            const workingDirectory = ctx.get('workingDirectory');
            const turn = session && exportArgs.outputFile !== undefined
                ? ctx.get('agents')?.turnBoundaryOf(session).lastTurn
                : undefined;
            if (exportArgs.outputFile !== undefined &&
                (!session || !fs || !workingDirectory || !Number.isSafeInteger(turn) || turn < 1)) {
                throw new Error('Export file delivery requires filesystem, working directory, session and owning turn');
            }
            if (exportArgs.outputFile !== undefined &&
                fs.sandboxMode !== undefined &&
                !ctx.get('sandboxPolicy'))
                throw new Error('Sandbox filesystem requires sandboxPolicy');
            const cwd = exportArgs.outputFile !== undefined
                ? await workingDirectory.ensure(exec.agent, exec.signal)
                : undefined;
            return executeWithJobs({
                runner: service.jobRunner,
                exec,
                label: `zotero_export (${exportArgs.refs.length} refs, ${exportArgs.format})`,
                run: async (signal, onProgress) => {
                    let result = await service.export(request, signal, onProgress);
                    if (result.format === 'citation')
                        return result;
                    signal.throwIfAborted();
                    if (exportArgs.outputFile !== undefined) {
                        const policyService = ctx.get('sandboxPolicy');
                        if (fs.sandboxMode !== undefined && !policyService)
                            throw new Error('Sandbox filesystem requires sandboxPolicy');
                        const target = await fs.resolve(exportArgs.outputFile.trim(), { cwd, signal });
                        signal.throwIfAborted();
                        const policy = policyService?.resolve({ session: session });
                        await fs.writeText(target, result.text, undefined, signal, policy);
                        const path = fs.processPath(target);
                        signal.throwIfAborted();
                        try {
                            session.append('deliverables/presented', {
                                turn: turn,
                                callId: exec.callId,
                                files: [{ path, description: `Exported ${exportArgs.format}` }],
                            });
                        }
                        catch (error) {
                            throw new Error(`Export written to ${path}; deliverable publication failed`, {
                                cause: error,
                            });
                        }
                        result = { ...result, outputFile: path, delivered: true };
                    }
                    signal.throwIfAborted();
                    return result;
                },
                renderResult: (value) => textOfBlocks(renderExport(exportArgs, value)),
                runInBackground: exportArgs.run_in_background === true,
                policy: jobPolicyOf(service.config),
            });
        },
    })));
}
//# sourceMappingURL=export.js.map