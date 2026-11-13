/** Shared archive ceilings; this module carries no unpacker dependency. */
export {
  ARCHIVE_MAX_IMAGES,
  ARCHIVE_MAX_IMAGE_BYTES,
  ARCHIVE_MAX_IMAGE_TOTAL_BYTES,
} from '../artifact-images.js'

export const ZIP_MAX_TOTAL_ENTRIES = 4_096
export const ZIP_MAX_WANTED_ENTRIES = 2
export const ZIP_MAX_FILE_BYTES = 32 * 1024 * 1024
export const ZIP_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
