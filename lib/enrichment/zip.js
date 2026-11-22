/** Bounded, two-pass extraction of the Markdown and the figures it actually references. */
import { readZipDirectory, readZipEntry } from './zip-reader.js';
import { artifactImageMediaType, ARCHIVE_MAX_IMAGES, ARCHIVE_MAX_IMAGE_BYTES, ARCHIVE_MAX_IMAGE_TOTAL_BYTES, } from '../artifact-images.js';
import { markdownImageReferences } from './markdown-images.js';
import { ZIP_MAX_FILE_BYTES, ZIP_MAX_ARCHIVE_BYTES } from './archive-limits.js';
export { ZIP_MAX_TOTAL_ENTRIES, ZIP_MAX_FILE_BYTES, ZIP_MAX_ARCHIVE_BYTES, } from './archive-limits.js';
const ZIP_MAX_IMAGES = ARCHIVE_MAX_IMAGES;
const ZIP_MAX_IMAGE_BYTES = ARCHIVE_MAX_IMAGE_BYTES;
const ZIP_MAX_IMAGE_TOTAL_BYTES = ARCHIVE_MAX_IMAGE_TOTAL_BYTES;
class ArchiveValidationError extends Error {
    code = 'ZOTERO_ENRICHMENT_ARCHIVE_INVALID';
    constructor(reason) {
        super(`MinerU result archive is invalid: ${reason}`);
    }
}
function invalid(reason) {
    throw new ArchiveValidationError(reason);
}
function unsafeName(name) {
    return (name === '' ||
        name.startsWith('/') ||
        name.includes('\\') ||
        name.includes('\0') ||
        name.split('/').some((segment) => segment === '..' || segment === ''));
}
function wanted(name) {
    const base = name.slice(name.lastIndexOf('/') + 1);
    if (base === 'full.md')
        return 'markdown';
    return base === 'content_list.json' || base.endsWith('_content_list.json')
        ? 'contentList'
        : undefined;
}
function imageOf(path) {
    const segments = path.split('/');
    if (segments.at(-2) !== 'images')
        return undefined;
    const name = `images/${segments.at(-1)}`;
    const mediaType = artifactImageMediaType(name);
    return mediaType === undefined ? undefined : { name, mediaType };
}
export function extractParsedFiles(bytes) {
    if (bytes.byteLength === 0)
        invalid('the archive is empty');
    if (bytes.byteLength > ZIP_MAX_ARCHIVE_BYTES)
        invalid('the archive exceeds the size ceiling');
    const imageEntries = new Map();
    const texts = new Map();
    try {
        for (const entry of readZipDirectory(bytes)) {
            const directory = entry.name.endsWith('/');
            if (unsafeName(directory ? entry.name.slice(0, -1) : entry.name))
                invalid('it contains an unsafe entry name');
            if (directory)
                continue;
            const image = imageOf(entry.name);
            if (image !== undefined) {
                if (imageEntries.has(image.name))
                    invalid('it contains duplicate figures');
                imageEntries.set(image.name, entry);
            }
            const kind = wanted(entry.name);
            if (kind === undefined)
                continue;
            if (texts.has(kind))
                invalid('it contains duplicate document entries');
            texts.set(kind, readZipEntry(bytes, entry, ZIP_MAX_FILE_BYTES));
        }
    }
    catch (error) {
        if (error instanceof ArchiveValidationError)
            throw error;
        invalid(`the archive could not be read (${error instanceof Error ? error.message : String(error)})`);
    }
    const markdownBytes = texts.get('markdown');
    if (markdownBytes === undefined)
        invalid('it does not contain full.md');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let markdown;
    let contentList;
    let references;
    try {
        markdown = decoder.decode(markdownBytes).trim();
        if (markdown === '')
            invalid('full.md is empty');
        const list = texts.get('contentList');
        if (list !== undefined) {
            const decoded = decoder.decode(list);
            if (!Array.isArray(JSON.parse(decoded)))
                invalid('content list must be a JSON array');
            contentList = decoded;
        }
        references = markdownImageReferences(markdown);
    }
    catch (error) {
        if (error instanceof ArchiveValidationError)
            throw error;
        invalid(`text or image references are invalid (${error instanceof Error ? error.message : String(error)})`);
    }
    if (references.length > ZIP_MAX_IMAGES)
        invalid('it references excessive figures');
    const selected = [];
    let total = 0;
    for (const name of references) {
        const entry = imageEntries.get(name);
        if (entry === undefined)
            invalid(`a referenced figure is missing: ${name}`);
        if (entry.size <= 0 ||
            entry.size > ZIP_MAX_IMAGE_BYTES ||
            (total += entry.size) > ZIP_MAX_IMAGE_TOTAL_BYTES)
            invalid('it contains an oversized or excessive figure');
        selected.push(entry);
    }
    const images = [];
    try {
        for (const entry of selected) {
            const image = imageOf(entry.name);
            const data = readZipEntry(bytes, entry, ZIP_MAX_IMAGE_BYTES);
            images.push({ ...image, data: new Uint8Array(data) });
        }
    }
    catch (error) {
        if (error instanceof ArchiveValidationError)
            throw error;
        invalid('a referenced figure could not be decompressed');
    }
    if (images.length !== references.length)
        invalid('a referenced figure could not be read');
    return {
        markdown,
        ...(contentList !== undefined ? { contentList } : {}),
        images: images.sort((a, b) => a.name.localeCompare(b.name, 'en')),
    };
}
//# sourceMappingURL=zip.js.map