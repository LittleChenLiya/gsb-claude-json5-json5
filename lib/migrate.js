const util = require('./util')

const MAX_SAFE_INTEGER_DEC = '9007199254740991'

/**
 * Error thrown when JSON5-to-JSON migration fails. In addition to the
 * message, it carries structured details about the offending source:
 *
 * - `path`:   path of the value in the document (e.g. `$.a[2].n`), if known
 * - `lexeme`: the original source text of the offending token, if applicable
 * - `start` / `end`: character offsets of the token in the source text
 * - `line` / `column`: 1-based line / column of the token start
 */
class MigrationError extends SyntaxError {
    constructor (message, details) {
        super(message)
        this.name = 'MigrationError'
        if (details) {
            Object.assign(this, details)
        }
    }
}

/**
 * Migrates a JSON5 document to strict JSON text.
 *
 * The conversion is lexical: numbers are rewritten from their original
 * source tokens and are never round-tripped through a JavaScript Number,
 * so no precision is lost silently. The output is only returned when the
 * whole document converts cleanly; otherwise a MigrationError (or a
 * SyntaxError for malformed JSON5) is thrown and no output is produced.
 *
 * @param text The JSON5 source text.
 * @param [options] Migration options.
 * @param [options.unsafeInteger='reject'] Policy for integers whose
 *   magnitude exceeds Number.MAX_SAFE_INTEGER: 'reject' throws a
 *   MigrationError, 'string' emits the exact decimal value as a JSON string.
 * @param [options.nonFinite='reject'] Policy for NaN and Infinity:
 *   'reject' throws a MigrationError, 'null' emits null.
 * @param [options.space] Like JSON.stringify's space parameter: a number
 *   of spaces (max 10) or a string (first 10 chars) used for indentation.
 * @returns The strict JSON text.
 */
function migrate (text, options) {
    options = options || {}

    const unsafeInteger = options.unsafeInteger || 'reject'
    if (unsafeInteger !== 'reject' && unsafeInteger !== 'string') {
        throw new TypeError(
            `JSON5 migration: invalid unsafeInteger policy '${unsafeInteger}'`
        )
    }

    const nonFinite = options.nonFinite || 'reject'
    if (nonFinite !== 'reject' && nonFinite !== 'null') {
        throw new TypeError(
            `JSON5 migration: invalid nonFinite policy '${nonFinite}'`
        )
    }

    const gap = normalizeGap(options.space)

    const lexer = newLexer(String(text))
    const parser = {
        lexer,
        token: lexer.next(),
        unsafeInteger,
        nonFinite,
        gap,
    }

    const output = parseValue(parser, '$', 0)

    if (parser.token.type !== 'eof') {
        throw parserError(parser, 'unexpected token after end of document')
    }

    return output
}

migrate.MigrationError = MigrationError

module.exports = migrate

// ---------------------------------------------------------------------------
// Numbers (lexical conversion, never via a JavaScript Number)
// ---------------------------------------------------------------------------

function convertNumber (parser, raw, path, start, end, line, column) {
    let sign = ''
    let rest = raw

    if (rest[0] === '+' || rest[0] === '-') {
        if (rest[0] === '-') {
            sign = '-'
        }

        rest = rest.slice(1)
    }

    if (rest === 'Infinity' || rest === 'NaN') {
        if (parser.nonFinite === 'null') {
            return 'null'
        }

        throw numberError(
            parser,
            `${rest} is not representable in strict JSON`,
            raw, path, start, end, line, column
        )
    }

    if (rest[0] === '0' && (rest[1] === 'x' || rest[1] === 'X')) {
        return convertHexInteger(
            parser, sign, rest.slice(2), raw, path, start, end, line, column
        )
    }

    return convertDecimal(sign, rest)
}

function convertHexInteger (parser, sign, digits, raw, path, start, end, line, column) {
    const dec = hexToDecimal(digits)

    if (dec === '0') {
        // A zero keeps its sign: -0x0 migrates to -0 (see docs/migration.md).
        return sign + '0'
    }

    const exact = sign + dec

    if (compareDecimal(dec, MAX_SAFE_INTEGER_DEC) <= 0) {
        return exact
    }

    if (parser.unsafeInteger === 'string') {
        return JSON.stringify(exact)
    }

    throw numberError(
        parser,
        `integer ${raw} exceeds Number.MAX_SAFE_INTEGER`,
        raw, path, start, end, line, column
    )
}

function convertDecimal (sign, rest) {
    const match = /^(\d*)(?:\.(\d*))?([eE][+-]?\d+)?$/.exec(rest)
    const intPart = match[1]
    const fracPart = match[2]
    const expPart = match[3]

    // A leading `-` is preserved even for zero values: -0, -0.0 and -0e5
    // all migrate to negative zero, never to 0 (see docs/migration.md).
    let out = sign

    out += intPart.length > 0 ? intPart : '0'

    if (fracPart !== undefined && fracPart.length > 0) {
        out += '.' + fracPart
    }

    if (expPart !== undefined) {
        out += expPart
    }

    return out
}

