declare type MigrateOptions = {
    /**
     * Policy for integers whose magnitude exceeds Number.MAX_SAFE_INTEGER.
     * - 'reject' (default): throw a MigrationError naming the value's path
     *   and source range.
     * - 'string': emit the exact decimal value as a JSON string.
     */
    unsafeInteger?: 'reject' | 'string' | null

    /**
     * Policy for NaN and Infinity, which strict JSON cannot represent.
     * - 'reject' (default): throw a MigrationError naming the value's path
     *   and source range.
     * - 'null': emit null.
     */
    nonFinite?: 'reject' | 'null' | null

    /**
     * A String or Number object that's used to insert white space into the
     * output JSON string for readability purposes. Behaves like the space
     * parameter of JSON.stringify.
     */
    space?: string | number | null
}

/**
 * Migrates a JSON5 document to strict JSON text.
 *
 * The conversion is lexical: numbers are rewritten from their original
 * source tokens and are never round-tripped through a JavaScript Number,
 * so no precision is lost silently. The output is only returned when the
 * whole document converts cleanly; otherwise a MigrationError (or a
 * SyntaxError for malformed JSON5) is thrown and no output is produced.
 * @param text The JSON5 source text.
 * @param options An object specifying migration options.
 * @returns The strict JSON text.
 */
declare function migrate(text: string, options?: MigrateOptions | null): string

export = migrate
