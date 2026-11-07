/**
 * Background-job envelope shared by the long scholarly tools.
 *
 * The scholarly component owns no delivery wrapper: a completed job carries
 * its rendered text in `JobOutcome.result`, which `job_output` serves to the
 * model. The runner is the same `ZoteroJobRunner` the core heavy tools use,
 * with a scholarly kind, an explicit output ceiling, and no ResultDelivery
 * (scholarly results are text, not durable tool-result receipts).
 *
 * The two arm schemas and the arm renderer are the shared ones in
 * `src/job-runner.ts`; this module must not spell them a second way.
 * @module dsh-zotero/scholarly/tools/jobs
 */
import { BACKGROUND_OUTPUT_PROPERTIES, PROMOTED_OUTPUT_PROPERTIES, executeWithJobs, isJobArm, renderJobArm, } from '../../job-runner.js';
import { textOfBlocks } from '../../tools/present.js';
import { SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR } from './common.js';
/**
 * Largest scholarly job result the shared runner declares, in UTF-8 bytes.
 *
 * The full-text reader is bounded by the `maxContentChars` schema maximum
 * (50 000 characters); at the worst case of three bytes per character plus the
 * JSON envelope and progress lines, 256 KiB still bounds one model-facing read
 * without clipping a legal result.
 */
export const SCHOLARLY_JOB_OUTPUT_LIMIT_BYTES = 256 * 1024;
/** The scholarly output schema: two shared job arms plus the text receipt. */
const SCHOLARLY_JOB_OUTPUT_SCHEMA = {
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
        SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR.schema,
    ],
};
/** Render one scholarly result, including the shared promotion reason. */
function renderScholarlyJobOutput(_args, value) {
    if (isJobArm(value))
        return renderJobArm(value);
    return SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR.render({}, value);
}
/** The scholarly output descriptor with the two job arms. */
export const SCHOLARLY_JOB_OUTPUT_DESCRIPTOR = {
    schema: SCHOLARLY_JOB_OUTPUT_SCHEMA,
    render: renderScholarlyJobOutput,
    presentationMeta: (_args, value) => (isJobArm(value) ? value : {}),
};
/**
 * Run one long scholarly operation through the shared job policy.
 * @param options - the tool execution, label, body, and explicit-background flag.
 * @returns the body's value, or the background/promoted job arm.
 */
export async function runScholarlyJob(options) {
    return executeWithJobs({
        runner: options.host.jobRunner(),
        exec: options.exec,
        label: options.label,
        kind: 'scholarly',
        outputLimitBytes: SCHOLARLY_JOB_OUTPUT_LIMIT_BYTES,
        run: async (signal, onProgress) => await options.run(signal, onProgress),
        renderResult: (value) => textOfBlocks(renderScholarlyJobOutput({}, value)),
        runInBackground: options.runInBackground,
        policy: options.host.jobPolicy(),
    });
}
//# sourceMappingURL=jobs.js.map