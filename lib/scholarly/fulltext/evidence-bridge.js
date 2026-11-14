/**
 * Fulltext outline extraction and passage ranking for `scholarly_read`.
 *
 * Segmentation and ranking are **the host's**: `chunkText` here and the
 * `EvidenceRanker` the host supplies, both from `src/evidence.ts` and
 * `src/local/evidence-ranker.ts`. A second splitter or a second ranker here
 * would cut a `scholarly_read query=` hit and a `zotero_retrieve` hit over the
 * same paper on different boundaries, or rank them by different rules: two
 * answers to "what is a passage" and "what counts as a match" for one library.
 * This module adds section addressing on top, nothing else.
 *
 * The offsets reported here are character spans of the source text, labelled
 * as such: `zotero_retrieve` reports ranked chunks, and a bare `offset` would
 * read as the same unit.
 *
 * @module dsh-zotero/scholarly/fulltext/evidence-bridge
 */
import { chunkText } from '../../evidence.js';
/**
 * Extracts hierarchical section outline from structured full text (Markdown, ar5iv/HTML, JATS).
 */
export function extractOutline(text) {
    const sections = [];
    // Matches markdown headings e.g. "# 1. Introduction" or "## 2. Method"
    const mdHeadingRegex = /^(#{1,4})\s+(?:(\d+(?:\.\d+)*)\.?\s*)?([^\n]+)$/gm;
    let match;
    const matches = [];
    while ((match = mdHeadingRegex.exec(text)) !== null) {
        const level = match[1].length;
        const num = match[2];
        const title = match[3].trim();
        matches.push({ level, num, title, index: match.index });
    }
    const usedIds = new Set();
    const hasNumbered = matches.some((m) => m.num !== undefined);
    for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const next = matches[i + 1];
        const start = current.index;
        const end = next ? next.index : text.length;
        let id = current.num ?? (hasNumbered ? `s${i + 1}` : String(i + 1));
        if (usedIds.has(id)) {
            id = `${id}-${i + 1}`;
        }
        usedIds.add(id);
        sections.push({
            id,
            level: current.level,
            title: current.title,
            start,
            end,
        });
    }
    return sections;
}
export function findSection(sections, query) {
    const needle = query.trim().toLowerCase();
    if (!needle)
        return undefined;
    // 1. Exact ID match (e.g. "3" or "3.1")
    const byId = sections.find((s) => s.id.toLowerCase() === needle);
    if (byId)
        return byId;
    // 2. Exact Title match
    const byExactTitle = sections.find((s) => s.title.toLowerCase() === needle);
    if (byExactTitle)
        return byExactTitle;
    // 3. Substring match
    return sections.find((s) => s.title.toLowerCase().includes(needle));
}
/**
 * Ranks source passages against a natural-language query through the host's
 * ranking strategy over the host's own chunking.
 *
 * Chunk size is expressed in words with a character ceiling taken from the
 * core's live limits, so `scholarly_read query=` and `zotero_retrieve` cut the
 * same paper on the same passage boundaries and rank by the same rules.
 * @param options - the ranker, the text, the question, and the boundaries.
 * @returns the best-scoring passages with their character spans and the routes
 * that ran.
 */
export async function rankPassages(options) {
    const limit = options.limit ?? 5;
    const maxWords = options.maxWords ?? 180;
    const maxCharsPerChunk = options.maxCharsPerChunk ?? 1_200;
    if (options.query.trim() === '')
        return { passages: [], routes: [] };
    // A caller that admitted before source I/O owns the scope; otherwise admit
    // here so a standalone call still keeps its committed generation.
    const admitted = options.scope === undefined ? options.ranker.admit?.() : undefined;
    const scope = options.scope ?? admitted?.handle;
    try {
        const chunks = chunkText(options.text, maxWords, maxCharsPerChunk);
        if (chunks.length === 0)
            return { passages: [], routes: [] };
        const result = await options.ranker.rank({
            query: options.query,
            ...(options.queryVariants === undefined ? {} : { queryVariants: options.queryVariants }),
            chunks,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            ...(scope === undefined ? {} : { scope }),
        });
        const passages = [];
        for (const entry of result.matches) {
            if (passages.length >= limit)
                break;
            // A ranker contract violation (unknown index) is skipped rather than
            // rendered as an empty passage with fabricated offsets.
            const chunk = chunks[entry.index];
            if (chunk === undefined)
                continue;
            passages.push({
                start: chunk.start ?? 0,
                end: chunk.end ?? 0,
                text: chunk.text,
                score: entry.score,
                matchKind: entry.matchKind,
                ...(entry.lexicalScore === undefined ? {} : { lexicalScore: entry.lexicalScore }),
                ...(entry.semanticScore === undefined ? {} : { semanticScore: entry.semanticScore }),
            });
        }
        return { passages, routes: result.routes };
    }
    finally {
        admitted?.release();
    }
}
//# sourceMappingURL=evidence-bridge.js.map