// Exact hexadecimal-to-decimal conversion using decimal string arithmetic.
// Never loses precision, regardless of the magnitude.
function hexToDecimal (digits) {
    // Little-endian array of decimal digits.
    const dec = [0]

    for (let i = 0; i < digits.length; i++) {
        let carry = parseInt(digits[i], 16)

        for (let j = 0; j < dec.length; j++) {
            const v = dec[j] * 16 + carry
            dec[j] = v % 10
            carry = Math.floor(v / 10)
        }

        while (carry > 0) {
            dec.push(carry % 10)
            carry = Math.floor(carry / 10)
        }
    }

    return dec.reverse().join('')
}

// Compares two non-negative decimal integer strings. Returns a negative
// number if a < b, zero if equal, a positive number if a > b.
function compareDecimal (a, b) {
    if (a.length !== b.length) {
        return a.length - b.length
    }

    return a < b ? -1 : (a > b ? 1 : 0)
}

function numberError (parser, reason, lexeme, path, start, end, line, column) {
    return new MigrationError(
        `JSON5 migration: ${reason} at ${path} ` +
        `(offset ${start}-${end}, line ${line}, column ${column + 1})`,
        {path, lexeme, start, end, line, column: column + 1}
    )
}

// ---------------------------------------------------------------------------
// Parser (recursive descent over the token stream, emitting strict JSON)
// ---------------------------------------------------------------------------

function parseValue (parser, path, depth) {
    const token = parser.token

    switch (token.type) {
    case 'punctuator':
        if (token.value === '{') {
            return parseObject(parser, path, depth)
        }

        if (token.value === '[') {
            return parseArray(parser, path, depth)
        }

        if (token.value === '-' || token.value === '+') {
            return parseSignedValue(parser, path)
        }

        break

    case 'number':
        advance(parser)
        return convertNumber(
            parser, token.value, path,
            token.start, token.end, token.line, token.column
        )

    case 'string':
        advance(parser)
        return JSON.stringify(token.value)

    case 'identifier':
        advance(parser)
        switch (token.value) {
        case 'null':
            return 'null'

        case 'true':
            return 'true'

        case 'false':
            return 'false'

        case 'Infinity':
        case 'NaN':
            return convertNumber(
                parser, token.value, path,
                token.start, token.end, token.line, token.column
            )
        }

        break
    }

    throw parserError(parser, 'unexpected token')
}

function parseSignedValue (parser, path) {
    const signToken = parser.token
    advance(parser)

    const token = parser.token

    if (token.type === 'number') {
        advance(parser)
        return convertNumber(
            parser, signToken.value + token.value, path,
            signToken.start, token.end, signToken.line, signToken.column
        )
    }

    if (token.type === 'identifier' &&
        (token.value === 'Infinity' || token.value === 'NaN')) {
        advance(parser)
        return convertNumber(
            parser, signToken.value + token.value, path,
            signToken.start, token.end, signToken.line, signToken.column
        )
    }

    throw parserError(parser, 'unexpected token after sign')
}

function parseObject (parser, path, depth) {
    advance(parser) // consume '{'

    const entries = []

    if (parser.token.type === 'punctuator' && parser.token.value === '}') {
        advance(parser)
        return '{}'
    }

    for (;;) {
        const keyToken = parser.token
        if (keyToken.type !== 'identifier' && keyToken.type !== 'string') {
            throw parserError(parser, 'expected a property name')
        }

        const key = String(keyToken.value)
        advance(parser)

        expect(parser, ':')

        const childPath = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
            ? path + '.' + key
            : path + '[' + JSON.stringify(key) + ']'

        const value = parseValue(parser, childPath, depth + 1)
        entries.push(JSON.stringify(key) + (parser.gap ? ': ' : ':') + value)

        const next = parser.token
        if (next.type === 'punctuator' && next.value === ',') {
            advance(parser)

            // A trailing comma is allowed in JSON5 and simply dropped.
            if (parser.token.type === 'punctuator' &&
                parser.token.value === '}') {
                advance(parser)
                break
            }

            continue
        }

        if (next.type === 'punctuator' && next.value === '}') {
            advance(parser)
            break
        }

        throw parserError(parser, "expected ',' or '}'")
    }

    return wrap(parser, '{', '}', entries, depth)
}

