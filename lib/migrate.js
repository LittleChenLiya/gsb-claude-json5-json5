'use strict'

const util = require('./util')

const MAX_SAFE_INTEGER = BigInt('9007199254740991')
const MIN_SAFE_INTEGER = BigInt('-9007199254740991')

class JSON5MigrationError extends Error {
    constructor (message, info) {
        super(message)
        this.name = 'JSON5MigrationError'
        this.path = info.path
        this.start = info.start
        this.end = info.end
        this.line = info.line
        this.column = info.column
        this.raw = info.raw
        this.kind = info.kind
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, JSON5MigrationError)
        }
    }
}

function migrate (text, options) {
    options = options || {}
    const onUnsafeInteger = options.onUnsafeInteger || 'reject'
    const onNonFinite = options.onNonFinite || 'reject'

    source = String(text)
    pos = 0
    line = 1
    column = 0
    token = undefined

    const output = parseRoot(onUnsafeInteger, onNonFinite)

    token = lex()
    if (token.type !== 'eof') {
        throw invalidChar(read())
    }

    return output
}

let source
let pos
let line
let column
let token

let lexState
let buffer
let doubleQuote
let sign
let signPrefix
let c
let tokenStart
let tokenLine
let tokenColumn

function lex () {
    lexState = 'default'
    buffer = ''
    doubleQuote = false
    sign = 1
    signPrefix = ''
    tokenStart = pos
    tokenLine = line
    tokenColumn = column

    for (;;) {
        c = peek()
        const t = lexStates[lexState]()
        if (t) {
            return t
        }
    }
}

function peek () {
    if (source[pos]) {
        return String.fromCodePoint(source.codePointAt(pos))
    }
}

function read () {
    const ch = peek()

    if (ch === '\n') {
        line++
        column = 0
    } else if (ch) {
        column += ch.length
    } else {
        column++
    }

    if (ch) {
        pos += ch.length
    }

    return ch
}

