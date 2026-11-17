/** Each panel arm is checked against the actual registered tool's argument type. */
import type { InferArgs } from '@deepseek-ai/dsh-tools'
import { UPDATE_ITEM_PARAMETERS as item } from '../../../src/tools/update-item.ts'
import { UPDATE_ITEM_TAGS_PARAMETERS as tags } from '../../../src/tools/update-item-tags.ts'
import { UPDATE_ITEM_COLLECTIONS_PARAMETERS as membership } from '../../../src/tools/update-item-collections.ts'
import { CREATE_ITEM_PARAMETERS as createItem } from '../../../src/tools/create-item.ts'
import { CREATE_NOTE_PARAMETERS as createNote } from '../../../src/tools/create-note.ts'
import { PARAMETERS as updateNote } from '../../../src/tools/update-note.ts'
import { CREATE_COLLECTION_PARAMETERS as createCollection } from '../../../src/tools/create-collection.ts'
import { PARAMETERS as updateCollection } from '../../../src/tools/update-collection.ts'
import { DELETE_COLLECTION_PARAMETERS as deleteCollection } from '../../../src/tools/delete-collection.ts'
import {
  CREATE_SEARCH_PARAMETERS as createSearch,
  UPDATE_SEARCH_PARAMETERS as updateSearch,
  DELETE_SEARCH_PARAMETERS as deleteSearch,
} from '../../../src/tools/saved-search.ts'
import { PARAMETERS as restore } from '../../../src/tools/restore-items.ts'
import { BATCH_ITEMS_PARAMETERS as batch } from '../../../src/tools/batch-items.ts'
import type { ZoteroLibraryWriteRequestView } from '../../../src/contract.ts'
import { itemRef, collectionRef, savedSearchRef, NOTE_KEY } from '../../helpers/server/keys.ts'

export const libraryWriteCases = [
  {
    operation: 'updateItem',
    tool: 'zotero_update_item',
    args: { ref: itemRef(), set: { title: 'Updated' } } satisfies InferArgs<typeof item>,
  },
  {
    operation: 'updateTags',
    tool: 'zotero_update_item_tags',
    args: { ref: itemRef(), add: ['reviewed'] } satisfies InferArgs<typeof tags>,
  },
  {
    operation: 'updateMembership',
    tool: 'zotero_update_item_collections',
    args: { ref: itemRef(), add: [collectionRef()] } satisfies InferArgs<typeof membership>,
  },
  {
    operation: 'createItem',
    tool: 'zotero_create_item',
    args: { itemType: 'journalArticle', title: 'New item' } satisfies InferArgs<typeof createItem>,
  },
  {
    operation: 'createNote',
    tool: 'zotero_create_note',
    args: { markdown: 'New note' } satisfies InferArgs<typeof createNote>,
  },
  {
    operation: 'updateNote',
    tool: 'zotero_update_note',
    args: { ref: itemRef(NOTE_KEY), markdown: 'Updated note' } satisfies InferArgs<
      typeof updateNote
    >,
  },
  {
    operation: 'createCollection',
    tool: 'zotero_create_collection',
    args: { name: 'New collection' } satisfies InferArgs<typeof createCollection>,
  },
  {
    operation: 'updateCollection',
    tool: 'zotero_update_collection',
    args: { collection: collectionRef(), name: 'Updated collection' } satisfies InferArgs<
      typeof updateCollection
    >,
  },
  {
    operation: 'deleteCollection',
    tool: 'zotero_delete_collection',
    args: { collection: collectionRef() } satisfies InferArgs<typeof deleteCollection>,
  },
  {
    operation: 'createSavedSearch',
    tool: 'zotero_create_saved_search',
    args: {
      name: 'New search',
      conditions: [{ condition: 'title', operator: 'contains', value: 'carbon' }],
    } satisfies InferArgs<typeof createSearch>,
  },
  {
    operation: 'updateSavedSearch',
    tool: 'zotero_update_saved_search',
    args: { search: savedSearchRef(), name: 'Updated search' } satisfies InferArgs<
      typeof updateSearch
    >,
  },
  {
    operation: 'deleteSavedSearch',
    tool: 'zotero_delete_saved_search',
    args: { search: savedSearchRef() } satisfies InferArgs<typeof deleteSearch>,
  },
  {
    operation: 'trash',
    tool: 'zotero_batch_items',
    args: { refs: [itemRef()] },
    dispatched: { delete: [itemRef()] } satisfies InferArgs<typeof batch>,
  },
  {
    operation: 'restore',
    tool: 'zotero_restore_items',
    args: { refs: [itemRef()] } satisfies InferArgs<typeof restore>,
  },
  {
    operation: 'batch',
    tool: 'zotero_batch_items',
    args: { create: [{ itemType: 'journalArticle', title: 'Batch item' }] } satisfies InferArgs<
      typeof batch
    >,
  },
] as const satisfies readonly {
  operation: ZoteroLibraryWriteRequestView['operation']
  tool: string
  args: unknown
  dispatched?: unknown
}[]
