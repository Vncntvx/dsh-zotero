export const ARTIFACT_IMAGE_NAME_PATTERN = /^images\/[A-Za-z0-9][A-Za-z0-9._-]{0,110}\.(?:png|jpe?g|gif|webp|bmp)$/u;
const MEDIA_TYPES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
};
/** Resolve a Markdown destination without admitting nested or encoded escaping paths. */
export function artifactImageName(destination) {
    let name;
    try {
        name = decodeURIComponent(destination).replace(/^\.\//u, '');
    }
    catch {
        return undefined;
    }
    return ARTIFACT_IMAGE_NAME_PATTERN.test(name) ? name : undefined;
}
export function artifactImageMediaType(name) {
    return ARTIFACT_IMAGE_NAME_PATTERN.test(name)
        ? MEDIA_TYPES[name.slice(name.lastIndexOf('.') + 1)]
        : undefined;
}
export const ARCHIVE_MAX_IMAGES = 512;
export const ARCHIVE_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const ARCHIVE_MAX_IMAGE_TOTAL_BYTES = 128 * 1024 * 1024;
//# sourceMappingURL=artifact-images.js.map