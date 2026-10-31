import { defineTool, } from '@deepseek-ai/dsh-tools';
import { invalid } from '../errors.js';
import { parseSupportedRef } from '../refs.js';
import { assertExportRefsWithinCap } from '../export-limits.js';
import { boundedPresentationMeta, projectExportMeta } from '../presentation-meta.js';
import { metaRecordOf, textOfBlocks } from './present.js';
import { DEFAULT_SPILL_CHAR_THRESHOLD, trySpillToolOutput } from '../spill.js';
import { ZOTERO_EXPORT_FORMATS, ZOTERO_ITEMKEY_BATCH, ZOTERO_TRANSLATOR_EXPORT_FORMATS, } from '../constants.js';
import { assertNonEmptyList, REF_ARG_HINT } from './validate.js';
import { BACKGROUND_OUTPUT_PROPERTIES, PROMOTED_OUTPUT_PROPERTIES, RUN_IN_BACKGROUND_PARAMETER, ZoteroJobRunner, executeWithJobs, isJobArm, jobPolicyOf, presentJobArm, renderJobArm, } from '../job-runner.js';
const BASE_EXPORT_PARAMETERS = {
    refs: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: `${REF_ARG_HINT} refs to export, in the order citations should appear; capped by the configured maxExportRefs. citation batches past Zotero's ${ZOTERO_ITEMKEY_BATCH}-key request cap; bibliography/bibtex/biblatex/ris/csljson accept at most ${ZOTERO_ITEMKEY_BATCH}, so batch those calls.`,
    },
    format: {
        type: 'string',
        enum: [...ZOTERO_EXPORT_FORMATS],
        required: true,
        description: 'citation: per-ref HTML citations; bibliography: joined CSL bibliography; the rest: raw translator exports.',
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
        description: 'Optional file path (relative to the session workspace) to write the exported bibliography or translator text into, declaring it as a deliverable for the user.',
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
                spill: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        locator: { type: 'string', required: true },
                        bytes: { type: 'integer', required: true },
                        retrievalHint: { type: 'string', required: true },
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
                    enum: [...ZOTERO_TRANSLATOR_EXPORT_FORMATS],
                    required: true,
                },
                style: { type: 'string' },
                locale: { type: 'string' },
                text: { type: 'string', required: true },
                outputFile: { type: 'string' },
                delivered: { type: 'boolean' },
                spill: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        locator: { type: 'string', required: true },
                        bytes: { type: 'integer', required: true },
                        retrievalHint: { type: 'string', required: true },
                    },
                },
                items: {
                    type: 'array',
                    required: true,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            ref: { type: 'string', required: true },
                            key: { type: 'string' },
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
        invalid('outputFile requires a non-empty path and a bibliography or translator export');
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
    // Zotero's raw translator output can lead with stray whitespace; a text
    // export reads cleaner without it (display and copy alike).
    const text = value.text.trimStart();
    const spill = value.spill;
    const outputFile = value.outputFile;
    const delivered = value.delivered;
    const notes = [];
    if (outputFile !== undefined) {
        notes.push(delivered
            ? `Export written to ${outputFile} and declared as a deliverable.`
            : `Export written to ${outputFile}.`);
    }
    if (spill !== undefined) {
        notes.push(`Full export stored at: ${spill.locator}. ${spill.retrievalHint}`);
    }
    const footer = notes.length > 0 ? `\n\n(${notes.join(' ')})` : '';
    return [{ type: 'text', text: `${text}${footer}` }];
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
export function registerExportTool(ctx, service) {
    const parameters = EXPORT_WITH_BACKGROUND_PARAMETERS;
    return ctx.tools.register(defineTool({
        name: 'zotero_export',
        description: [
            'Export Zotero items as citations, a bibliography, or translator formats.',
            `Citation mode pairs each ref with its HTML citation in the requested order and batches past Zotero's ${ZOTERO_ITEMKEY_BATCH}-key request cap;`,
            `bibliography mode returns the joined CSL-sorted bibliography; bibtex/biblatex/ris/csljson return raw export text; those formats stay at one request (up to ${ZOTERO_ITEMKEY_BATCH} refs), their ordering remains Zotero's own, and every exported document is itemized with its ref, citation key, and title.`,
        ].join(' '),
        parameters,
        output: {
            schema: EXPORT_OUTPUT_SCHEMA,
            render: renderExport,
            // The refs list and the per-document items are the long fields; the
            // shared byte budget drops them (with detailOmitted) rather than
            // mid-cutting the artifact facts.
            presentationMeta: (args, value) => {
                if (isJobArm(value))
                    return value;
                return boundedPresentationMeta(projectExportMeta(value, args.refs), ['refs', 'items']);
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
            const spillSessionId = session?.header.id;
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
                runner: new ZoteroJobRunner(ctx.get('jobs'), service.diagnostics.sink),
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
                    if (result.text.length > DEFAULT_SPILL_CHAR_THRESHOLD) {
                        const ext = exportArgs.format === 'ris'
                            ? 'ris'
                            : exportArgs.format === 'csljson'
                                ? 'json'
                                : 'bib';
                        const spill = await trySpillToolOutput(ctx, exec, `export-${exportArgs.format}.${ext}`, result.text, spillSessionId);
                        if (spill !== undefined)
                            result = { ...result, spill };
                    }
                    return result;
                },
                renderResult: (value) => textOfBlocks(renderExport(exportArgs, value)),
                runInBackground: exportArgs.run_in_background === true,
                policy: jobPolicyOf(service.config),
            });
        },
    }));
}
//# sourceMappingURL=export.js.map