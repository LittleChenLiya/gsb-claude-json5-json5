/**
 * Options for migrating a JSON5 document to strict JSON.
 */
export interface MigrateOptions {
    /**
     * What to do when an integer is outside the JavaScript safe-integer range.
     * - `'reject'` (default): throw a {@link JSON5MigrationError}.
     * - `'string'`: encode the integer as a decimal string.
     */
    onUnsafeInteger?: 'reject' | 'string'

    /**
     * What to do when a number is NaN or Infinity.
     * - `'reject'` (default): throw a {@link JSON5MigrationError}.
     * - `'null'`: encode the number as `null`.
     */
    onNonFinite?: 'reject' | 'null'
}

/**
 * Error thrown when a JSON5 document cannot be migrated to strict JSON.
 */
export class JSON5MigrationError extends Error {
    /** Path to the offending number, e.g. `$.n` or `$[0].foo`. */
    path: string
    /** Start offset of the original number text (0-based). */
    start: number
    /** End offset of the original number text (exclusive, 0-based). */
    end: number
    /** Start line of the original number text (1-based). */
    line: number
    /** Start column of the original number text (1-based). */
    column: number
    /** The original lexical number text. */
    raw: string
    /** The kind of migration failure. */
    kind: 'unsafe-integer' | 'non-finite'
}

/**
 * Migrate a JSON5 document to strict JSON.
 *
 * Comments and trailing commas are removed. Numbers are converted based on
 * their original lexical text — they are never round-tripped through a
 * JavaScript Number. Hexadecimal integers are converted to exact decimal
 * strings. Integers outside the safe range are either rejected or encoded as
 * decimal strings depending on `options.onUnsafeInteger`. NaN and Infinity
 * are either rejected or encoded as `null` depending on
 * `options.onNonFinite`. The output is produced only when every number in the
 * document converts successfully.
 *
 * @param text The JSON5 document to migrate.
 * @param options Migration options.
 * @returns The strict JSON text.
 * @throws {@link JSON5MigrationError} If a number cannot be migrated and the
 *   corresponding strategy is `'reject'`.
 */
declare function migrate (text: string, options?: MigrateOptions): string

export = migrate
