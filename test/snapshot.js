// Self-contained acceptance tests for the explicit snapshot serialization
// entry. Run with: node test/snapshot.js  (no external dependencies)
const assert = require('assert')
const JSON5 = require('../lib')

const tests = []
function test (name, fn) {
    tests.push([name, fn])
}

function isRejected (err, expectedPath) {
    if (!(err instanceof JSON5.SnapshotAccessError)) {
        return false
    }
    if (expectedPath !== undefined) {
        try {
            assert.deepStrictEqual(err.path, expectedPath)
        } catch (e) {
            return false
        }
    }
    return true
}

function define () {
    test('rejects a non-declared getter before reading it (b count 0, no output)', () => {
        let countA = 0
        let countB = 0
        let output
        const obj = {
            get a () { countA++; return 1 },
            get b () { countB++; return 2 },
        }

        assert.throws(() => {
            output = JSON5.snapshotStringify(obj, {allow: ['a']})
        }, err => isRejected(err, ['b']))
        assert.strictEqual(countA, 1, 'allowed getter a runs once')
        assert.strictEqual(countB, 0, 'rejected getter b never runs')
        assert.strictEqual(output, undefined, 'no output is produced on failure')
    })

    test('when all paths allowed each getter runs once', () => {
        let countA = 0
        let countB = 0
        const obj = {
            get a () { countA++; return 1 },
            get b () { countB++; return 2 },
            c: 3,
        }

        const out = JSON5.snapshotStringify(obj, {allow: [['a'], ['b']]})
        assert.strictEqual(out, '{a:1,b:2,c:3}')
        assert.strictEqual(countA, 1)
        assert.strictEqual(countB, 1)
    })

    test('after the snapshot is built, formatting again calls no getters', () => {
        let countA = 0
        let countB = 0
        const obj = {
            get a () { countA++; return 1 },
            get b () { countB++; return 2 },
        }

        const snap = JSON5.snapshot(obj, {allow: [['a'], ['b']]})
        assert.strictEqual(countA, 1)
        assert.strictEqual(countB, 1)

        // Re-format the pure-data snapshot many times: no getter may fire.
        JSON5.stringify(snap)
        JSON5.stringify(snap, null, 2)
        JSON5.stringify(snap, (key, value) => value)
        assert.deepStrictEqual(snap, {a: 1, b: 2})
        assert.strictEqual(countA, 1, 'a not re-triggered by formatting')
        assert.strictEqual(countB, 1, 'b not re-triggered by formatting')
    })

    test('numeric index path and its string form are equivalent', () => {
        let count = 0
        const arr = [{get v () { count++; return 7}}]
        const out = JSON5.snapshotStringify(arr, {allow: [[0, 'v']]})
        assert.strictEqual(out, '[{v:7}]')
        assert.strictEqual(count, 1)

        count = 0
        const arr2 = [{get v () { count++; return 7}}]
        assert.strictEqual(
            JSON5.snapshotStringify(arr2, {allow: [['0', 'v']]}),
            '[{v:7}]'
        )
        assert.strictEqual(count, 1)
    })

    test('nested getters are authorized by their real nested path', () => {
        let innerCount = 0
        const obj = {outer: {get inner () { innerCount++; return 'x'}}, plain: 9}

        // Allowing only the top level must not authorize the nested getter.
        assert.throws(() => {
            JSON5.snapshot(obj, {allow: [['outer']]})
        }, err => isRejected(err, ['outer', 'inner']))
        assert.strictEqual(innerCount, 0, 'nested getter not triggered on reject')

        // Authorizing the exact real nested path allows it.
        const snap = JSON5.snapshot(obj, {allow: [['outer', 'inner']]})
        assert.deepStrictEqual(snap, {outer: {inner: 'x'}, plain: 9})
        assert.strictEqual(innerCount, 1)
    })

    test('getter under an array index is gated by the real index path', () => {
        let count = 0
        const arr = [{get g () { count++; return 1}}, 2]
        assert.throws(() => {
            JSON5.snapshotStringify(arr, {allow: [[0, 'other']]})
        }, err => isRejected(err, ['0', 'g']))
        assert.strictEqual(count, 0)

        const out = JSON5.snapshotStringify(arr, {allow: [[0, 'g']]})
        assert.strictEqual(out, '[{g:1},2]')
        assert.strictEqual(count, 1)
    })

    test('replacer never re-triggers getters on the original object', () => {
        let count = 0
        const obj = {get a () { count++; return 1}, b: 2}
        const seen = []
        const out = JSON5.snapshotStringify(obj, {
            allow: ['a'],
            replacer (key, value) {
                seen.push(key)
                return value
            },
        })
        assert.strictEqual(out, '{a:1,b:2}')
        assert.strictEqual(count, 1)
        assert.deepStrictEqual(seen, ['', 'a', 'b'])
    })

    test('unknown object methods (toJSON/toJSON5) are never auto-executed', () => {
        let calls = 0
        const obj = {
            a: 1,
            toJSON () { calls++; return {hacked: true} },
            toJSON5 () { calls++; return {hacked5: true} },
        }
        // Functions have no JSON5 form and are omitted like JSON, but crucially
        // they are never invoked, so the real data property a survives intact.
        const out = JSON5.snapshotStringify(obj, {allow: []})
        assert.strictEqual(out, '{a:1}')
        assert.strictEqual(calls, 0)

        // A getter that happens to return a method still needs authorization:
        // reading it is gated exactly like any other getter.
        let getterCalls = 0
        const obj2 = {
            a: 1,
            get lazyMethod () { getterCalls++; return () => ({x: 1}) },
        }
        assert.throws(() => {
            JSON5.snapshotStringify(obj2, {allow: []})
        }, err => isRejected(err, ['lazyMethod']))
        assert.strictEqual(getterCalls, 0)
    })

    test('plain data properties do not need authorization and are copied', () => {
        const obj = {a: 1, nested: {b: [2, 3]}, s: 'x', n: null}
        assert.deepStrictEqual(JSON5.snapshot(obj, {allow: []}), obj)
    })

    test('every getter runs at most once across diamond-shaped references', () => {
        let count = 0
        const shared = {get g () { count++; return 5}}
        const root = {x: shared, y: shared}
        const snap = JSON5.snapshot(root, {allow: [['x', 'g'], ['y', 'g']]})
        assert.deepStrictEqual(snap, {x: {g: 5}, y: {g: 5}})
        assert.strictEqual(count, 1, 'shared getter executes only once')
    })

    test('own getters are gated; an own data property shadows an inherited getter', () => {
        let count = 0
        const withGetter = {own: 1, get gated () { count++; return 'p'}}
        assert.throws(() => {
            JSON5.snapshot(withGetter, {allow: []})
        }, err => isRejected(err, ['gated']))
        assert.strictEqual(count, 0)

        const proto = {get inherited () { count++; return 'p'}}
        const shadowed = Object.create(proto)
        // An own data property shadows the inherited getter; plain assignment
        // to a setter-less inherited getter is silently ignored, so define it.
        Object.defineProperty(shadowed, 'inherited', {value: 'd', enumerable: true})
        assert.deepStrictEqual(JSON5.snapshot(shadowed, {allow: []}), {inherited: 'd'})
        assert.strictEqual(count, 0)
    })

    test('snapshot has no accessor properties of its own', () => {
        const snap = JSON5.snapshot({get a () { return 1 }}, {allow: ['a']})
        const descriptor = Object.getOwnPropertyDescriptor(snap, 'a')
        assert.ok('value' in descriptor)
        assert.strictEqual(descriptor.get, undefined)
    })

    test('default JSON5.stringify behavior is unchanged', () => {
        const obj = {get a () { return 1 }}
        assert.strictEqual(JSON5.stringify(obj), '{a:1}')
        assert.strictEqual(JSON5.stringify({b: 2}, null, 2), '{\n  b: 2,\n}')
    })

    test('functions and symbols are omitted in objects and nulled in arrays', () => {
        const snap = JSON5.snapshot({a: 1, f () {}, b: [0, undefined, 2]}, {allow: []})
        assert.deepStrictEqual(snap, {a: 1, b: [0, null, 2]})
    })

    test('cycles are rejected like plain JSON5.stringify', () => {
        const a = {}
        a.self = a
        assert.throws(() => JSON5.snapshot(a, {allow: []}), TypeError)
    })
}

define()

let failures = 0
for (const [name, fn] of tests) {
    try {
        fn()
        console.log('ok - ' + name)
    } catch (err) {
        failures++
        console.log('not ok - ' + name)
        const stack = err && err.stack ? String(err.stack) : String(err)
        console.log('  ' + stack.split('\n').join('\n  '))
    }
}

console.log('\n' + (tests.length - failures) + '/' + tests.length + ' passed')
process.exit(failures === 0 ? 0 : 1)
