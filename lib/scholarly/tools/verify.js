/**
 * The `scholarly_verify` tool: checks reference lists against official registry records.
 * Catches fake DOIs, mismatched titles/authors/years, and retracted publications.
 *
 * An entry may be a full bibliographic reference or a bare DOI. A DOI-only
 * entry establishes identifier resolution and retraction state; its title,
 * author, and year fields are reported as `not-compared`.
 * @module dsh-zotero/scholarly/tools/verify
 */
import { defineZoteroTool as defineTool } from '../../define-tool.js';
import { mapWithConcurrency } from '../../concurrency.js';
import { ZoteroError, ZOTERO_INVALID_ARGUMENT } from '../../errors.js';
import { titleKey, titleTokens } from '../normalize.js';
import { crossrefMatchReference, lookupCrossrefWork, paperFromCrossref, } from '../sources/crossref.js';
import { cleanDoi, parseYear } from '../sources/helpers.js';
import { presentJobArm, RUN_IN_BACKGROUND_PARAMETER } from '../../job-runner.js';
import { metaRecordOf } from '../../tools/present.js';
import { failureTextOf, isLocalAddressRejection, verificationNextStepOf } from './failure.js';
import { SCHOLARLY_JOB_OUTPUT_DESCRIPTOR, runScholarlyJob } from './jobs.js';
import { toCleanJsonRecords } from './common.js';
/** Per-call reference cap; the description promises it and the executor enforces it. */
const SCHOLARLY_VERIFY_MAX_REFERENCES = 40;
const VERIFY_PARAMETERS = {
    references: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: `List of reference citation strings (up to ${SCHOLARLY_VERIFY_MAX_REFERENCES}) to verify.`,
    },
};
function uncomparedFields() {
    return { title: 'not-compared', authors: 'not-compared', year: 'not-compared' };
}
const DOI_PATTERN = /(10\.\d{4,9}\/\S+)/i;
/** Remove the DOI and the scaffolding around it (`doi:`, `https://doi.org/`). */
function withoutDoi(text, matched) {
    let rest = matched ? text.replace(matched, ' ') : text;
    rest = rest.replace(/https?:\/\/(?:dx\.)?doi\.org\/?/gi, ' ');
    rest = rest.replace(/\bdoi:\s*/gi, ' ');
    return rest.trim();
}
function hasBibliographicText(value) {
    return /[\p{L}\p{N}]/u.test(value);
}
/**
 * The leading name span: everything before the first comma, bracket, or year.
 * A reference normally starts with its first author, so this is the span the
 * author check compares. A title-first entry has no such delimiter near the
 * start; it yields nothing rather than presenting the title as an author.
 */