function parseArray (parser, path, depth) {
    advance(parser) // consume '['

    const elements = []

    if (parser.token.type === 'punctuator' && parser.token.value === ']') {
        advance(parser)
        return '[]'
    }

    for (;;) {
        const childPath = path + '[' + elements.length + ']'
        elements.push(parseValue(parser, childPath, depth + 1))

        const next = parser.token
        if (next.type === 'punctuator' && next.value === ',') {
            advance(parser)

            // A trailing comma is allowed in JSON5 and simply dropped.
            if (parser.token.type === 'punctuator' &&
                parser.token.value === ']') {
                advance(parser)
                break
            }

            continue
        }

        if (next.type === 'punctuator' && next.value === ']') {
            advance(parser)
            break
        }

        throw parserError(parser, "expected ',' or ']'")
    }

    return wrap(parser, '[', ']', elements, depth)
}

function wrap (parser, open, close, items, depth) {
    if (!parser.gap) {
        return open + items.join(',') + close
    }

    const indent = parser.gap.repeat(depth)
    const childIndent = parser.gap.repeat(depth + 1)

    return open + '\n' + childIndent + items.join(',\n' + childIndent) +
        '\n' + indent + close
}

function expect (parser, punctuator) {
    const token = parser.token
    if (token.type !== 'punctuator' || token.value !== punctuator) {
        throw parserError(parser, `expected '${punctuator}'`)
    }

    advance(parser)
}

function advance (parser) {
    parser.token = parser.lexer.next()
}

function parserError (parser, reason) {
    const token = parser.token
    return new MigrationError(
        `JSON5 migration: ${reason} at line ${token.line}, ` +
        `column ${token.column + 1}`,
        {
            start: token.start,
            end: token.end,
            line: token.line,
            column: token.column + 1,
        }
    )
}

function normalizeGap (space) {
    if (typeof space === 'number' && space > 0) {
        return ' '.repeat(Math.min(10, Math.floor(space)))
    }

    if (typeof space === 'string' && space.length > 0) {
        return space.slice(0, 10)
    }

    return ''
}

// ---------------------------------------------------------------------------
// Lexer (produces tokens with source ranges; never evaluates numbers)
// ---------------------------------------------------------------------------

