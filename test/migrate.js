'use strict'

const assert = require('assert')
const JSON5 = require('../lib/index')

let passed = 0
let failed = 0

function test (name, fn) {
    try {
        fn()
        passed++
        console.log('  ok - ' + name)
    } catch (err) {
        failed++
        console.error('  FAIL - ' + name)
        console.error(err)
    }
}

function expectError (name, fn, check) {
    test(name, () => {
        let threw = false
        let err
        try {
            fn()
        } catch (e) {
            threw = true
            err = e
        }
        assert(threw, 'Expected migration to throw')
        if (check) {
            check(err)
        }
    })
}

console.log('migrate')

// --- Acceptance criteria ---

test('hex 0x20000000000001 in reject mode points to n', () => {
    expectError('reject unsafe hex', () => {
        JSON5.migrate('{n:0x20000000000001,small:0x10,}')
    }, (err) => {
        assert.strictEqual(err.path, '$.n')
        assert.strictEqual(err.raw, '0x20000000000001')
        assert.strictEqual(err.kind, 'unsafe-integer')
    })
})

test('hex 0x20000000000001 in string mode preserves n as string and small as number', () => {
    const out = JSON5.migrate('{n:0x20000000000001,small:0x10,}', {onUnsafeInteger: 'string'})
    assert.strictEqual(out, '{"n":"9007199254740993","small":16}')
    const parsed = JSON.parse(out)
    assert.strictEqual(parsed.n, '9007199254740993')
    assert.strictEqual(parsed.small, 16)
})

test('NaN defaults to reject', () => {
    expectError('NaN reject', () => {
        JSON5.migrate('{a:NaN}')
    }, (err) => {
        assert.strictEqual(err.path, '$.a')
        assert.strictEqual(err.raw, 'NaN')
        assert.strictEqual(err.kind, 'non-finite')
    })
})

// --- Hexadecimal conversion ---

test('hex 0x10 converts to 16', () => {
    const out = JSON5.migrate('{a:0x10}')
    assert.strictEqual(out, '{"a":16}')
})

test('hex 0xFF converts to 255', () => {
    const out = JSON5.migrate('{a:0xFF}')
    assert.strictEqual(out, '{"a":255}')
})

test('hex 0x100 converts to 256', () => {
    const out = JSON5.migrate('{a:0x100}')
    assert.strictEqual(out, '{"a":256}')
})

test('negative hex -0x10 converts to -16', () => {
    const out = JSON5.migrate('{a:-0x10}')
    assert.strictEqual(out, '{"a":-16}')
})

test('hex 0x1FFFFFFFFFFFFF (max safe) is safe', () => {
    const out = JSON5.migrate('{a:0x1FFFFFFFFFFFFF}')
    assert.strictEqual(out, '{"a":9007199254740991}')
})

test('hex 0x80000000000000 (above max safe) is rejected', () => {
    expectError('hex above max safe', () => {
        JSON5.migrate('{a:0x80000000000000}')
    }, (err) => {
        assert.strictEqual(err.kind, 'unsafe-integer')
    })
})

// --- Decimal integers ---

test('decimal integer 123 is preserved', () => {
    const out = JSON5.migrate('{a:123}')
    assert.strictEqual(out, '{"a":123}')
})

test('negative decimal integer -456 is preserved', () => {
    const out = JSON5.migrate('{a:-456}')
    assert.strictEqual(out, '{"a":-456}')
})

test('leading + is stripped from +789', () => {
    const out = JSON5.migrate('{a:+789}')
    assert.strictEqual(out, '{"a":789}')
})

test('decimal integer above safe range is rejected', () => {
    expectError('decimal above safe', () => {
        JSON5.migrate('{a:9007199254740992}')
    }, (err) => {
        assert.strictEqual(err.kind, 'unsafe-integer')
    })
})

test('decimal integer above safe range is encoded as string', () => {
    const out = JSON5.migrate('{a:9007199254740992}', {onUnsafeInteger: 'string'})
    assert.strictEqual(out, '{"a":"9007199254740992"}')
})

// --- Negative zero ---