const lexStates = {
    default () {
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
            return

        case '/':
            read()
            lexState = 'comment'
            return

        case undefined:
            read()
            return newToken('eof')
        }

        if (util.isSpaceSeparator(c)) {
            read()
            return
        }

        return lexStates[parseState]()
    },

    comment () {
        switch (c) {
        case '*':
            read()
            lexState = 'multiLineComment'
            return

        case '/':
            read()
            lexState = 'singleLineComment'
            return
        }

        throw invalidChar(read())
    },

    multiLineComment () {
        switch (c) {
        case '*':
            read()
            lexState = 'multiLineCommentAsterisk'
            return

        case undefined:
            throw invalidChar(read())
        }

        read()
    },

    multiLineCommentAsterisk () {
        switch (c) {
        case '*':
            read()
            return

        case '/':
            read()
            lexState = 'default'
            return

        case undefined:
            throw invalidChar(read())
        }

        read()
        lexState = 'multiLineComment'
    },

    singleLineComment () {
        switch (c) {
        case '\n':
        case '\r':
        case '\u2028':
        case '\u2029':
            read()
            lexState = 'default'
            return

        case undefined:
            read()
            return newToken('eof')
        }

        read()
    },

    value () {
        switch (c) {
        case '{':
        case '[':
            return newToken('punctuator', read())

        case 'n':
            read()
            literal('ull')
            return newToken('null', null)

        case 't':
            read()
            literal('rue')
            return newToken('boolean', true)

        case 'f':
            read()
            literal('alse')
            return newToken('boolean', false)

        case '-':
        case '+':
            signPrefix = read()
            if (signPrefix === '-') {
                sign = -1
            }

            lexState = 'sign'
            return

        case '.':
            buffer = read()
            lexState = 'decimalPointLeading'
            return

        case '0':
            buffer = read()
            lexState = 'zero'
            return

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
            buffer = read()
            lexState = 'decimalInteger'
            return

        case 'I':
            read()
            literal('nfinity')
            return newToken('number', 'Infinity')

        case 'N':
            read()
            literal('aN')
            return newToken('number', 'NaN')

        case '"':
        case "'":
            doubleQuote = (read() === '"')
            buffer = ''
            lexState = 'string'
            return
        }

        throw invalidChar(read())
    },

    identifierNameStartEscape () {
        if (c !== 'u') {
            throw invalidChar(read())
        }

        read()
        const u = unicodeEscape()
        switch (u) {
        case '$':
        case '_':
            break

        default:
            if (!util.isIdStartChar(u)) {
                throw invalidIdentifier()
            }

            break
        }

        buffer += u
        lexState = 'identifierName'
    },

    identifierName () {
        switch (c) {
        case '$':
        case '_':
        case '\u200C':
        case '\u200D':
            buffer += read()
            return

        case '\\':
            read()
            lexState = 'identifierNameEscape'
            return
        }

        if (util.isIdContinueChar(c)) {
            buffer += read()
            return
        }

        return newToken('identifier', buffer)
    },

    identifierNameEscape () {
        if (c !== 'u') {
            throw invalidChar(read())
        }

        read()
        const u = unicodeEscape()
        switch (u) {
        case '$':
        case '_':
        case '\u200C':
        case '\u200D':
            break

        default:
            if (!util.isIdContinueChar(u)) {
                throw invalidIdentifier()
            }

            break
        }

        buffer += u
        lexState = 'identifierName'
    },

    sign () {
        switch (c) {
        case '.':
            buffer = signPrefix + read()
            lexState = 'decimalPointLeading'
            return

        case '0':
            buffer = signPrefix + read()
            lexState = 'zero'
            return

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
            buffer = signPrefix + read()
            lexState = 'decimalInteger'
            return

        case 'I':
            read()
            literal('nfinity')
            return newToken('number', signPrefix + 'Infinity')

        case 'N':
            read()
            literal('aN')
            return newToken('number', 'NaN')
        }

        throw invalidChar(read())
    },

    zero () {
        switch (c) {
        case '.':
            buffer += read()
            lexState = 'decimalPoint'
            return

        case 'e':
        case 'E':
            buffer += read()
            lexState = 'decimalExponent'
            return

        case 'x':
        case 'X':
            buffer += read()
            lexState = 'hexadecimal'
            return
        }

        return newToken('number', buffer)
    },

    decimalInteger () {
        switch (c) {
        case '.':
            buffer += read()
            lexState = 'decimalPoint'
            return

        case 'e':
        case 'E':
            buffer += read()
            lexState = 'decimalExponent'
            return
        }

        if (util.isDigit(c)) {
            buffer += read()
            return
        }

        return newToken('number', buffer)
    },

    decimalPointLeading () {
        if (util.isDigit(c)) {
            buffer += read()
            lexState = 'decimalFraction'
            return
        }

        throw invalidChar(read())
    },

    decimalPoint () {
        switch (c) {
        case 'e':
        case 'E':
            buffer += read()
            lexState = 'decimalExponent'
            return
        }

        if (util.isDigit(c)) {
            buffer += read()
            lexState = 'decimalFraction'
            return
        }

        return newToken('number', buffer)
    },

    decimalFraction () {
        switch (c) {
        case 'e':
        case 'E':
            buffer += read()
            lexState = 'decimalExponent'
            return
        }

        if (util.isDigit(c)) {
            buffer += read()
            return
        }

        return newToken('number', buffer)
    },

    decimalExponent () {
        switch (c) {
        case '+':
        case '-':
            buffer += read()
            lexState = 'decimalExponentSign'
            return
        }

        if (util.isDigit(c)) {
            buffer += read()
            lexState = 'decimalExponentInteger'
            return
        }

        throw invalidChar(read())
    },

    decimalExponentSign () {
        if (util.isDigit(c)) {
            buffer += read()
            lexState = 'decimalExponentInteger'
            return
        }

        throw invalidChar(read())
    },

    decimalExponentInteger () {
        if (util.isDigit(c)) {
            buffer += read()
            return
        }

        return newToken('number', buffer)
    },

    hexadecimal () {
        if (util.isHexDigit(c)) {
            buffer += read()
            lexState = 'hexadecimalInteger'
            return
        }

        throw invalidChar(read())
    },

    hexadecimalInteger () {
        if (util.isHexDigit(c)) {
            buffer += read()
            return
        }

        return newToken('number', buffer)
    },

    string () {
        switch (c) {
        case '\\':
            read()
            buffer += escape()
            return

        case '"':
            if (doubleQuote) {
                read()
                return newToken('string', buffer)
            }

            buffer += read()
            return

        case "'":
            if (!doubleQuote) {
                read()
                return newToken('string', buffer)
            }

            buffer += read()
            return

        case '\n':
        case '\r':
            throw invalidChar(read())

        case '\u2028':
        case '\u2029':
            separatorChar(c)
            break

        case undefined:
            throw invalidChar(read())
        }

        buffer += read()
    },

    start () {
        switch (c) {
        case '{':
        case '[':
            return newToken('punctuator', read())
        }

        lexState = 'value'
    },

    beforePropertyName () {
        switch (c) {
        case '$':
        case '_':
            buffer = read()
            lexState = 'identifierName'
            return

        case '\\':
            read()
            lexState = 'identifierNameStartEscape'
            return

        case '}':
            return newToken('punctuator', read())

        case '"':
        case "'":
            doubleQuote = (read() === '"')
            lexState = 'string'
            return
        }

        if (util.isIdStartChar(c)) {
            buffer += read()
            lexState = 'identifierName'
            return
        }

        throw invalidChar(read())
    },

    afterPropertyName () {
        if (c === ':') {
            return newToken('punctuator', read())
        }

        throw invalidChar(read())
    },

    beforePropertyValue () {
        lexState = 'value'
    },

    afterPropertyValue () {
        switch (c) {
        case ',':
        case '}':
            return newToken('punctuator', read())
        }

        throw invalidChar(read())
    },

    beforeArrayValue () {
        if (c === ']') {
            return newToken('punctuator', read())
        }

        lexState = 'value'
    },

    afterArrayValue () {
        switch (c) {
        case ',':
        case ']':
            return newToken('punctuator', read())
        }

        throw invalidChar(read())
    },

    end () {
        throw invalidChar(read())
    },
}

