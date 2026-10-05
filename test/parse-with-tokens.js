const assert = require('assert')
const JSON5 = require('../lib')

const t = require('tap')

t.test('parseWithTokens(text, onToken)', t => {
    t.test('reports token categories and positions', t => {
        const tokens = []
        JSON5.parseWithTokens('{a:1}', token => tokens.push(token))

        assert.deepStrictEqual(
            tokens.map(token => [token.type, token.line, token.column]),
            [
                ['punctuator', 1, 1],
                ['identifier', 1, 2],
                ['punctuator', 1, 3],
                ['numeric', 1, 4],
                ['punctuator', 1, 5],
                ['eof', 1, 6],
            ]
        )

        t.end()
    })

    t.test('reports immutable tokens without original values', t => {
        const tokens = []
        JSON5.parseWithTokens('{a:1}', token => tokens.push(token))

        for (const token of tokens) {
            assert.deepStrictEqual(Object.keys(token), ['type', 'line', 'column'])
            assert.strictEqual(token.value, undefined)
            assert.strictEqual(Object.isFrozen(token), true)
        }

        t.end()
    })

    t.test('reports all token categories', t => {
        const tokens = []
        JSON5.parseWithTokens('{a:1, b:true, c:null, d:"s", e:[2]}', token => tokens.push(token))

        const types = tokens.map(token => token.type)
        assert.ok(types.includes('punctuator'))
        assert.ok(types.includes('identifier'))
        assert.ok(types.includes('numeric'))
        assert.ok(types.includes('boolean'))
        assert.ok(types.includes('null'))
        assert.ok(types.includes('string'))
        assert.ok(types.includes('eof'))

        t.end()
    })

    t.test('callback can call ordinary parse in a nested session', t => {
        const outerTokens = []
        let innerResult
        let outerResult

        outerResult = JSON5.parseWithTokens('{a:1,b:2}', token => {
            outerTokens.push([token.type, token.line, token.column])
            if (token.type === 'identifier' && token.column === 2) {
                innerResult = JSON5.parse('[10,20]')
            }
        })

        assert.deepStrictEqual(innerResult, [10, 20])
        assert.deepStrictEqual(outerResult, {a: 1, b: 2})

        // Outer positions continue relative to the outer text.
        assert.deepStrictEqual(
            outerTokens.map(token => token.join(':')),
            [
                'punctuator:1:1',
                'identifier:1:2',
                'punctuator:1:3',
                'numeric:1:4',
                'punctuator:1:5',
                'identifier:1:6',
                'punctuator:1:7',
                'numeric:1:8',
                'punctuator:1:9',
                'eof:1:10',
            ]
        )

        t.end()
    })

    t.test('nested parseWithTokens sessions keep independent positions', t => {
        const outerTokens = []
        const innerTokens = []

        JSON5.parseWithTokens('{a:1,b:2}', token => {
            outerTokens.push([token.type, token.line, token.column])
            if (token.type === 'identifier' && token.column === 2) {
                JSON5.parseWithTokens('[10,20]', inner => {
                    innerTokens.push([inner.type, inner.line, inner.column])
                })
            }
        })

        // Inner positions start from the inner text.
        assert.deepStrictEqual(
            innerTokens.map(token => token.join(':')),
            [
                'punctuator:1:1',
                'numeric:1:3',
                'punctuator:1:4',
                'numeric:1:6',
                'punctuator:1:7',
                'eof:1:8',
            ]
        )

        // Outer positions continue relative to the outer text.
        assert.deepStrictEqual(
            outerTokens.map(token => token.join(':')),
            [
                'punctuator:1:1',
                'identifier:1:2',
                'punctuator:1:3',
                'numeric:1:4',
                'punctuator:1:5',
                'identifier:1:6',
                'punctuator:1:7',
                'numeric:1:8',
                'punctuator:1:9',
                'eof:1:10',
            ]
        )

        t.end()
    })

    t.test('callback failure terminates parsing and delivers no result', t => {
        const tokens = []
        const boom = new Error('boom')

        assert.throws(() => {
            JSON5.parseWithTokens('{a:1,b:2}', token => {
                tokens.push(token)
                if (token.type === 'numeric' && token.column === 4) {
                    throw boom
                }
            })
        }, /boom/)

        // Tokens produced before the failure were already delivered.
        assert.deepStrictEqual(
            tokens.map(token => [token.type, token.line, token.column]),
            [
                ['punctuator', 1, 1],
                ['identifier', 1, 2],
                ['punctuator', 1, 3],
                ['numeric', 1, 4],
            ]
        )

        // No state corruption: ordinary parse still works afterwards.
        assert.deepStrictEqual(JSON5.parse('{a:1}'), {a: 1})
        assert.deepStrictEqual(JSON5.parse('[1,2]'), [1, 2])

        t.end()
    })

    t.test('tokens stream from the actual lexical process before an error', t => {
        const tokens = []

        assert.throws(() => {
            JSON5.parseWithTokens('{a:1, b:}', token => tokens.push(token))
        }, /invalid character/)

        // All tokens lexed before the error were reported in order.
        assert.deepStrictEqual(
            tokens.map(token => [token.type, token.line, token.column]),
            [
                ['punctuator', 1, 1],
                ['identifier', 1, 2],
                ['punctuator', 1, 3],
                ['numeric', 1, 4],
                ['punctuator', 1, 5],
                ['identifier', 1, 7],
                ['punctuator', 1, 8],
            ]
        )

        t.end()
    })

    t.test('positions are correct with CRLF line endings', t => {
        const tokens = []
        JSON5.parseWithTokens('{a:1\r\n,b:2}', token => tokens.push(token))

        assert.deepStrictEqual(
            tokens.map(token => [token.type, token.line, token.column]),
            [
                ['punctuator', 1, 1],
                ['identifier', 1, 2],
                ['punctuator', 1, 3],
                ['numeric', 1, 4],
                ['punctuator', 2, 1],
                ['identifier', 2, 2],
                ['punctuator', 2, 3],
                ['numeric', 2, 4],
                ['punctuator', 2, 5],
                ['eof', 2, 6],
            ]
        )

        t.end()
    })

    t.test('positions are correct with CRLF inside a line comment', t => {
        const tokens = []
        JSON5.parseWithTokens('{//c\r\n}', token => tokens.push(token))

        assert.deepStrictEqual(
            tokens.map(token => [token.type, token.line, token.column]),
            [
                ['punctuator', 1, 1],
                ['punctuator', 2, 1],
                ['eof', 2, 2],
            ]
        )

        t.end()
    })

    t.end()
})
