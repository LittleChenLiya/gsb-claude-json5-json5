const assert = require('assert/strict')
const {test} = require('node:test')
const JSON5 = require('../lib')

test('parseWithTokens(text, onToken) reports tokens from the actual lexing pass', () => {
    const tokens = []
    const result = JSON5.parseWithTokens('{a:1}', token => tokens.push(token))

    assert.deepEqual(result, {a: 1}, 'returns the same result as parse')
    assert.deepEqual(result, JSON5.parse('{a:1}'))
    assert.deepEqual(tokens, [
        {type: 'punctuator', line: 1, column: 1},
        {type: 'identifier', line: 1, column: 2},
        {type: 'punctuator', line: 1, column: 3},
        {type: 'numeric', line: 1, column: 4},
        {type: 'punctuator', line: 1, column: 5},
        {type: 'eof', line: 1, column: 6},
    ])
})

test('token records are immutable and do not store the original value', () => {
    const tokens = []
    JSON5.parseWithTokens('{a:1}', token => tokens.push(token))

    for (const token of tokens) {
        assert.equal(Object.isFrozen(token), true, 'token record is frozen')
        assert.equal('value' in token, false, 'token record does not store the original value')
        assert.deepEqual(Object.keys(token).sort(), ['column', 'line', 'type'])
    }
})

test('onToken may run nested parses with independent state', () => {
    const outerTokens = []
    let innerResult
    let innerTokens
    let plainResult

    const outerResult = JSON5.parseWithTokens('{x:{y:2},z:[3]}', token => {
        outerTokens.push(token)

        if (outerTokens.length === 3) {
            // Parse another document from inside the observation callback.
            innerTokens = []
            innerResult = JSON5.parseWithTokens('[1, 2]', t => innerTokens.push(t))
            plainResult = JSON5.parse('{w:4}')
        }
    })

    assert.deepEqual(outerResult, {x: {y: 2}, z: [3]}, 'outer result is still correct')
    assert.deepEqual(innerResult, [1, 2])
    assert.deepEqual(plainResult, {w: 4})

    // Inner positions are counted from the inner text.
    assert.deepEqual(innerTokens, [
        {type: 'punctuator', line: 1, column: 1},
        {type: 'numeric', line: 1, column: 2},
        {type: 'punctuator', line: 1, column: 3},
        {type: 'numeric', line: 1, column: 5},
        {type: 'punctuator', line: 1, column: 6},
        {type: 'eof', line: 1, column: 7},
    ])

    // Outer positions are counted from the outer text and are not disturbed
    // by the nested parse.
    assert.deepEqual(outerTokens, [
        {type: 'punctuator', line: 1, column: 1},
        {type: 'identifier', line: 1, column: 2},
        {type: 'punctuator', line: 1, column: 3},
        {type: 'punctuator', line: 1, column: 4},
        {type: 'identifier', line: 1, column: 5},
        {type: 'punctuator', line: 1, column: 6},
        {type: 'numeric', line: 1, column: 7},
        {type: 'punctuator', line: 1, column: 8},
        {type: 'punctuator', line: 1, column: 9},
        {type: 'identifier', line: 1, column: 10},
        {type: 'punctuator', line: 1, column: 11},
        {type: 'punctuator', line: 1, column: 12},
        {type: 'numeric', line: 1, column: 13},
        {type: 'punctuator', line: 1, column: 14},
        {type: 'punctuator', line: 1, column: 15},
        {type: 'eof', line: 1, column: 16},
    ])
})

test('a throwing onToken callback aborts the parse without a result', () => {
    const tokens = []
    assert.throws(
        () => JSON5.parseWithTokens('{a:1,b:2}', token => {
            tokens.push(token)
            if (tokens.length === 4) {
                throw new Error('observer failure')
            }
        }),
        /^Error: observer failure$/
    )

    // The parser state is restored even when the callback throws, so later
    // parses are unaffected.
    assert.deepEqual(JSON5.parse('{q:9}'), {q: 9})
})

test('positions account for CRLF line endings', () => {
    const tokens = []
    const result = JSON5.parseWithTokens('{\r\na:1}', token => tokens.push(token))

    assert.deepEqual(result, {a: 1})
    assert.deepEqual(tokens, [
        {type: 'punctuator', line: 1, column: 1},
        {type: 'identifier', line: 2, column: 1},
        {type: 'punctuator', line: 2, column: 2},
        {type: 'numeric', line: 2, column: 3},
        {type: 'punctuator', line: 2, column: 4},
        {type: 'eof', line: 2, column: 5},
    ])
})

test('error positions stay compatible with parse, including across CRLF', () => {
    const source = '{a:\r\n!}'

    let parseError
    try {
        JSON5.parse(source)
    } catch (err) {
        parseError = err
    }

    let tokensError
    try {
        JSON5.parseWithTokens(source, () => {})
    } catch (err) {
        tokensError = err
    }

    assert.ok(parseError instanceof SyntaxError)
    assert.ok(tokensError instanceof SyntaxError)
    assert.equal(tokensError.message, parseError.message)
    assert.equal(tokensError.message, "JSON5: invalid character '!' at 2:1")
    assert.equal(tokensError.lineNumber, 2)
    assert.equal(tokensError.columnNumber, 1)
})

test('default parse results and error positions are unchanged', () => {
    assert.deepEqual(JSON5.parse('{a:1,b:[2,3],c:"x"}'), {a: 1, b: [2, 3], c: 'x'})
    assert.deepEqual(JSON5.parse('[1,2,]', (k, v) => v), [1, 2])

    assert.throws(() => JSON5.parse('{a:'), /^SyntaxError: JSON5: invalid end of input at 1:4$/)
    assert.throws(() => JSON5.parse('{a:1,} x'), /^SyntaxError: JSON5: invalid character 'x' at 1:8$/)
})

test('parseWithTokens requires an onToken callback function', () => {
    assert.throws(() => JSON5.parseWithTokens('{}'), /^TypeError: JSON5: parseWithTokens requires an onToken callback function$/)
    assert.throws(() => JSON5.parseWithTokens('{}', 'not a function'), /^TypeError:/)
})
