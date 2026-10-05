'use strict'

/**
 * Create an explicit, plain-data snapshot of `value`.
 *
 * Only getters whose path is declared in `options.paths` are executed.
 * All other getters are rejected (a TypeError is thrown) before they are
 * read. Allowed getters run at most once. The returned value is a pure
 * data structure (plain objects, arrays, and primitives) with no active
 * getters, so it can be safely passed to `JSON5.stringify` without
 * triggering the original object's getters again.
 *
 * No object methods (including `toJSON`/`toJSON5`) are invoked.
 *
 * @param {*} value The value to snapshot.
 * @param {Object} [options]
 * @param {Array<string|Array>} [options.paths] The paths whose getters are
 *   allowed to execute. Paths may be strings (`'a.b[0]'`) or arrays
 *   (`['a', 'b', 0]`).
 * @returns {*} A plain-data snapshot of `value`.
 */
function snapshot (value, options) {
    const paths = (options && options.paths) || []
    const allowed = new Set()
    for (const path of paths) {
        allowed.add(JSON.stringify(parsePath(path)))
    }

    // Cache of already-executed getters, keyed by (holder, key), so each
    // getter runs at most once even if reached through multiple paths.
    const cache = new Map()
    const stack = []

    return walk(value, [])

    /**
     * Read a property of `holder` at `key`, executing the getter only when
     * its path is allowed. Throws before reading if the getter is not
     * allowed.
     */
    function readProperty (holder, key, keyPath) {
        const desc = getAccessorDescriptor(holder, key)
        if (desc && desc.get) {
            const canonical = JSON.stringify(keyPath)
            if (!allowed.has(canonical)) {
                throw new TypeError(
                    'Getter at path "' + formatPath(keyPath) +
                    '" is not in the allowed list'
                )
            }

            let holderCache = cache.get(holder)
            if (!holderCache) {
                holderCache = new Map()
                cache.set(holder, holderCache)
            }
            if (holderCache.has(key)) {
                return holderCache.get(key)
            }

            const result = desc.get.call(holder)
            holderCache.set(key, result)
            return result
        }

        return holder[key]
    }

    /**
     * Recursively walk `value`, replacing getters with their allowed
     * values and producing a plain-data structure.
     */
    function walk (value, keyPath) {
        if (value === null) {
            return null
        }

        // Functions are not data. Omit them so the snapshot stays pure data
        // and no method (including toJSON/toJSON5) is ever invoked.
        if (typeof value === 'function') {
            return undefined
        }

        if (typeof value !== 'object') {
            return value
        }

        if (stack.indexOf(value) >= 0) {
            throw new TypeError('Converting circular structure to JSON5')
        }

        stack.push(value)

        let result
        if (Array.isArray(value)) {
            result = []
            for (let i = 0; i < value.length; i++) {
                const childPath = keyPath.concat(i)
                result[i] = walk(readProperty(value, i, childPath), childPath)
            }
        } else {
            result = {}
            for (const key of Object.keys(value)) {
                const childPath = keyPath.concat(normalizeKey(key))
                result[key] = walk(readProperty(value, key, childPath), childPath)
            }
        }

        stack.pop()
        return result
    }
}

/**
 * Return the first property descriptor for `key` found in the prototype
 * chain of `holder`. This detects inherited accessor properties so they
 * can be authorized before being read.
 */
function getAccessorDescriptor (holder, key) {
    let obj = holder
    while (obj != null) {
        const desc = Object.getOwnPropertyDescriptor(obj, key)
        if (desc) {
            return desc
        }
        obj = Object.getPrototypeOf(obj)
    }
    return undefined
}

/**
 * Normalize a key so that numeric strings and numbers compare equal.
 */
function normalizeKey (key) {
    if (typeof key === 'string' && /^\d+$/.test(key)) {
        return Number(key)
    }
    return key
}

/**
 * Parse a path string or array into an array of keys.
 *
 * Examples:
 *   'a.b.c'      -> ['a', 'b', 'c']
 *   'a[0]'       -> ['a', 0]
 *   "a['b.c']"   -> ['a', 'b.c']
 *   ['a', 'b']   -> ['a', 'b']
 */
function parsePath (path) {
    if (Array.isArray(path)) {
        return path.map(normalizeKey)
    }
    if (typeof path !== 'string') {
        throw new TypeError('Path must be a string or an array')
    }

    const keys = []
    let i = 0
    while (i < path.length) {
        if (path[i] === '.') {
            i++
            continue
        }

        if (path[i] === '[') {
            const close = path.indexOf(']', i)
            if (close < 0) {
                throw new TypeError('Invalid path: ' + path)
            }

            let inner = path.slice(i + 1, close)
            if (inner.length >= 2 &&
                ((inner[0] === '"' && inner[inner.length - 1] === '"') ||
                 (inner[0] === "'" && inner[inner.length - 1] === "'"))) {
                inner = inner.slice(1, -1)
            } else if (/^\d+$/.test(inner)) {
                inner = Number(inner)
            }

            keys.push(normalizeKey(inner))
            i = close + 1
        } else {
            let j = i
            while (j < path.length && path[j] !== '.' && path[j] !== '[') {
                j++
            }
            keys.push(normalizeKey(path.slice(i, j)))
            i = j
        }
    }

    return keys
}

/**
 * Format a key path as a human-readable string.
 */
function formatPath (keyPath) {
    if (keyPath.length === 0) {
        return '$'
    }

    let result = ''
    for (const key of keyPath) {
        if (typeof key === 'number') {
            result += '[' + key + ']'
        } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
            result += (result ? '.' : '') + key
        } else {
            result += '[' + JSON.stringify(key) + ']'
        }
    }
    return result
}

module.exports = snapshot
