# Snapshot serialization access contract

The default `JSON5.stringify(value[, replacer[, space]])` is **unchanged**. It
walks the live object graph, so reading an accessor property (a getter) runs
that getter, and `toJSON5`/`toJSON` methods are invoked automatically.

For code that must control exactly which getters may run (for example when
serializing untrusted or lazily-computed objects), JSON5 provides two explicit
snapshot entries:

```js
JSON5.snapshot(value, options)         // -> a pure-data snapshot
JSON5.snapshotStringify(value, options) // -> JSON5 string of that snapshot
```

- `JSON5.snapshot` builds and returns a plain-data copy of `value`.
- `JSON5.snapshotStringify` builds the snapshot first and then serializes it
  with the ordinary `JSON5.stringify`. The replacer and the stringifier only
  ever see the pure-data snapshot, never the original object.

## Syntax

```
JSON5.snapshot(value[, {allow[, replacer[, space[, quote]]]}])
JSON5.snapshotStringify(value[, {allow[, replacer[, space[, quote]]]}])
```

`replacer`, `space` and `quote` have the same meaning as in
[`JSON5.stringify`](./README.md#json5stringify) and are only used by
`snapshotStringify`.

## Declared getter paths (`allow`)

`allow` declares the real paths whose getters are permitted to execute.

- A single path is an array of keys/indices from the snapshot root.
- Pass several paths as an array of paths.
- Numeric segments name array indices. A number and its string form name the
  same real path, so `[0]` and `['0']` are equivalent.
- Only the getter at exactly the declared path is authorized. Declaring a
  parent path does **not** authorize getters nested underneath it; each nested
  getter is authorized by its own real path. For example, allowing
  `['outer']` does not allow the getter at `['outer', 'inner']`.

```js
// allow the getter $.a and the getter $.arr[0].g
JSON5.snapshotStringify(obj, {allow: ['a', ['arr', 0, 'g']]})
```

## Access rules

1. **Plain data properties** (data descriptors, not accessors) are copied and
   do not need to be declared. Reading them cannot run a getter.
2. **Getters are gated by their real path.** When the traversal reaches a
   getter whose path is not declared in `allow`, it throws
   `JSON5.SnapshotAccessError` *before* the getter is read. There is no silent
   fallback to ordinary property access and the getter is never triggered.
3. **Each allowed getter executes at most once per snapshot.** Its result is
   cached on its source object, so diamond-shaped references that reach the
   same getter reuse the one cached value.
4. **The result is a pure-data snapshot.** The snapshot contains only plain
   objects, arrays and JSON-compatible primitives; it has no accessor
   properties of its own.
5. **The replacer cannot re-trigger original getters**, because it runs against
   the snapshot, not the original object graph.
6. **Unknown object methods are never executed.** `toJSON5`, `toJSON` and any
   other methods are treated as ordinary function-valued properties; they are
   never invoked. Function-valued properties have no JSON5 form and are
   omitted in objects and serialized as `null` in arrays, matching `JSON`.
7. **Failure writes no output.** `snapshotStringify` builds the entire snapshot
   before stringifying; a rejected getter, a getter that throws, or a circular
   structure makes the call throw and no string is produced.

## Data semantics

The snapshot follows `JSON`/`JSON5` data semantics:

- Objects keep their own enumerable string-keyed properties; symbols are
  ignored.
- In objects, `undefined`, functions and symbols are omitted.
- In arrays, `undefined`, functions and symbols become `null`.
- Boxed `Number`/`String`/`Boolean` objects unbox to their primitive value.
- Circular structures throw a `TypeError` ("Converting circular structure to
  JSON5"), like the ordinary stringifier.

An inherited getter on a plain prototype is not reached by the enumeration
(enumeration only visits own properties); if an own enumerable property
resolves to an accessor, that accessor is gated as described above. An own
data property that shadows an inherited getter is read as plain data.

## Errors

`JSON5.SnapshotAccessError` has:

- `name`: `'SnapshotAccessError'`
- `message`: a human-readable description including the rejected path
- `path`: the real path (array of string keys/indices) of the rejected getter,
  relative to the snapshot root

## Local Node.js command

The deterministic, dependency-free acceptance tests run with:

```sh
node test/snapshot.js
# or
npm run test:snapshot
```

The command prints one `ok`/`not ok` line per case, a summary count, and exits
non-zero on failure. It requires only the Node.js standard library.

