/**
 * The display name of one Zotero item type. The wire carries the camelCase
 * schema name (`journalArticle`, `conferencePaper`); a reader should see the
 * panel's own language instead, so this module resolves the label in three
 * steps: the plugin dictionary (which follows the panel's UI language), then
 * Zotero's `localized` name from its `/itemTypes` listing (which covers custom
 * types this table does not know), and finally the raw wire value.
 * @module dsh-zotero/client/components/library/item-type-labels
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroLocaleKey } from '../../locales.ts'

/** The dictionary key for every standard Zotero item type. */
const ITEM_TYPE_LOCALE_KEYS = {
  annotation: 'libraryItemTypeAnnotation',
  artwork: 'libraryItemTypeArtwork',
  attachment: 'libraryItemTypeAttachment',
  audioRecording: 'libraryItemTypeAudioRecording',
  bill: 'libraryItemTypeBill',
  blogPost: 'libraryItemTypeBlogPost',
  book: 'libraryItemTypeBook',
  bookSection: 'libraryItemTypeBookSection',
  case: 'libraryItemTypeCase',
  computerProgram: 'libraryItemTypeComputerProgram',
  conferencePaper: 'libraryItemTypeConferencePaper',
  dataset: 'libraryItemTypeDataset',
  dictionaryEntry: 'libraryItemTypeDictionaryEntry',
  document: 'libraryItemTypeDocument',
  email: 'libraryItemTypeEmail',
  encyclopediaArticle: 'libraryItemTypeEncyclopediaArticle',
  film: 'libraryItemTypeFilm',
  forumPost: 'libraryItemTypeForumPost',
  hearing: 'libraryItemTypeHearing',
  instantMessage: 'libraryItemTypeInstantMessage',
  interview: 'libraryItemTypeInterview',
  journalArticle: 'libraryItemTypeJournalArticle',
  letter: 'libraryItemTypeLetter',
  magazineArticle: 'libraryItemTypeMagazineArticle',
  manuscript: 'libraryItemTypeManuscript',
  map: 'libraryItemTypeMap',
  newspaperArticle: 'libraryItemTypeNewspaperArticle',
  note: 'libraryItemTypeNote',
  patent: 'libraryItemTypePatent',
  podcast: 'libraryItemTypePodcast',
  preprint: 'libraryItemTypePreprint',
  presentation: 'libraryItemTypePresentation',
  radioBroadcast: 'libraryItemTypeRadioBroadcast',
  report: 'libraryItemTypeReport',
  standard: 'libraryItemTypeStandard',
  statute: 'libraryItemTypeStatute',
  thesis: 'libraryItemTypeThesis',
  tvBroadcast: 'libraryItemTypeTvBroadcast',
  videoRecording: 'libraryItemTypeVideoRecording',
  webpage: 'libraryItemTypeWebpage',
} as const satisfies Readonly<Record<string, ZoteroLocaleKey>>

/** Zotero's `localized` names for the item types it served, keyed by type. */
export type ItemTypeLocalizedNames = Readonly<Record<string, string>>

/**
 * The label one row shows for its item type.
 * @param itemType - the camelCase schema name the wire carries.
 * @param localized - Zotero's own localized names, when the panel read them.
 * @param t - the panel's translator.
 * @returns the plugin dictionary label, else Zotero's localized name, else the raw name.
 */
export function itemTypeLabelOf(
  itemType: string,
  localized: ItemTypeLocalizedNames | undefined,
  t: TranslateNS<'zotero'>,
): string {
  const key = ITEM_TYPE_LOCALE_KEYS[itemType as keyof typeof ITEM_TYPE_LOCALE_KEYS]
  if (key !== undefined) return t(key)
  const fromZotero = localized?.[itemType]
  if (fromZotero !== undefined && fromZotero !== '') return fromZotero
  return itemType
}