function newToken (type, value) {
    return {
        type,
        value,
        start: tokenStart,
        end: pos,
        line: tokenLine,
        column: tokenColumn,
    }
}

function literal (s) {
    for (const ch of s) {
        const p = peek()

        if (p !== ch) {
            throw invalidChar(read())
        }

        read()
    }
}

function escape () {
    const ch = peek()
    switch (ch) {
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
        return hexEscape()

    case 'u':
        read()
        return unicodeEscape()

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

    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7':
    case '8':
    case '9':
        throw invalidChar(read())

    case undefined:
        throw invalidChar(read())
    }

    return read()
}

function hexEscape () {
    let buf = ''
    let ch = peek()

    if (!util.isHexDigit(ch)) {
        throw invalidChar(read())
    }

    buf += read()

    ch = peek()
    if (!util.isHexDigit(ch)) {
        throw invalidChar(read())
    }

    buf += read()

    return String.fromCodePoint(parseInt(buf, 16))
}

function unicodeEscape () {
    let buf = ''
    let count = 4

    while (count-- > 0) {
        const ch = peek()
        if (!util.isHexDigit(ch)) {
            throw invalidChar(read())
        }

        buf += read()
    }

    return String.fromCodePoint(parseInt(buf, 16))
}

// ---------------------------------------------------------------------------
// Parser (builds strict JSON output)
// ---------------------------------------------------------------------------

let parseState

function parseRoot (onUnsafeInteger, onNonFinite) {
    parseState = 'start'
    token = lex()

    if (token.type === 'eof') {
        throw invalidEOF()
    }

    const output = parseValue('$', onUnsafeInteger, onNonFinite)

    parseState = 'end'
    return output
}

function parseValue (path, onUnsafeInteger, onNonFinite) {
    switch (token.type) {
    case 'punctuator':
        switch (token.value) {
        case '{':
            return parseObject(path, onUnsafeInteger, onNonFinite)

        case '[':
            return parseArray(path, onUnsafeInteger, onNonFinite)
        }

        throw invalidToken()

    case 'string': {
        const value = JSON.stringify(token.value)
        token = lex()
        return value
    }

    case 'number':
        return parseNumber(path, onUnsafeInteger, onNonFinite)

    case 'null':
        token = lex()
        return 'null'

    case 'boolean': {
        const value = token.value ? 'true' : 'false'
        token = lex()
        return value
    }

    case 'identifier':
        // Identifiers are only valid as property names, not as values.
        throw invalidToken()

    default:
        throw invalidToken()
    }
}