function newLexer (source) {
    let pos = 0
    let line = 1
    let column = 0

    function peek (offset) {
        const p = pos + (offset || 0)
        if (p < source.length) {
            return String.fromCodePoint(source.codePointAt(p))
        }
    }

    function read () {
        const c = peek()

        if (c === '\n') {
            line++
            column = 0
        } else if (c) {
            column += c.length
        } else {
            column++
        }

        if (c) {
            pos += c.length
        }

        return c
    }

    function error (message) {
        const err = new SyntaxError(
            `${message} at line ${line}, column ${column + 1}`
        )
        err.lineNumber = line
        err.columnNumber = column + 1
        err.offset = pos
        return err
    }

    function invalidChar (c) {
        if (c === undefined) {
            return error('JSON5: invalid end of input')
        }

        return error(`JSON5: invalid character '${formatChar(c)}'`)
    }

    function skipWhitespaceAndComments () {
        for (;;) {
            const c = peek()

            switch (c) {
            case '\t':
            case '\v':
            case '\f':
            case ' ':
            case '\u00A0':
            case '\uFEFF':
            case '\n':
            case '\r':
            case '\u2028':
            case '\u2029':
                read()
                continue

            case '/':
                if (peek(1) === '/') {
                    read()
                    read()
                    skipSingleLineComment()
                    continue
                }

                if (peek(1) === '*') {
                    read()
                    read()
                    skipMultiLineComment()
                    continue
                }

                throw invalidChar(read())
            }

            if (util.isSpaceSeparator(c)) {
                read()
                continue
            }

            return
        }
    }

    function skipSingleLineComment () {
        for (;;) {
            const c = peek()

            switch (c) {
            case '\n':
            case '\r':
            case '\u2028':
            case '\u2029':
            case undefined:
                return
            }

            read()
        }
    }

    function skipMultiLineComment () {
        for (;;) {
            const c = peek()

            if (c === undefined) {
                throw invalidChar(read())
            }

            if (c === '*' && peek(1) === '/') {
                read()
                read()
                return
            }

            read()
        }
    }

    function token (type, value, start, tokenLine, tokenColumn) {
        return {
            type,
            value,
            start,
            end: pos,
            line: tokenLine,
            column: tokenColumn,
        }
    }

    function lexString (quoteChar, start, tokenLine, tokenColumn) {
        let buffer = ''

        for (;;) {
            const c = peek()

            if (c === undefined || c === '\n' || c === '\r') {
                throw invalidChar(read())
            }

            if (c === quoteChar) {
                read()
                return token('string', buffer, start, tokenLine, tokenColumn)
            }

            if (c === '\\') {
                read()
                buffer += lexEscape()
                continue
            }

            buffer += read()
        }
    }

    function lexEscape () {
        const c = peek()

        switch (c) {
        case 'b':
            read()
            return '\b'

        case 'f':
            read()
            return '\f'

        case 'n':
            read()
            return '\n'

        case 'r':
            read()
            return '\r'

        case 't':
            read()
            return '\t'

        case 'v':
            read()
            return '\v'

        case '0':
            read()
            if (util.isDigit(peek())) {
                throw invalidChar(read())
            }

            return '\0'

        case 'x':
            read()
            return lexHexEscape(2)

        case 'u':
            read()
            return lexHexEscape(4)

        case '\n':
        case '\u2028':
        case '\u2029':
            read()
            return ''

        case '\r':
            read()
            if (peek() === '\n') {
                read()
            }

            return ''

        case undefined:
            throw invalidChar(read())
        }

        return read()
    }

    function lexHexEscape (count) {
        let buffer = ''

        while (count-- > 0) {
            const c = peek()
            if (!util.isHexDigit(c)) {
                throw invalidChar(read())
            }

            buffer += read()
        }

        return String.fromCodePoint(parseInt(buffer, 16))
    }

    function lexNumber (start, tokenLine, tokenColumn) {
        let buffer = ''

        if (peek() === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
            buffer += read()
            buffer += read()

            if (!util.isHexDigit(peek())) {
                throw invalidChar(read())
            }

            while (util.isHexDigit(peek())) {
                buffer += read()
            }

            return token('number', buffer, start, tokenLine, tokenColumn)
        }

        let digits = 0

        if (peek() === '0') {
            buffer += read()
            digits++

            // Leading zeros are not allowed in JSON5 numbers.
            if (util.isDigit(peek())) {
                throw invalidChar(read())
            }
        } else {
            while (util.isDigit(peek())) {
                buffer += read()
                digits++
            }
        }

        if (peek() === '.') {
            buffer += read()

            while (util.isDigit(peek())) {
                buffer += read()
                digits++
            }
        }

        if (digits === 0) {
            throw invalidChar(read())
        }

        if (peek() === 'e' || peek() === 'E') {
            buffer += read()

            const signChar = peek()
            if (signChar === '+' || signChar === '-') {
                buffer += read()
            }

            if (!util.isDigit(peek())) {
                throw invalidChar(read())
            }

            while (util.isDigit(peek())) {
                buffer += read()
            }
        }

        return token('number', buffer, start, tokenLine, tokenColumn)
    }

    function lexIdentifier (start, tokenLine, tokenColumn) {
        let buffer = ''

        for (;;) {
            let c = peek()

            if (c === '\\') {
                read()
                if (peek() !== 'u') {
                    throw invalidChar(read())
                }

                read()
                c = lexHexEscape(4)
                if (buffer.length === 0
                    ? !util.isIdStartChar(c)
                    : !util.isIdContinueChar(c)) {
                    throw error('JSON5: invalid identifier character')
                }

                buffer += c
                continue
            }

            if (buffer.length === 0
                ? util.isIdStartChar(c)
                : util.isIdContinueChar(c)) {
                buffer += read()
                continue
            }

            if (buffer.length === 0) {
                throw invalidChar(read())
            }

            return token('identifier', buffer, start, tokenLine, tokenColumn)
        }
    }

    function next () {
        skipWhitespaceAndComments()

        const start = pos
        const tokenLine = line
        const tokenColumn = column
        const c = peek()

        if (c === undefined) {
            return token('eof', undefined, start, tokenLine, tokenColumn)
        }

        switch (c) {
        case '{':
        case '}':
        case '[':
        case ']':
        case ':':
        case ',':
        case '-':
        case '+':
            return token('punctuator', read(), start, tokenLine, tokenColumn)

        case '.':
            return lexNumber(start, tokenLine, tokenColumn)

        case '"':
        case "'":
            read()
            return lexString(c, start, tokenLine, tokenColumn)
        }

        if (util.isDigit(c)) {
            return lexNumber(start, tokenLine, tokenColumn)
        }

        return lexIdentifier(start, tokenLine, tokenColumn)
    }

    return {next}
}

function formatChar (c) {
    const replacements = {
        "'": "\\'",
        '"': '\\"',
        '\\': '\\\\',
        '\b': '\\b',
        '\f': '\\f',
        '\n': '\\n',
        '\r': '\\r',
        '\t': '\\t',
        '\v': '\\v',
        '\0': '\\0',
        '\u2028': '\\u2028',
        '\u2029': '\\u2029',
    }

    if (replacements[c]) {
        return replacements[c]
    }

    if (c < ' ') {
        const hexString = c.charCodeAt(0).toString(16)
        return '\\x' + ('00' + hexString).substring(hexString.length)
    }

    return c
}
