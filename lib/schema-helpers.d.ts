/**
 * Two schemastery idioms shared by component configs: a closed choice over
 * frozen values, and unwrapping a volatile reference to its live value. One
 * definition keeps the three config schemas consistent in how they read a
 * committed field.
 * @module dsh-zotero/schema-helpers
 */
import type { Volatile } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
/** A closed schema over the given values, in order. */
export declare const schemaChoices: (values: readonly (string | number)[]) => Schema<string | number, string | number, "plain">;
/** Read one config field's current value, unwrapping a volatile reference. */
export declare function currentVolatile<T>(value: T | Volatile<T> | undefined): T | undefined;
//# sourceMappingURL=schema-helpers.d.ts.map