/**
 * DBLP adapter querying dblp.org Computer Science Bibliography API.
 * @module dsh-zotero/scholarly/sources/dblp
 */
import type { ScholarlyHttp } from '../transport/http.js';
import { type ScholarlyPaper, type ScholarlyQuery } from '../types.js';
interface DblpHit {
    info?: {
        title?: string;
        authors?: {
            author?: Array<{
                text?: string;
            }> | {
                text?: string;
            };
        };
        venue?: string | string[];
        year?: string;
        doi?: string;
        ee?: string | string[];
        type?: string;
        url?: string;
    };
}
export declare function cleanDblpAuthor(name: string): string;
export declare function paperFromDblp(hit: DblpHit): ScholarlyPaper;
export declare function searchDblp(query: ScholarlyQuery, http: ScholarlyHttp, signal?: AbortSignal): Promise<ScholarlyPaper[]>;
export {};
//# sourceMappingURL=dblp.d.ts.map