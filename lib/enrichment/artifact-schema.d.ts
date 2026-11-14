/** Closed v2 persistence contracts; no older artifact or index format is read. */
import { z } from 'zod';
export declare const SHA256: z.ZodString;
export declare const PARSE_GENERATION: z.ZodUUID;
export declare const SOURCE_INDEX_MAX_BYTES: number;
export declare const SOURCE_INDEX_MAX_ENTRIES = 50000;
export declare const sourceStampSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"file">;
    size: z.ZodNumber;
    mtimeMs: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"bytes">;
    fingerprint: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"url">;
    url: z.ZodString;
    etag: z.ZodOptional<z.ZodString>;
    lastModified: z.ZodOptional<z.ZodString>;
    contentLength: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>], "kind">;
export declare const artifactMetaSchema: z.ZodObject<{
    version: z.ZodLiteral<2>;
    characterCount: z.ZodNumber;
    markdownBytes: z.ZodNumber;
    parser: z.ZodLiteral<"mineru">;
    format: z.ZodLiteral<"markdown">;
    sourceId: z.ZodString;
    generation: z.ZodUUID;
    identity: z.ZodString;
    sourceUrl: z.ZodOptional<z.ZodString>;
    mode: z.ZodEnum<{
        free: "free";
        pro: "pro";
    }>;
    contentFingerprint: z.ZodString;
    taskId: z.ZodString;
    files: z.ZodUnion<readonly [z.ZodTuple<[z.ZodLiteral<"full.md">], null>, z.ZodTuple<[z.ZodLiteral<"full.md">, z.ZodLiteral<"content_list.json">], null>]>;
    images: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        mediaType: z.ZodEnum<{
            "image/bmp": "image/bmp";
            "image/gif": "image/gif";
            "image/jpeg": "image/jpeg";
            "image/png": "image/png";
            "image/webp": "image/webp";
        }>;
        bytes: z.ZodNumber;
    }, z.core.$strict>>>;
    pageCount: z.ZodOptional<z.ZodNumber>;
    title: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const sourceRecordSchema: z.ZodObject<{
    version: z.ZodLiteral<2>;
    cacheKey: z.ZodString;
    fingerprint: z.ZodString;
    generation: z.ZodUUID;
    parser: z.ZodLiteral<"mineru">;
    format: z.ZodLiteral<"markdown">;
    stamp: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"file">;
        size: z.ZodNumber;
        mtimeMs: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"bytes">;
        fingerprint: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"url">;
        url: z.ZodString;
        etag: z.ZodOptional<z.ZodString>;
        lastModified: z.ZodOptional<z.ZodString>;
        contentLength: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>;
export type SourceIndexRecord = z.infer<typeof sourceRecordSchema>;
export declare const sourceIndexSchema: z.ZodObject<{
    version: z.ZodLiteral<2>;
    sources: z.ZodRecord<z.ZodString, z.ZodObject<{
        version: z.ZodLiteral<2>;
        cacheKey: z.ZodString;
        fingerprint: z.ZodString;
        generation: z.ZodUUID;
        parser: z.ZodLiteral<"mineru">;
        format: z.ZodLiteral<"markdown">;
        stamp: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"file">;
            size: z.ZodNumber;
            mtimeMs: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"bytes">;
            fingerprint: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"url">;
            url: z.ZodString;
            etag: z.ZodOptional<z.ZodString>;
            lastModified: z.ZodOptional<z.ZodString>;
            contentLength: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>>;
}, z.core.$strict>;
//# sourceMappingURL=artifact-schema.d.ts.map