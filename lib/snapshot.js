const json5Stringify = require('./stringify')

// Thrown before any getter is read when the traversal reaches an accessor
// property (getter) whose real path is not in the declared allow list.
function SnapshotAccessError (message, path) {
    this.name = 'SnapshotAccessError'
    this.message = message
    this.path = path.slice()
    if (Error.captureStackTrace) {
        Error.captureStackTrace(this, SnapshotAccessError)
    }
}

SnapshotAccessError.prototype = Object.create(Error.prototype)
SnapshotAccessError.prototype.constructor = SnapshotAccessError

// Normalizes the declared getter paths into a set of JSON-encoded string
// arrays. Each entry is one path; numbers are stringified like JSON keys
// (array indices), so [0] and ['0'] name the same real path.
function normalizeAllow (allow) {
    const result = new Set()
    if (allow == null) {
        return result
    }

    const paths = Array.isArray(allow) && Array.isArray(allow[0]) ? allow : [allow]
    for (const path of paths) {
        if (!Array.isArray(path)) {
            throw new TypeError('Each allowed getter path must be an array')
        }
        result.add(JSON.stringify(path.map(String)))
    }
    return result
}

// Produces a pure-data snapshot of value: ordinary data properties are copied,
// while accessor properties (getters) are invoked at most once, and only when
// their real path is declared in allow. toJSON/toJSON5 and other object methods
// are never invoked.
function snapshot (value, options) {
    const opts = options || {}
    const allow = normalizeAllow(opts.allow)
    // getterCache keys a getter invocation by its source object, so the same
    // getter is executed at most once even with diamond-shaped references.
    const getterCache = new Map()
    // visited marks objects currently on the traversal stack (cycles).
    const visited = new Set()
    // converted caches the finished snapshot of every object already walked.
    const converted = new Map()

    return walk(value, [])

    function walk (value, path) {
        if (value === null || typeof value !== 'object') {
            // Functions, undefined and symbols have no JSON/JSON5 form.
            return value
        }

        if (value instanceof Boolean || value instanceof Number || value instanceof String) {
            // Boxed primitives unbox to their primitive value; valueOf is a
            // fixed internal method here, not an arbitrary user method.
            return value.valueOf()
        }

        if (visited.has(value)) {
            throw new TypeError('Converting circular structure to JSON5')
        }

        if (converted.has(value)) {
            return converted.get(value)
        }

        visited.add(value)

        let result
        if (Array.isArray(value)) {
            result = walkArray(value, path)
        } else {
            result = walkObject(value, path)
        }

        visited.delete(value)
        converted.set(value, result)
        return result
    }

    function walkObject (source, path) {
        const result = {}
        for (const key of Object.keys(source)) {
            const child = readProperty(source, key, path)
            // Omit function/undefined/symbol values, like JSON does.
            if (child === undefined || typeof child === 'function' || typeof child === 'symbol') {
                continue
            }
            result[key] = walk(child, path.concat(key))
        }
        return result
    }

    function walkArray (source, path) {
        const result = []
        for (let i = 0; i < source.length; i++) {
            const key = String(i)
            const child = readProperty(source, key, path)
            if (child === undefined || typeof child === 'function' || typeof child === 'symbol') {
                result[i] = null
            } else {
                result[i] = walk(child, path.concat(key))
            }
        }
        return result
    }

    function readProperty (source, key, path) {
        const descriptor = findGetterDescriptor(source, key)
        if (descriptor === undefined) {
            // Plain data property: reading it cannot trigger a getter.
            return source[key]
        }

        const realPath = path.concat(key)
        if (!allow.has(JSON.stringify(realPath))) {
            // Reject before reading: never silently trigger the getter.
            throw new SnapshotAccessError(
                'Getter at path ' + formatPath(realPath) + ' is not in the allowed paths',
                realPath
            )
        }

        let perObject = getterCache.get(source)
        if (perObject === undefined) {
            perObject = Object.create(null)
            getterCache.set(source, perObject)
        }

        if (!Object.prototype.hasOwnProperty.call(perObject, key)) {
            perObject[key] = descriptor.get.call(source)
        }
        return perObject[key]
    }
}

// Walks the prototype chain so inherited getters are also gated; an own data
// property shadows an inherited getter and therefore reads as plain data.
function findGetterDescriptor (object, key) {
    let target = object
    while (target !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(target, key)
        if (descriptor !== undefined) {
            if (typeof descriptor.get === 'function') {
                return descriptor
            }
            return undefined
        }
        target = Object.getPrototypeOf(target)
    }
    return undefined
}

function formatPath (path) {
    return '$' + path.map(segment => /^\d+$/.test(segment) ? '[' + segment + ']' : '["' + segment + '"]').join('')
}

// Serializes value through a pure-data snapshot first, so the replacer and the
// stringifier only ever see plain data and can never trigger a getter on the
// original object graph. On any failure nothing is returned.
function stringify (value, options) {
    const opts = options || {}
    const snap = snapshot(value, opts)

    const stringifyOptions = {}
    if (opts.replacer !== undefined) {
        stringifyOptions.replacer = opts.replacer
    }
    if (opts.space !== undefined) {
        stringifyOptions.space = opts.space
    }
    if (opts.quote !== undefined) {
        stringifyOptions.quote = opts.quote
    }

    return json5Stringify(snap, stringifyOptions)
}

module.exports = {
    snapshot,
    stringify,
    SnapshotAccessError,
}
