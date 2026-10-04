# JSON5 to Strict JSON Migration

This document describes how to migrate JSON5 documents to strict JSON using
the `JSON5.migrate()` function.

## Overview

JSON5 extends JSON with several conveniences (comments, trailing commas,
hexadecimal numbers, `NaN`, `Infinity`, etc.). While `JSON5.parse()` can read
these documents, many downstream tools only accept strict JSON. The
`JSON5.migrate()` function converts a JSON5 document to strict JSON text.

The migration is **non-destructive**: `JSON5.parse()` and `JSON5.stringify()`
are unchanged. Only `JSON5.migrate()` performs the conversion.

## Key Principles

1. **Lexical number handling** — Numbers are converted based on their original
   lexical text. They are never round-tripped through a JavaScript `Number`,
   which would lose precision for integers larger than 2^53.

2. **Exact hexadecimal conversion** — Hexadecimal integers (e.g. `0x10`) are
   converted to exact decimal strings using `BigInt`.

3. **Safe-integer enforcement** — Integers outside the JavaScript safe-integer
   range (`-(2^53-1)` to `2^53-1`) are either rejected or encoded as decimal
   strings, depending on the caller's strategy.

4. **Non-finite number enforcement** — `NaN` and `Infinity` are either
   rejected or encoded as `null`, depending on the caller's strategy. The
   default is `'reject'`, so `NaN` is never silently converted to `null`.

5. **All-or-nothing output** — The strict JSON text is produced only when every
   number in the document converts successfully. If any number fails, an error
   is thrown and no partial output is returned.

## API

```js
JSON5.migrate(text, options)
```

### Parameters

- `text` — The JSON5 document to migrate (string).
- `options` — Optional migration options.
  - `onUnsafeInteger` — What to do when an integer is outside the safe-integer
    range. `'reject'` (default) throws an error; `'string'` encodes the integer
    as a decimal string.
  - `onNonFinite` — What to do when a number is `NaN` or `Infinity`.
    `'reject'` (default) throws an error; `'null'` encodes the number as
    `null`.

### Returns

The strict JSON text (string).

### Throws

`JSON5MigrationError` — If a number cannot be migrated and the corresponding
strategy is `'reject'`. The error includes:

- `path` — The path to the offending number, e.g. `$.n` or `$[0].foo`.
- `start` — The start offset of the original number text (0-based).
- `end` — The end offset of the original number text (exclusive, 0-based).
- `line` — The start line of the original number text (1-based).
- `column` — The start column of the original number text (1-based).
- `raw` — The original lexical number text.
- `kind` — The kind of failure: `'unsafe-integer'` or `'non-finite'`.

## Number Conversion Rules

| JSON5 form | Strict JSON output | Notes |
|---|---|---|
| `123` | `123` | Safe integer, preserved as-is. |
| `-123` | `-123` | Negative safe integer. |
| `+123` | `123` | Leading `+` stripped. |
| `0x10` | `16` | Hexadecimal converted to exact decimal. |
| `0x20000000000001` | (rejected) | Unsafe integer; rejected by default. |
| `0x20000000000001` | `"9007199254740993"` | Unsafe integer; encoded as string with `onUnsafeInteger: 'string'`. |
| `1.5` | `1.5` | Fraction, preserved as-is. |
| `.5` | `0.5` | Leading dot normalized. |
| `5.` | `5` | Trailing dot removed. |
| `1e5` | `1e5` | Exponent, preserved as-is. |
| `1.5e-3` | `1.5e-3` | Exponent, preserved as-is. |
| `-0` | `-0` | Negative zero, preserved as `-0`. |
| `NaN` | (rejected) | Non-finite; rejected by default. |
| `NaN` | `null` | Non-finite; encoded as `null` with `onNonFinite: 'null'`. |
| `Infinity` | (rejected) | Non-finite; rejected by default. |
| `Infinity` | `null` | Non-finite; encoded as `null` with `onNonFinite: 'null'`. |

### Negative Zero Convention

Negative zero (`-0`) is preserved as `-0` in the output. This is valid strict
JSON and preserves the original value. Note that `JSON.parse('-0')` yields
`-0`, but `JSON.stringify(-0)` yields `"0"` — that is a JavaScript
serialization quirk, not a migration issue.

## Examples

### Basic migration

```js
const JSON5 = require('json5')

const json5 = '{n:0x10,small:16,}'
const json = JSON5.migrate(json5)
// '{"n":16,"small":16}'
```

### Migrating unsafe integers as strings

```js
const JSON5 = require('json5')

const json5 = '{n:0x20000000000001,small:0x10,}'
const json = JSON5.migrate(json5, {onUnsafeInteger: 'string'})
// '{"n":"9007199254740993","small":16}'

const value = JSON.parse(json)
// value.n === "9007199254740993" (string, no precision loss)
// value.small === 16 (number)
```

### Handling NaN and Infinity

```js
const JSON5 = require('json5')

// Default: reject NaN
try {
  JSON5.migrate('{a:NaN}')
} catch (err) {
  console.log(err.path)  // '$.a'
  console.log(err.kind)  // 'non-finite'
}

// Encode as null
const json = JSON5.migrate('{a:NaN,b:Infinity}', {onNonFinite: 'null'})
// '{"a":null,"b":null}'
```

### Error reporting with path and range

```js
const JSON5 = require('json5')

try {
  JSON5.migrate('{outer:{inner:0x20000000000001}}')
} catch (err) {
  console.log(err.path)    // '$.outer.inner'
  console.log(err.raw)     // '0x20000000000001'
  console.log(err.line)    // 1
  console.log(err.column)  // 14
  console.log(err.start)   // 13 (offset)
  console.log(err.end)     // 29 (offset)
}
```

### Removing comments and trailing commas

```js
const JSON5 = require('json5')

const json5 = `
{
  // This is a comment
  a: 1,
  b: [2, 3,],  // trailing comma
}
`
const json = JSON5.migrate(json5)
// '{"a":1,"b":[2,3]}'
```

## Migration Strategy

When migrating a JSON5 codebase to strict JSON, follow these steps:

1. **Identify non-strict numbers** — Search for hexadecimal numbers, `NaN`,
   `Infinity`, and numbers that may exceed the safe-integer range.

2. **Choose a strategy** — For each category of non-strict number, decide
   whether to reject or encode:
   - Hexadecimal integers are always converted to exact decimal.
   - Unsafe integers: reject (to find all of them) or encode as strings (to
     preserve precision).
   - Non-finite numbers: reject (to find all of them) or encode as `null`.

3. **Run the migration** — Use `JSON5.migrate()` with the chosen options. The
   function returns the strict JSON text or throws an error with the path and
   range of the offending number.

4. **Validate the output** — Parse the strict JSON output with `JSON.parse()`
   to verify it is valid.

5. **Update downstream code** — If unsafe integers are encoded as strings,
   update downstream code to handle string-encoded numbers (e.g., using
   `BigInt` for arithmetic).
