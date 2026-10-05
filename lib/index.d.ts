import parse = require('./parse')
import stringify = require('./stringify')

/**
 * An immutable token record produced by the lexer during
 * `JSON5.parseWithTokens()`. Only the token's category and position are
 * exposed; the token's value is intentionally not included.
 */
interface TokenInfo {
    /** The category of the token (e.g. `'punctuator'`, `'identifier'`,
     * `'string'`, `'numeric'`, `'boolean'`, `'null'`, or `'eof'`). */
    readonly type: string
    /** The 1-based line number on which the token ends. */
    readonly line: number
    /** The 0-based column number immediately after the token's last
     * character. */
    readonly column: number
}

/**
 * Parses a JSON5 string like `JSON5.parse()`, while reporting each token to
 * `onToken` as it is produced by the lexer (a single pass; the input is not
 * scanned twice).
 * @template T The type of the return value.
 * @param text The string to parse as JSON5.
 * @param onToken A callback invoked with an immutable token record for every
 * token, including the final `'eof'` token. The callback may safely call
 * `JSON5.parse()` or `JSON5.parseWithTokens()` itself; nested parses use
 * independent state. If the callback throws, the parse is aborted and no
 * result is returned.
 * @returns The JavaScript value converted from the JSON5 string.
 */
declare function parseWithTokens<T = any>(
    text: string,
    onToken: (token: TokenInfo) => void,
): T

export {parse, parseWithTokens, stringify}
