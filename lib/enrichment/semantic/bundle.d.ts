/** Runtime loading uses the same bundle inspection as status and installation. */
import { type SemanticModelEntry } from '../../enrichment-model-catalog.js';
import { type Embedder } from './session.js';
interface SemanticBundleVerifier {
    verify(dir: string, spec: SemanticModelEntry): Promise<void>;
}
/** Reuse the inspector's bounded process cache across loader replacements. */
export declare function createBundleVerifier(): SemanticBundleVerifier;
/** The verified bytes are the bytes the runtime receives, including after a path replacement. */
export declare function readPinnedBundleFile(spec: SemanticModelEntry, dir: string, path: string): Promise<Buffer>;
export declare function readJsonFile(spec: SemanticModelEntry, dir: string, path: string): Promise<unknown>;
export declare function verifySemanticBundle(dir: string, spec: SemanticModelEntry): Promise<void>;
/** Verify the complete bundle before creating a session. */
export declare function openSemanticEmbedder(spec: SemanticModelEntry, dir: string, verifier?: SemanticBundleVerifier): Promise<Embedder>;
export {};
//# sourceMappingURL=bundle.d.ts.map