function leadingNameOf(text) {
    const delimiter = /[,([]|\b(?:1[89]|20)\d{2}\b/.exec(text);
    if (!delimiter)
        return undefined;
    const head = text.slice(0, delimiter.index).trim();
    if (!head || !/\p{L}/u.test(head) || head.split(/\s+/).length > 5)
        return undefined;
    return head;
}
/** Comparable name tokens; a Han run also contributes its prefixes (张 from 张三). */
function nameTokensOf(value) {
    const tokens = value
        .normalize('NFKC')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
    const extra = [];
    for (const token of tokens) {
        if (/^\p{Script=Han}+$/u.test(token) && token.length > 1) {
            for (let length = 1; length < token.length; length++)
                extra.push(token.slice(0, length));
        }
    }
    return [...new Set([...tokens, ...extra])];
}
function normalizeJoined(value) {
    return value
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}
/** An institutional author matches on its full name, not on one shared word. */
function institutionNameMatch(referenceName, registryName) {
    const reference = normalizeJoined(referenceName);
    const registry = normalizeJoined(registryName);
    if (!reference || !registry)
        return false;
    if (reference === registry)
        return true;
    return (reference.length >= 4 &&
        registry.length >= 4 &&
        (reference.startsWith(registry) || registry.startsWith(reference)));
}
/**
 * The registry's first author, using Crossref's structured author when the
 * record has one. `family` is a personal surname; `name` is how Crossref
 * records an institutional author (and sometimes a full personal name).
 */
function registryAuthorOf(work) {
    const first = work?.author?.[0];
    if (first?.family) {
        const tokens = nameTokensOf(first.family);
        if (tokens.length > 0)
            return { kind: 'person', tokens };
    }
    if (first?.name?.trim()) {
        return { kind: 'institution', name: first.name.trim() };
    }
    return undefined;
}
function personNameMatch(referenceName, registryTokens) {
    if (!referenceName)
        return false;
    const referenceTokens = nameTokensOf(referenceName);
    if (referenceTokens.some((token) => registryTokens.includes(token)))
        return true;
    // A Han surname may be written with its given name attached (张 vs 张三).
    return referenceTokens.some((token) => registryTokens.some((registry) => /^\p{Script=Han}+$/u.test(registry) && token.startsWith(registry)));
}
/**
 * Parse one submitted entry as either a bare DOI or a bibliographic reference.
 *
 * The DOI is removed before year and author parsing: a DOI suffix can contain
 * a year-shaped number, and a doi.org URL would otherwise be read as an author
 * named "https".
 */
export function parseReferenceSnippet(text) {
    const doiMatch = DOI_PATTERN.exec(text);
    const doi = doiMatch ? cleanDoi(doiMatch[1]) : undefined;
    const remainder = withoutDoi(text, doiMatch?.[0]);
    const inputKind = hasBibliographicText(remainder) ? 'reference' : 'doi';
    if (inputKind === 'doi') {
        return { inputKind, doi, nameTokens: [], surnamesFirst: false, remainder: '' };
    }
    const rest = remainder.replace(/^(?:\[\d+\]|\d+\.?)\s*/, '');
    const leadingName = leadingNameOf(rest);
    const tail = leadingName ? rest.slice(rest.indexOf(leadingName) + leadingName.length) : '';
    return {
        inputKind,
        doi,
        year: parseYear(rest),
        leadingName,
        nameTokens: leadingName ? nameTokensOf(leadingName) : [],
        surnamesFirst: /^\s*,/.test(tail),
        remainder: rest,
    };
}
/**
 * Compare one parsed entry against the registry record it matched, pushing a
 * note per discrepancy.
 *
 * A DOI path and a search path hold the same work to different title bars. A
 * DOI names one specific record, so a title mismatch means the DOI was
 * misquoted, while a search hit only has to be the closest match. Supplied
 * fields are compared independently; an omitted field is `not-compared`.
 * @param parsed - the fields read out of the entry.
 * @param paper - the registry record.
 * @param work - the structured Crossref record, for author structure.
 * @param notes - the note list, appended in place.
 * @param source - 'doi' or 'search', which title bar to apply.
 * @returns the overall result and each field's verdict.
 */
function checkDiscrepancies(parsed, paper, work, notes, source) {
    const fields = uncomparedFields();
    let ok = true;
    if (parsed.inputKind === 'doi') {
        notes.push('DOI-only input: the identifier and the retraction state were checked; title, authors, and year were not supplied.');
    }
    else {
        const queryTokens = titleTokens(parsed.remainder);
        const paperTokens = titleTokens(paper.title);
        let tokenMatches = 0;
        for (const t of paperTokens) {
            if (queryTokens.has(t))
                tokenMatches++;
        }
        // How much of the paper's title the reference covers; a short title makes a
        // single shared token meaningful, a long one does not.
        const titleCoverage = paperTokens.size > 0 ? tokenMatches / paperTokens.size : 0;
        if (source === 'doi') {
            // A DOI names one record. If the title shares almost nothing with it, the
            // reference quoted the wrong DOI, and that is worth saying plainly.
            const titleMismatch = (titleCoverage < 0.35 && paperTokens.size >= 3) ||
                (paperTokens.size < 3 && tokenMatches === 0);
            if (titleMismatch) {
                notes.push(`DOI mismatch: DOI ${parsed.doi} belongs to a different paper ("${paper.title}").`);
                ok = false;
                fields.title = 'mismatch';
            }
            else {
                fields.title = 'match';
            }
        }
        else {
            // A search hit only needs to be the closest match: substring containment
            // plus shared tokens, so a truncated or differently worded reference still
            // counts as the same paper.
            const isTitleMatch = titleKey(parsed.remainder).includes(titleKey(paper.title)) ||
                (titleCoverage >= 0.5 && tokenMatches >= Math.min(2, paperTokens.size));
            if (isTitleMatch) {
                fields.title = 'match';
            }
            else {
                notes.push(`Closest match differed significantly ("${paper.title}").`);
                ok = false;
                fields.title = 'mismatch';
            }
        }
    }
    if (parsed.year !== undefined) {
        if (paper.year === undefined) {
            notes.push('The registry record has no publication year; year was not compared.');
        }
        else if (Math.abs(parsed.year - paper.year) > 1) {
            notes.push(`Year discrepancy: reference says ${parsed.year}, registry says ${paper.year}.`);
            ok = false;
            fields.year = 'mismatch';
        }
        else {
            fields.year = 'match';
        }
    }
    if (parsed.nameTokens.length > 0) {
        const registryAuthor = registryAuthorOf(work);
        if (!registryAuthor) {
            notes.push('The registry record lists no authors; author was not compared.');
        }
        else if (registryAuthor.kind === 'person' &&
            !parsed.surnamesFirst &&
            parsed.nameTokens.length > 2) {
            // A title-first entry has no author span; its first words are the title.
            // Only a surname-first form or a two-token personal name can be read as
            // an author without guessing.
            notes.push('The entry does not separate an author name from its title; author was not compared.');
        }
        else {
            const authorMatch = registryAuthor.kind === 'institution'
                ? institutionNameMatch(parsed.leadingName ?? '', registryAuthor.name)
                : personNameMatch(parsed.leadingName, registryAuthor.tokens);
            if (authorMatch) {
                fields.authors = 'match';
            }
            else {
                notes.push(`Author discrepancy: reference indicates author "${parsed.leadingName}", but registry lists "${paper.authors[0] ?? 'an unnamed author'}".`);
                ok = false;
                fields.authors = 'mismatch';
            }
        }
    }
    if (paper.retracted) {
        notes.push(source === 'doi'
            ? 'CRITICAL: This paper has been officially RETRACTED.'
            : 'CRITICAL: This matched paper has been RETRACTED.');
        ok = false;
    }
    return { ok, fields };
}
async function verifySingleReference(rawReference, host, keys, signal) {
    const parsed = parseReferenceSnippet(rawReference);
    const notes = [];
    let record;
    // A DOI the registry does not know. Recorded so the bibliographic fallback
    // can never certify a fabricated identifier as verified.
    let unregisteredDoi;
    if (parsed.doi) {
        try {
            const work = await lookupCrossrefWork(parsed.doi, host.http, keys, signal);
            if (work) {
                const paper = paperFromCrossref(work);
                const { ok, fields } = checkDiscrepancies(parsed, paper, work, notes, 'doi');
                return {
                    raw: rawReference,
                    inputKind: parsed.inputKind,
                    verdict: ok ? 'verified' : 'check',
                    doi: parsed.doi,
                    foundPaper: paper,
                    retracted: paper.retracted === true,
                    fields,
                    notes,
                };
            }
            unregisteredDoi = parsed.doi;
        }
        catch (error) {
            // `lookupCrossrefWork` normalizes a 404 to `undefined` and rethrows
            // everything else, so a throw here is a transport or registry failure,
            // never proof that the DOI does not exist.
            notes.push(`Crossref lookup failed for ${parsed.doi}: ${failureTextOf(error)}`);
            return {
                raw: rawReference,
                inputKind: parsed.inputKind,
                verdict: 'unverified',
                doi: parsed.doi,
                fields: uncomparedFields(),
                notes,
                ...(isLocalAddressRejection(error) ? { localRejection: true } : {}),
            };
        }
    }
    // A bare DOI carries no title to search with. Its 404 is final: the registry
    // answered and does not hold that identifier.
    if (parsed.inputKind === 'doi') {
        notes.push(`DOI ${parsed.doi ?? rawReference} is not registered in Crossref.`);
        return {
            raw: rawReference,
            inputKind: 'doi',
            verdict: 'not_found',
            doi: parsed.doi,
            fields: uncomparedFields(),
            notes,
        };
    }
    // If no DOI or DOI not found: search Crossref bibliographic match. The DOI is
    // stripped from the query so its digits and suffix do not pollute the search.
    try {
        const hits = await crossrefMatchReference(parsed.remainder || rawReference, 3, host.http, keys, signal);
        record = hits[0];
    }
    catch (error) {
        notes.push(`Crossref search failed: ${failureTextOf(error)}`);
        return {
            raw: rawReference,
            inputKind: parsed.inputKind,
            verdict: 'unverified',
            fields: uncomparedFields(),
            notes,
            ...(isLocalAddressRejection(error) ? { localRejection: true } : {}),
        };
    }
    if (!record || !record.title?.[0]) {
        notes.push(unregisteredDoi === undefined
            ? 'No matching publication record found in Crossref.'
            : `DOI ${unregisteredDoi} is not registered in Crossref, and no bibliographic match was found.`);
        return {
            raw: rawReference,
            inputKind: parsed.inputKind,
            verdict: 'not_found',
            fields: uncomparedFields(),
            notes,
        };
    }
    const paper = paperFromCrossref(record);
    const { ok, fields } = checkDiscrepancies(parsed, paper, record, notes, 'search');
    if (unregisteredDoi !== undefined) {
        // The metadata can match a real record while the supplied identifier stays
        // fictional; report the closest record, but never certify the missing DOI.
        notes.push(`DOI ${unregisteredDoi} is not registered in Crossref; the closest bibliographic match is ${paper.doi ?? 'a record without a DOI'}.`);
        return {
            raw: rawReference,
            inputKind: parsed.inputKind,
            verdict: 'check',
            doi: paper.doi,
            foundPaper: paper,
            retracted: paper.retracted === true,
            fields,
            notes,
        };
    }
    if (ok && paper.doi && !parsed.doi) {
        notes.push(`Found with DOI: ${paper.doi}.`);
    }
    return {
        raw: rawReference,
        inputKind: parsed.inputKind,
        verdict: ok ? 'verified' : 'check',
        doi: paper.doi,
        foundPaper: paper,
        retracted: paper.retracted === true,
        fields,
        notes,
    };
}
/** Badge shown for each verdict: the label a reader quotes back. */
const VERDICT_BADGE = {
    verified: 'VERIFIED',
    check: 'CHECK',
    not_found: 'NOT FOUND',
    unverified: 'UNVERIFIED',
};
function formatVerificationResult(result, index) {
    const badge = VERDICT_BADGE[result.verdict];
    const lines = [`[${index}] ${badge} ${result.raw.slice(0, 160)}`];
    lines.push(`    Input: ${result.inputKind === 'doi' ? 'DOI only' : 'reference'}`);
    if (result.doi)
        lines.push(`    DOI: https://doi.org/${result.doi}`);
    if (result.foundPaper?.title)
        lines.push(`    Registry Title: ${result.foundPaper.title}`);
    const authors = result.foundPaper?.authors ?? [];
    if (authors.length > 0) {
        lines.push(`    Registry Authors: ${authors.slice(0, 3).join(', ')}`);
    }
    if (result.foundPaper) {
        lines.push(`    Fields: title ${result.fields.title}, authors ${result.fields.authors}, year ${result.fields.year}`);
    }
    if (result.retracted)
        lines.push('    Retracted: yes');
    for (const note of result.notes)
        lines.push(`    • ${note}`);
    return lines.join('\n');
}
export function createScholarlyVerifyTool(host, options = {}) {
    const background = options.background ?? true;
    return defineTool({
        name: 'scholarly_verify',
        description: [
            'Audit and verify a list of academic references or citations against Crossref official registry records.',
            'Checks for phantom/hallucinated DOIs, title discrepancies, author/year mismatches, and retracted papers.',
            `Accepts raw bibliographic citation strings (APA, MLA, IEEE, etc.) or DOIs. Verifies up to ${SCHOLARLY_VERIFY_MAX_REFERENCES} references.`,
        ].join(' '),
        parameters: {
            ...VERIFY_PARAMETERS,
            ...(background ? RUN_IN_BACKGROUND_PARAMETER : {}),
        },
        output: SCHOLARLY_JOB_OUTPUT_DESCRIPTOR,
        isConcurrencySafe: () => true,
        timeoutMs: 240_000,
        async execute(args, exec) {
            // The cap is part of the tool's contract, so exceeding it is a named
            // refusal: silently dropping references would answer a different
            // question than the one asked. It counts the list as submitted,
            // blanks included, matching the ids cap in scholarly_cite.
            if (args.references.length > SCHOLARLY_VERIFY_MAX_REFERENCES) {
                throw new ZoteroError(`references accepts at most ${SCHOLARLY_VERIFY_MAX_REFERENCES} entries per call; got ${args.references.length}. Split the list across calls.`, ZOTERO_INVALID_ARGUMENT);
            }
            const list = args.references.map((r) => r.trim()).filter(Boolean);
            if (list.length === 0) {
                throw new ZoteroError('references parameter cannot be empty.', ZOTERO_INVALID_ARGUMENT);
            }
            return await runScholarlyJob({
                host,
                exec,
                label: `scholarly_verify (${list.length} references)`,
                runInBackground: args.run_in_background === true,
                run: async (signal, onProgress) => {
                    const keys = await host.keys();
                    const counts = {
                        verified: 0,
                        check: 0,
                        not_found: 0,
                        unverified: 0,
                    };
                    let completed = 0;
                    const results = await mapWithConcurrency(list, 5, async (refStr) => {
                        const report = () => {
                            completed += 1;
                            onProgress({
                                phase: 'reference',
                                current: completed,
                                total: list.length,
                                message: `Checked ${completed} of ${list.length} references`,
                            });
                        };
                        try {
                            const result = await verifySingleReference(refStr, host, keys, signal);
                            report();
                            return result;
                        }
                        catch (error) {
                            if (signal.aborted)
                                throw error;
                            // An unexpected failure while checking one reference says nothing
                            // about the work itself, so it is `unverified`, never `not_found`.
                            report();
                            return {
                                raw: refStr,
                                inputKind: parseReferenceSnippet(refStr).inputKind,
                                verdict: 'unverified',
                                fields: uncomparedFields(),
                                notes: [`Verification error: ${failureTextOf(error)}`],
                            };
                        }
                    }, { signal });
                    for (const checked of results)
                        counts[checked.verdict] += 1;
                    const localRejections = results.filter((result) => result.localRejection === true).length;
                    const allUnverifiedAreLocal = counts.unverified > 0 && localRejections === counts.unverified;
                    const summary = `Reference verification summary: ${counts.verified} verified, ${counts.check} to check, ` +
                        `${counts.not_found} not found, ${counts.unverified} unverified (of ${list.length} checked).\n` +
                        'VERIFIED: official record exists and every supplied field agrees (fields not supplied are not compared).\n' +
                        'CHECK: record found but a supplied field disagrees, or the paper is retracted.\n' +
                        'NOT FOUND: no matching record found in official registries; verify before using.\n' +
                        (allUnverifiedAreLocal
                            ? 'UNVERIFIED: the local address gate refused the registry read; this is not an index outage.\n'
                            : 'UNVERIFIED: the registry could not be reached; nothing is known about this entry.\n') +
                        'Registry facts only: this tool does not assess whether a paper supports a claim.\n' +
                        verificationNextStepOf(localRejections, counts.unverified);
                    const lines = results.map((r, i) => formatVerificationResult(r, i + 1)).join('\n\n');
                    return {
                        text: `${summary}\n\n${lines}`,
                        // The marker is an internal classification, not part of the tool's
                        // JSON contract; strip it before projecting the checks.
                        checks: toCleanJsonRecords(results.map(({ localRejection: _localRejection, ...result }) => result)),
                    };
                },
            });
        },
        presentCall: (args) => ({
            card: 'generic',
            title: 'Verify references',
            rawInput: `${(args.references ?? []).length} items`,
            kind: 'search',
        }),
        presentResult: (_args, result) => presentJobArm('Scholarly verify', metaRecordOf(result) ?? {}),
    });
}
//# sourceMappingURL=verify.js.map