'use strict'

const assert = require('assert')
const JSON5 = require('../lib')

let passed = 0
function test (name, fn) {
    fn()
    passed++
    console.log('  ok - ' + name)
}

// Allow `a`, reject `b` -> b count 0 and no output (throws).
test('allow a, reject b: b count 0 and no output', () => {
    let bCount = 0
    const obj = {
        a: 1,
        get b () {
            bCount++
            return 2
        },
    }

    assert.throws(
        () => JSON5.snapshot(obj, {paths: ['a']}),
        /not in the allowed/
    )
    assert.strictEqual(bCount, 0)
})

// All allowed -> each getter count 1.
test('all allowed: each getter count 1', () => {
    let aCount = 0
    let bCount = 0
    const obj = {
        get a () {
            aCount++
            return 1
        },
        get b () {
            bCount++
            return 2
        },
    }

    const snap = JSON5.snapshot(obj, {paths: ['a', 'b']})
    assert.strictEqual(aCount, 1)
    assert.strictEqual(bCount, 1)
    assert.strictEqual(JSON5.stringify(snap), '{a:1,b:2}')
})

// Subsequent formatting does not call getters again.
test('subsequent formatting does not re-trigger getters', () => {
    let count = 0
    const obj = {
        get a () {
            count++
            return 1
        },
    }

    const snap = JSON5.snapshot(obj, {paths: ['a']})
    assert.strictEqual(count, 1)
    JSON5.stringify(snap)
    JSON5.stringify(snap, {space: 2})
    assert.strictEqual(count, 1)
})

// Nested layers are authorized by real path.
test('nested layers authorized by real path', () => {
    let cCount = 0
    const obj = {
        nested: {
            get c () {
                cCount++
                return 3
            },
        },
    }

    // Only 'nested' is allowed, not 'nested.c'.
    assert.throws(
        () => JSON5.snapshot(obj, {paths: ['nested']}),
        /not in the allowed/
    )
    assert.strictEqual(cCount, 0)

    // 'nested.c' is allowed.
    const snap = JSON5.snapshot(obj, {paths: ['nested.c']})
    assert.strictEqual(cCount, 1)
    assert.strictEqual(JSON5.stringify(snap), '{nested:{c:3}}')
})

// Allowed getter runs at most once even if reached via multiple paths.
test('allowed getter runs at most once', () => {
    let xCount = 0
    const shared = {
        get x () {
            xCount++
            return 1
        },
    }
    const obj = {a: shared, b: shared}

    const snap = JSON5.snapshot(obj, {paths: ['a.x', 'b.x']})
    assert.strictEqual(xCount, 1)
    assert.strictEqual(JSON5.stringify(snap), '{a:{x:1},b:{x:1}}')
})

// Replacer must not re-trigger original object getters.
test('replacer does not re-trigger getters', () => {
    let count = 0
    const obj = {
        get a () {
            count++
            return 1
        },
    }

    const snap = JSON5.snapshot(obj, {paths: ['a']})
    assert.strictEqual(count, 1)

    const result = JSON5.stringify(snap, (key, value) => {
        if (key === 'a') {
            return value + 1
        }
        return value
    })
    assert.strictEqual(count, 1)
    assert.strictEqual(result, '{a:2}')
})

// Unknown object methods are not auto-executed.
test('unknown object methods are not auto-executed', () => {
    const obj = {
        a: 1,
        toJSON () {
            return {hacked: true}
        },
        toJSON5 () {
            return {hacked: true}
        },
    }

    const snap = JSON5.snapshot(obj)
    assert.strictEqual(JSON5.stringify(snap), '{a:1}')
})

// Default stringify is unchanged.
test('default stringify is unchanged', () => {
    assert.strictEqual(JSON5.stringify({a: 1}), '{a:1}')
    assert.strictEqual(JSON5.stringify([1, 2]), '[1,2]')
    assert.strictEqual(
        JSON5.stringify({a: {b: 2}}, {space: 2}),
        '{\n  a: {\n    b: 2,\n  },\n}'
    )
})

// Array index paths are authorized.
test('array index paths are authorized', () => {
    let count = 0
    const arr = [1, 2]
    Object.defineProperty(arr, '1', {
        get () {
            count++
            return 20
        },
        enumerable: true,
    })

    // '0' is allowed, '1' is not.
    assert.throws(
        () => JSON5.snapshot(arr, {paths: ['0']}),
        /not in the allowed/
    )
    assert.strictEqual(count, 0)

    const snap = JSON5.snapshot(arr, {paths: ['0', '1']})
    assert.strictEqual(count, 1)
    assert.strictEqual(JSON5.stringify(snap), '[1,20]')
})

// Paths may be arrays.
test('paths may be arrays', () => {
    let count = 0
    const obj = {
        nested: {
            get c () {
                count++
                return 3
            },
        },
    }

    const snap = JSON5.snapshot(obj, {paths: [['nested', 'c']]})
    assert.strictEqual(count, 1)
    assert.strictEqual(JSON5.stringify(snap), '{nested:{c:3}}')
})

// Snapshot of a primitive returns the primitive.
test('snapshot of primitive returns primitive', () => {
    assert.strictEqual(JSON5.snapshot(42), 42)
    assert.strictEqual(JSON5.snapshot('hello'), 'hello')
    assert.strictEqual(JSON5.snapshot(null), null)
    assert.strictEqual(JSON5.snapshot(undefined), undefined)
})

// Snapshot of an empty object/array.
test('snapshot of empty structures', () => {
    assert.strictEqual(JSON5.stringify(JSON5.snapshot({})), '{}')
    assert.strictEqual(JSON5.stringify(JSON5.snapshot([])), '[]')
})

console.log('\n' + passed + ' snapshot tests passed')