test('negative zero -0 is preserved as -0', () => {
    const out = JSON5.migrate('-0')
    assert.strictEqual(out, '-0')
})

test('negative zero -0.0 is preserved as -0', () => {
    const out = JSON5.migrate('-0.0')
    assert.strictEqual(out, '-0')
})

test('positive zero 0 is preserved as 0', () => {
    const out = JSON5.migrate('0')
    assert.strictEqual(out, '0')
})

test('positive zero +0 is normalized to 0', () => {
    const out = JSON5.migrate('+0')
    assert.strictEqual(out, '0')
})

// --- Exponents ---

test('exponent 1e5 is preserved', () => {
    const out = JSON5.migrate('{a:1e5}')
    assert.strictEqual(out, '{"a":1e5}')
})

test('exponent 1.5e-3 is preserved', () => {
    const out = JSON5.migrate('{a:1.5e-3}')
    assert.strictEqual(out, '{"a":1.5e-3}')
})

test('exponent 1E10 is preserved', () => {
    const out = JSON5.migrate('{a:1E10}')
    assert.strictEqual(out, '{"a":1E10}')
})

test('exponent 1e+5 is preserved', () => {
    const out = JSON5.migrate('{a:1e+5}')
    assert.strictEqual(out, '{"a":1e+5}')
})

// --- Fractions ---

test('fraction 1.5 is preserved', () => {
    const out = JSON5.migrate('{a:1.5}')
    assert.strictEqual(out, '{"a":1.5}')
})

test('leading dot .5 is normalized to 0.5', () => {
    const out = JSON5.migrate('{a:.5}')
    assert.strictEqual(out, '{"a":0.5}')
})

test('trailing dot 5. is normalized to 5', () => {
    const out = JSON5.migrate('{a:5.}')
    assert.strictEqual(out, '{"a":5}')
})

test('negative fraction -1.5 is preserved', () => {
    const out = JSON5.migrate('{a:-1.5}')
    assert.strictEqual(out, '{"a":-1.5}')
})

// --- NaN and Infinity ---

test('NaN with onNonFinite null encodes as null', () => {
    const out = JSON5.migrate('{a:NaN}', {onNonFinite: 'null'})
    assert.strictEqual(out, '{"a":null}')
})

test('Infinity defaults to reject', () => {
    expectError('Infinity reject', () => {
        JSON5.migrate('{a:Infinity}')
    }, (err) => {
        assert.strictEqual(err.raw, 'Infinity')
        assert.strictEqual(err.kind, 'non-finite')
    })
})

test('Infinity with onNonFinite null encodes as null', () => {
    const out = JSON5.migrate('{a:Infinity}', {onNonFinite: 'null'})
    assert.strictEqual(out, '{"a":null}')
})

test('-Infinity with onNonFinite null encodes as null', () => {
    const out = JSON5.migrate('{a:-Infinity}', {onNonFinite: 'null'})
    assert.strictEqual(out, '{"a":null}')
})

test('+Infinity defaults to reject', () => {
    expectError('+Infinity reject', () => {
        JSON5.migrate('{a:+Infinity}')
    }, (err) => {
        assert.strictEqual(err.kind, 'non-finite')
    })
})

// --- Comments and trailing commas ---

test('single-line comments are removed', () => {
    const out = JSON5.migrate('// comment\n{a:1}')
    assert.strictEqual(out, '{"a":1}')
})

test('multi-line comments are removed', () => {
    const out = JSON5.migrate('/* block */{a:1}')
    assert.strictEqual(out, '{"a":1}')
})

test('trailing commas in objects are removed', () => {
    const out = JSON5.migrate('{a:1,b:2,}')
    assert.strictEqual(out, '{"a":1,"b":2}')
})

test('trailing commas in arrays are removed', () => {
    const out = JSON5.migrate('[1,2,3,]')
    assert.strictEqual(out, '[1,2,3]')
})

// --- Strings ---

test('single-quoted strings are converted to double-quoted', () => {
    const out = JSON5.migrate("{a:'hello'}")
    assert.strictEqual(out, '{"a":"hello"}')
})