function parseObject (path, onUnsafeInteger, onNonFinite) {
    let output = '{'
    let first = true

    parseState = 'beforePropertyName'
    token = lex()

    for (;;) {
        if (token.type === 'eof') {
            throw invalidEOF()
        }

        if (token.type === 'punctuator' && token.value === '}') {
            parseState = 'afterPropertyValue'
            token = lex()
            output += '}'
            return output
        }

        if (!first) {
            if (token.type !== 'punctuator' || token.value !== ',') {
                throw invalidToken()
            }

            parseState = 'beforePropertyName'
            token = lex()

            if (token.type === 'punctuator' && token.value === '}') {
                // Trailing comma before closing brace.
                parseState = 'afterPropertyValue'
                token = lex()
                output += '}'
                return output
            }

            output += ','
        }

        first = false

        // Parse property name.
        let key
        if (token.type === 'identifier' || token.type === 'string') {
            key = token.value
        } else {
            throw invalidToken()
        }

        parseState = 'afterPropertyName'
        token = lex()

        // Expect colon.
        if (token.type !== 'punctuator' || token.value !== ':') {
            throw invalidToken()
        }

        parseState = 'beforePropertyValue'
        token = lex()

        // Parse property value.
        const propPath = path + '.' + key
        parseState = 'afterPropertyValue'
        const value = parseValue(propPath, onUnsafeInteger, onNonFinite)
        output += JSON.stringify(key) + ':' + value

        // Next token.
        if (token.type === 'punctuator' && token.value === ',') {
            parseState = 'beforePropertyName'
            continue
        }

        if (token.type === 'punctuator' && token.value === '}') {
            parseState = 'afterPropertyValue'
            token = lex()
            output += '}'
            return output
        }

        throw invalidToken()
    }
}

function parseArray (path, onUnsafeInteger, onNonFinite) {
    let output = '['
    let index = 0

    parseState = 'beforeArrayValue'
    token = lex()

    for (;;) {
        if (token.type === 'eof') {
            throw invalidEOF()
        }

        if (token.type === 'punctuator' && token.value === ']') {
            parseState = 'afterArrayValue'
            token = lex()
            output += ']'
            return output
        }

        if (index > 0) {
            if (token.type !== 'punctuator' || token.value !== ',') {
                throw invalidToken()
            }

            parseState = 'beforeArrayValue'
            token = lex()

            if (token.type === 'punctuator' && token.value === ']') {
                // Trailing comma before closing bracket.
                parseState = 'afterArrayValue'
                token = lex()
                output += ']'
                return output
            }

            output += ','
        }

        const elemPath = path + '[' + index + ']'
        parseState = 'afterArrayValue'
        const value = parseValue(elemPath, onUnsafeInteger, onNonFinite)
        output += value
        index++

        if (token.type === 'punctuator' && token.value === ',') {
            parseState = 'beforeArrayValue'
            continue
        }

        if (token.type === 'punctuator' && token.value === ']') {
            parseState = 'afterArrayValue'
            token = lex()
            output += ']'
            return output
        }

        throw invalidToken()
    }
}

function parseNumber (path, onUnsafeInteger, onNonFinite) {
    const raw = token.value
    const start = token.start
    const end = token.end
    const line = token.line
    const column = token.column

    token = lex()

    return convertNumber(raw, path, start, end, line, column + 1, onUnsafeInteger, onNonFinite)
}

// ---------------------------------------------------------------------------
// Number conversion
// ---------------------------------------------------------------------------

function convertNumber (raw, path, start, end, line, column, onUnsafeInteger, onNonFinite) {
    // NaN
    if (raw === 'NaN') {
        return handleNonFinite(raw, path, start, end, line, column, onNonFinite)
    }

    // Infinity, -Infinity, +Infinity
    if (/^[+-]?Infinity$/.test(raw)) {
        return handleNonFinite(raw, path, start, end, line, column, onNonFinite)
    }

    // Hexadecimal integer: 0x10, -0x10, +0x10
    const hexMatch = raw.match(/^([+-]?)0x([0-9A-Fa-f]+)$/)
    if (hexMatch) {
        const sign = hexMatch[1]
        const digits = hexMatch[2]
        const decimal = BigInt('0x' + digits).toString(10)
        return checkInteger(sign + decimal, raw, path, start, end, line, column, onUnsafeInteger)
    }

    // Negative zero: -0, -0.0, -0e0, -0.0e0, etc.
    // Convention: negative zero is preserved as `-0` in the output. This is
    // valid strict JSON and preserves the original value. Note that
    // JSON.parse('-0') yields -0, but JSON.stringify(-0) yields "0" — that is
    // a JavaScript serialization quirk, not a migration issue.
    if (/^-0+(\.0*)?([eE][+-]?0+)?$/.test(raw)) {
        return '-0'
    }

    // Positive zero: 0, +0, 0.0, 0e0, etc. → "0"
    if (/^[+]?0+(\.0*)?([eE][+-]?0+)?$/.test(raw)) {
        return '0'
    }

    // Decimal integer with optional leading +: 123, -123, +123
    const intMatch = raw.match(/^([+-]?)(\d+)$/)
    if (intMatch) {
        const sign = intMatch[1]
        const digits = intMatch[2]
        const text = (sign === '-' ? '-' : '') + digits
        return checkInteger(text, raw, path, start, end, line, column, onUnsafeInteger)
    }

    // Decimal fraction or exponent — normalize to strict JSON form.
    return normalizeDecimal(raw)
}

