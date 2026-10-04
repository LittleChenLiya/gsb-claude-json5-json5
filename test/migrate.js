const JSON5 = require('../lib')
const migrate = require('../lib/migrate')

const t = require('tap')

function capture (fn) {
    try {
        fn()
    } catch (err) {
        return err
    }

    return null
}

t.test('migrate(text)', t => {
    t.test('comments and trailing commas', t => {
        t.strictSame(
            migrate('// header\n{a:1, /* inline */ b:[1,2,],}'),
            '{"a":1,"b":[1,2]}',
            'removes comments and trailing commas'
        )

        t.throws(
            () => migrate('/* unterminated'),
            'unterminated comments throw'
        )
        t.end()
    })

    t.test('acceptance fixture', t => {
        const text = '{n:0x20000000000001,small:0x10,}'

        t.strictSame(
            migrate(text, {unsafeInteger: 'string'}),
            '{"n":"9007199254740993","small":16}',
            'string policy keeps the unsafe integer exact and emits safe hex as decimal'
        )

        const err = capture(() => migrate(text))
        t.ok(err, 'reject policy throws by default')
        t.equal(err.path, '$.n', 'error names the offending property path')
        t.equal(err.lexeme, '0x20000000000001', 'error carries the original lexeme')
        t.equal(err.start, 3, 'error carries the start offset')
        t.equal(err.end, 19, 'error carries the end offset')
        t.ok(err instanceof SyntaxError, 'error is a SyntaxError')
        t.ok(err instanceof migrate.MigrationError, 'error is a MigrationError')
        t.end()
    })

    t.test('hexadecimal integers are converted exactly', t => {
        t.strictSame(migrate('[0x10,0Xf,-0x1F,+0xA]'), '[16,15,-31,10]')
        t.strictSame(
            migrate('{n:0x1FFFFFFFFFFFFF}'),
            '{"n":9007199254740991}',
            'Number.MAX_SAFE_INTEGER is still emitted as a number'
        )
        t.strictSame(
            migrate('{n:0x20000000000000}', {unsafeInteger: 'string'}),
            '{"n":"9007199254740992"}',
            'Number.MAX_SAFE_INTEGER + 1 is encoded as a string'
        )
        t.strictSame(
            migrate('{n:0xFFFFFFFFFFFFFFFFFFFFFFFF}', {unsafeInteger: 'string'}),
            '{"n":"79228162514264337593543950335"}',
            'arbitrarily large hex integers convert exactly'
        )
        t.strictSame(
            migrate('{n:-0x20000000000001}', {unsafeInteger: 'string'}),
            '{"n":"-9007199254740993"}',
            'negative unsafe integers keep their sign'
        )
        t.end()
    })

    t.test('decimal numbers are rewritten lexically', t => {
        t.strictSame(migrate('[.5,5.,+.5,-.5]'), '[0.5,5,0.5,-0.5]')
        t.strictSame(migrate('[+1,-1,+0]'), '[1,-1,0]')
        t.end()
    })

    t.test('exponents', t => {
        t.strictSame(migrate('[1e2,1E+2,1e-2]'), '[1e2,1E+2,1e-2]')
        t.strictSame(migrate('[.5e2,5.e3,5.E+3]'), '[0.5e2,5e3,5E+3]')
        t.strictSame(
            JSON.parse(migrate('[1e2,.5e2,5.e3]')).join(','),
            '100,50,5000',
            'exponent output parses to the same values'
        )
        t.end()
    })

    t.test('negative zero convention', t => {
        t.strictSame(
            migrate('[-0,-0.0,-0e5,-0x0]'),
            '[-0,-0.0,-0e5,-0]',
            'negative zero keeps its minus sign in every form'
        )
        t.strictSame(migrate('[+0,0,0.0]'), '[0,0,0.0]')
        t.end()
    })

    t.test('numbers inside strings stay strings', t => {
        t.strictSame(
            migrate("{a:'0x10',b:'1e5',c:'NaN',d:'-0'}"),
            '{"a":"0x10","b":"1e5","c":"NaN","d":"-0"}',
            'string values are never reinterpreted as numbers'
        )
        t.strictSame(migrate('{"0x10":1}'), '{"0x10":1}', 'neither are keys')
        t.end()
    })

    t.test('NaN and Infinity', t => {
        t.throws(
            () => migrate('{x:NaN}'),
            /NaN is not representable in strict JSON at \$\.x/,
            'NaN is rejected by default instead of becoming null'
        )
        t.throws(() => migrate('{x:Infinity}'), /Infinity is not representable/)
        t.throws(() => migrate('{x:-Infinity}'), /Infinity is not representable/)
        t.strictSame(
            migrate('[NaN,Infinity,-Infinity]', {nonFinite: 'null'}),
            '[null,null,null]',
            'nonFinite: null maps all three to null'
        )
        const err = capture(() => migrate('[NaN]'))
        t.equal(err.path, '$[0]', 'array element paths are reported')
        t.end()
    })

    t.test('error reports include path and source range', t => {
        const text = '{a:{b:[1,{c:0x20000000000001}]}}'
        const err = capture(() => migrate(text))
        t.ok(err, 'nested unsafe integer throws')
        t.equal(err.path, '$.a.b[1].c')
        t.equal(err.lexeme, '0x20000000000001')
        t.equal(text.slice(err.start, err.end), err.lexeme,
            'start/end delimit the lexeme in the source')
        t.equal(err.line, 1)
        t.ok(err.column > 0)
        t.end()
    })

    t.test('conversion is all or nothing', t => {
        t.throws(
            () => migrate('{ok:1,bad:0x20000000000001}'),
            'no output is returned when any value fails'
        )
        t.throws(() => migrate(''), 'empty input throws')
        t.throws(() => migrate('{a:01}'), 'invalid JSON5 throws')
        t.throws(() => migrate('{a:1} extra'), 'trailing garbage throws')
        t.throws(() => migrate('[1,2'), 'unterminated input throws')
        t.end()
    })

    t.test('options validation', t => {
        t.throws(() => migrate('{}', {unsafeInteger: 'bigint'}), TypeError)
        t.throws(() => migrate('{}', {nonFinite: 'zero'}), TypeError)
        t.end()
    })

    t.test('strings and keys', t => {
        t.strictSame(migrate("{'a':1,\"b\":2,c:3}"), '{"a":1,"b":2,"c":3}')
        t.strictSame(
            migrate("{s:'\\x41\\u0042\\v\\0'}"),
            '{"s":"AB\\u000b\\u0000"}',
            'JSON5 string escapes are re-emitted as strict JSON escapes'
        )
        t.strictSame(
            migrate("{s:'line1\\\nline2'}"),
            '{"s":"line1line2"}',
            'line continuations are folded'
        )
        t.strictSame(migrate('{\\u0061:1}'), '{"a":1}', 'escaped keys')
        t.end()
    })

    t.test('space option', t => {
        t.strictSame(
            migrate('{a:1,b:[2,3]}', {space: 2}),
            '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}'
        )
        t.strictSame(migrate('{a:1}', {space: '\t'}), '{\n\t"a": 1\n}')
        t.strictSame(migrate('{a:1}', {space: 0}), '{"a":1}')
        t.end()
    })

    t.test('top-level scalars', t => {
        t.strictSame(migrate('42'), '42')
        t.strictSame(migrate('"str"'), '"str"')
        t.strictSame(migrate('true'), 'true')
        t.strictSame(migrate('null'), 'null')
        t.end()
    })

    t.test('parse and stringify are unchanged', t => {
        t.strictSame(JSON5.parse('{a:1,}'), {a: 1}, 'parse still allows JSON5')
        t.equal(
            JSON5.parse('0x20000000000001'),
            9007199254740992,
            'parse still rounds through Number (migrate is the exact one)'
        )
        t.equal(JSON5.stringify({a: 1}), '{a:1}', 'stringify is untouched')
        t.equal(JSON5.migrate, migrate, 'migrate is exposed on the JSON5 object')
        t.end()
    })

    t.end()
})