test('strings with special characters are properly escaped', () => {
    const input = '{a:"hello\\nworld"}'
    const expected = '{"a":"hello\\nworld"}'
    const out = JSON5.migrate(input)
    assert.strictEqual(out, expected)
})

test('strings containing numbers are preserved as strings', () => {
    const out = JSON5.migrate('{a:"123",b:"0x10"}')
    assert.strictEqual(out, '{"a":"123","b":"0x10"}')
    const parsed = JSON.parse(out)
    assert.strictEqual(parsed.a, '123')
    assert.strictEqual(parsed.b, '0x10')
})

// --- Path reporting ---

test('nested object path is reported correctly', () => {
    expectError('nested path', () => {
        JSON5.migrate('{outer:{inner:0x20000000000001}}')
    }, (err) => {
        assert.strictEqual(err.path, '$.outer.inner')
    })
})

test('array index path is reported correctly', () => {
    expectError('array path', () => {
        JSON5.migrate('[1,2,0x20000000000001]')
    }, (err) => {
        assert.strictEqual(err.path, '$[2]')
    })
})

test('nested array path is reported correctly', () => {
    expectError('nested array path', () => {
        JSON5.migrate('{a:[1,{b:0x20000000000001}]}')
    }, (err) => {
        assert.strictEqual(err.path, '$.a[1].b')
    })
})

test('error includes start and end offsets', () => {
    expectError('error offsets', () => {
        JSON5.migrate('{a:0x20000000000001}')
    }, (err) => {
        assert.strictEqual(err.start, 3)
        assert.strictEqual(err.end, 19)
        assert.strictEqual(err.line, 1)
        assert.strictEqual(err.column, 4)
    })
})

// --- All-or-nothing output ---

test('no output is returned when any number fails', () => {
    let threw = false
    try {
        JSON5.migrate('{a:1,b:NaN,c:3}')
    } catch (e) {
        threw = true
    }
    assert(threw, 'Expected migration to throw')
})

// --- Complex documents ---

test('complex document with mixed types', () => {
    const input = [
        '{',
        '  // Configuration',
        '  name: "test",',
        '  version: 1,',
        '  enabled: true,',
        '  ratio: 0.5,',
        '  tags: ["a", "b",],',
        '  nested: {',
        '    value: 0x10,',
        '  },',
        '}',
    ].join('\n')
    const out = JSON5.migrate(input)
    const parsed = JSON.parse(out)
    assert.strictEqual(parsed.name, 'test')
    assert.strictEqual(parsed.version, 1)
    assert.strictEqual(parsed.enabled, true)
    assert.strictEqual(parsed.ratio, 0.5)
    assert.deepStrictEqual(parsed.tags, ['a', 'b'])
    assert.strictEqual(parsed.nested.value, 16)
})

test('empty object', () => {
    const out = JSON5.migrate('{}')
    assert.strictEqual(out, '{}')
})

test('empty array', () => {
    const out = JSON5.migrate('[]')
    assert.strictEqual(out, '[]')
})

test('root string', () => {
    const out = JSON5.migrate('"hello"')
    assert.strictEqual(out, '"hello"')
})

test('root number', () => {
    const out = JSON5.migrate('42')
    assert.strictEqual(out, '42')
})

test('root boolean true', () => {
    const out = JSON5.migrate('true')
    assert.strictEqual(out, 'true')
})

test('root boolean false', () => {
    const out = JSON5.migrate('false')
    assert.strictEqual(out, 'false')
})

test('root null', () => {
    const out = JSON5.migrate('null')
    assert.strictEqual(out, 'null')
})

// --- Options validation ---

test('default options reject unsafe integers', () => {
    expectError('default reject unsafe', () => {
        JSON5.migrate('{a:9007199254740992}')
    }, (err) => {
        assert.strictEqual(err.kind, 'unsafe-integer')
    })
})

test('default options reject non-finite numbers', () => {
    expectError('default reject non-finite', () => {
        JSON5.migrate('{a:NaN}')
    }, (err) => {
        assert.strictEqual(err.kind, 'non-finite')
    })
})

console.log('')
console.log(passed + ' passed, ' + failed + ' failed')
if (failed > 0) {
    process.exit(1)
}
