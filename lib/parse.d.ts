/**
 * Parses a JSON5 string, constructing the JavaScript value or object described
 * by the string.
 * @template T The type of the return value.
 * @param text The string to parse as JSON5.
 * @param reviver A function that prescribes how the value originally produced
 * by parsing is transformed before being returned.
 * @returns The JavaScript value converted from the JSON5 string.
 */
declare function parse<T = any>(
    text: string,
    reviver?: ((this: any, key: string, value: any) => any) | null,
): T

declare namespace parse {
    /**
     * The category of a token produced by the lexical process.
     */
    type TokenType =
        | 'punctuator'
        | 'null'
        | 'boolean'
        | 'numeric'
        | 'string'
        | 'identifier'
        | 'eof'

    /**
     * An immutable token produced by `parseWithTokens`. Contains only the
     * token category and its position; the original token value is not included.
     */
    interface Token {
        readonly type: TokenType
        /** The 1-based line number of the token's position. */
        readonly line: number
        /** The 0-based column number of the token's position. */
        readonly column: number
    }

    /**
     * Parses a JSON5 string and reports each token produced by the actual
     * lexical process. The callback receives immutable token objects that
     * contain only the token category and its position; the original token
     * value is never included.
     *
     * The callback may safely call `parse` (or `parseWithTokens`) on any text;
     * each parsing session keeps its own state, so a nested session never
     * overwrites the source, cursor, or stack of the outer session. If the
     * callback throws, parsing is terminated and no resulting value is
     * delivered.
     *
     * @param text The string to parse as JSON5.
     * @param onToken A function called with each immutable token as it is lexed.
     */
    function parseWithTokens(
        text: string,
        onToken: (token: Token) => void,
    ): void
}

export = parse
