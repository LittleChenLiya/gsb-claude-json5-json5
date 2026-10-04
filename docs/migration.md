# Migrating JSON5 to strict JSON

`JSON5.migrate(text, options)` converts a JSON5 document into **strict JSON**
text: comments and trailing commas are dropped, single-quoted strings and
unquoted keys are re-emitted as JSON strings, and JSON5-only number forms
(hexadecimal integers, leading `+`, leading/trailing decimal points,
`Infinity`, `NaN`) are rewritten to representable JSON.

`parse` and `stringify` are not affected by this feature.

```js
const JSON5 = require('json5')

JSON5.migrate('{n:0x20000000000001,small:0x10,}', {unsafeInteger: 'string'})
// => '{"n":"9007199254740993","small":16}'
```

## Lexical number handling

Numbers are converted **from their original source tokens**. They are never
round-tripped through a JavaScript `Number`, so no precision is lost
silently:

- Hexadecimal integers are converted to decimal with exact arbitrary
  precision string arithmetic (`0x10` → `16`).
- Decimal literals are normalized textually: a leading `+` is dropped, a
  missing integer part is filled with `0` (`.5` → `0.5`), and a trailing
  decimal point is dropped (`5.` → `5`). Digits and exponents are otherwise
  preserved as written (`1e-2` stays `1e-2`).

### Integers beyond `Number.MAX_SAFE_INTEGER`

An integer whose magnitude exceeds `Number.MAX_SAFE_INTEGER`
(9007199254740991) cannot be represented exactly as a JSON number consumed
by a JavaScript `Number`. The caller chooses the policy with
`options.unsafeInteger`:

- `'reject'` (default): throw a `MigrationError`.
- `'string'`: emit the exact decimal value as a JSON **string**
  (`0x20000000000001` → `"9007199254740993"`).

### `NaN` and `Infinity`

Strict JSON cannot represent these. The caller chooses the policy with
`options.nonFinite`:

- `'reject'` (default): throw a `MigrationError`. NaN is **never** silently
  converted to `null`.
- `'null'`: emit `null`.

### Negative zero convention

**Negative zero is preserved.** Any JSON5 literal that denotes negative zero
keeps its minus sign in the output and never collapses to `0`:

| Input   | Output  |
| ------- | ------- |
| `-0`    | `-0`    |
| `-0.0`  | `-0.0`  |
| `-0e5`  | `-0e5`  |
| `-0x0`  | `-0`    |
| `+0`    | `0`     |

This differs from `JSON.stringify(-0)`, which produces `"0"`. Parsers that
follow ECMA-404/ECMAScript semantics (`JSON.parse('-0')`) read the output
back as negative zero.

## Error reporting

Migration is **all or nothing**: the output string is only returned when the
entire document converts cleanly. On failure a `MigrationError` (a subclass
of `SyntaxError`, exposed as `JSON5.migrate.MigrationError`) is thrown with
structured details:

- `path`: path of the offending value, e.g. `$.a.b[1].c`
- `lexeme`: the original source text of the number
- `start` / `end`: character offsets of the lexeme in the source
- `line` / `column`: 1-based position of the lexeme

```js
try {
    JSON5.migrate('{a:{b:[1,{c:0x20000000000001}]}}')
} catch (err) {
    err.path    // '$.a.b[1].c'
    err.lexeme  // '0x20000000000001'
    err.start   // 12
    err.end     // 28
    err.message // 'JSON5 migration: integer 0x20000000000001 exceeds
                //  Number.MAX_SAFE_INTEGER at $.a.b[1].c ...'
}
```

Malformed JSON5 input throws a `SyntaxError` with line/column information,
matching the behavior of `JSON5.parse`.

## Options summary

| Option          | Values                | Default    |
| --------------- | --------------------- | ---------- |
| `unsafeInteger` | `'reject'`, `'string'`| `'reject'` |
| `nonFinite`     | `'reject'`, `'null'`  | `'reject'` |
| `space`         | number or string      | (compact)  |

`space` behaves like the `JSON.stringify` parameter of the same name and
pretty-prints the output.

## Short examples

```js
// Comments and trailing commas are dropped.
JSON5.migrate('// conf\n{a:1, b:[1,2,],}')
// => '{"a":1,"b":[1,2]}'

// Numbers in strings are strings, not numbers — they are left alone.
JSON5.migrate("{port:'0x1F90', hex:0x1F90}")
// => '{"port":"0x1F90","hex":8080}'

// Exponents and fractional forms are normalized textually.
JSON5.migrate('[.5, 5., 1e-2, +2]')
// => '[0.5,5,1e-2,2]'

// NaN is rejected by default; opt in to null explicitly.
JSON5.migrate('[NaN, Infinity]', {nonFinite: 'null'})
// => '[null,null]'
```