function handleNonFinite (raw, path, start, end, line, column, onNonFinite) {
    if (onNonFinite === 'null') {
        return 'null'
    }

    throw new JSON5MigrationError(
        `JSON5 migration: ${raw} is not allowed at ${path} (${line}:${column})`,
        {path, start, end, line, column, raw, kind: 'non-finite'}
    )
}

function checkInteger (text, raw, path, start, end, line, column, onUnsafeInteger) {
    const big = BigInt(text)

    if (big >= MIN_SAFE_INTEGER && big <= MAX_SAFE_INTEGER) {
        return text
    }

    if (onUnsafeInteger === 'string') {
        // Encode as a decimal string. The string contains the exact decimal
        // value, so it can be parsed back without precision loss.
        return JSON.stringify(text)
    }

    throw new JSON5MigrationError(
        `JSON5 migration: integer ${text} is outside the safe integer range at ${path} (${line}:${column})`,
        {path, start, end, line, column, raw, kind: 'unsafe-integer'}
    )
}

/**
 * Normalize a decimal fraction or exponent number to strict JSON form.
 *
 * - Strips a leading `+` (strict JSON does not allow it).
 * - Adds a leading `0` to a leading dot (`.5` → `0.5`).
 * - Removes a trailing dot (`5.` → `5`, `5.e5` → `5e5`).
 *
 * The original lexical text is preserved otherwise — it is never converted
 * to a JavaScript Number.
 */
function normalizeDecimal (raw) {
    let s = raw

    if (s.startsWith('+')) {
        s = s.slice(1)
    }

    if (s.startsWith('.')) {
        s = '0' + s
    }

    s = s.replace(/\.([eE]|$)/, '$1')

    return s
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function invalidChar (ch) {
    if (ch === undefined) {
        return syntaxError(`JSON5: invalid end of input at ${line}:${column}`)
    }

    return syntaxError(`JSON5: invalid character '${formatChar(ch)}' at ${line}:${column}`)
}

function invalidEOF () {
    return syntaxError(`JSON5: invalid end of input at ${line}:${column}`)
}

function invalidToken () {
    if (token.type === 'eof') {
        return syntaxError(`JSON5: invalid end of input at ${line}:${column}`)
    }

    const ch = String.fromCodePoint(token.value.codePointAt(0))
    return syntaxError(`JSON5: invalid character '${formatChar(ch)}' at ${line}:${column}`)
}

function invalidIdentifier () {
    column -= 5
    return syntaxError(`JSON5: invalid identifier character at ${line}:${column}`)
}

function separatorChar (ch) {
    console.warn(`JSON5: '${formatChar(ch)}' in strings is not valid ECMAScript; consider escaping`)
}

function formatChar (ch) {
    const replacements = {
        "'": "\\'",
        '"': '\\"',
        '\\': '\\\\',
        '\b': '\b',
        '\f': '\f',
        '\n': '\n',
        '\r': '\r',
        '\t': '\t',
        '\v': '\v',
        '\0': '\0',
        '\u2028': '\u2028',
        '\u2029': '\u2029',
    }

    if (replacements[ch]) {
        return replacements[ch]
    }

    if (ch < ' ') {
        const hexString = ch.charCodeAt(0).toString(16)
        return '\\x' + ('00' + hexString).substring(hexString.length)
    }

    return ch
}

function syntaxError (message) {
    const err = new SyntaxError(message)
    err.lineNumber = line
    err.columnNumber = column
    err.start = tokenStart
    err.end = pos
    return err
}

module.exports = migrate
module.exports.migrate = migrate
module.exports.JSON5MigrationError = JSON5MigrationError
