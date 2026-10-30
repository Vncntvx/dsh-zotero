import {
  ZOTERO_COLLECTION_PATH_REQUEST_TYPE_SYMBOL,
  ZOTERO_COLLECTION_PATH_RESULT_TYPE_SYMBOL,
} from '../../../src/contract.ts'
import { runRemoteParitySpec } from '../helpers/remote-parity.ts'
const library = { type: 'user', id: 0 }
runRemoteParitySpec([
  {
    method: 'collectionPath',
    boundary: { kind: 'param', index: 0 },
    wire: 'collection path request',
    typeSymbol: ZOTERO_COLLECTION_PATH_REQUEST_TYPE_SYMBOL,
    valid: { library, ref: 'zotero://user/0/collection/COLL0001', libraryVersion: 3 },
    incomplete: [
      { library, ref: 'r' },
      { ref: 'r', libraryVersion: 3 },
    ],
    malformed: [
      { library, ref: '', libraryVersion: 3 },
      { library, ref: 'r', libraryVersion: -1 },
    ],
    undeclared: [{ library, ref: 'r', libraryVersion: 3, offset: 0 }],
    badEnum: [{ library: { type: 'remote', id: 0 }, ref: 'r', libraryVersion: 3 }],
  },
  {
    method: 'collectionPath',
    boundary: { kind: 'result' },
    wire: 'collection path result',
    typeSymbol: ZOTERO_COLLECTION_PATH_RESULT_TYPE_SYMBOL,
    valid: {
      library,
      libraryVersion: 3,
      path: [{ kind: 'collection', ref: 'r', name: 'Root', path: ['Root'], depth: 0 }],
    },
    incomplete: [
      { library, path: [] },
      { libraryVersion: 3, path: [] },
    ],
    malformed: [
      { library, libraryVersion: -1, path: [] },
      { library, libraryVersion: 3, path: {} },
    ],
    undeclared: [{ library, libraryVersion: 3, path: [], cached: true }],
    badEnum: [{ library, libraryVersion: 3, path: [{ kind: 'itemType', itemType: 'book' }] }],
  },
])
