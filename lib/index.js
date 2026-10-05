const parse = require('./parse')
const stringify = require('./stringify')
const snapshot = require('./snapshot')

const JSON5 = {
    parse,
    stringify,
    snapshot: snapshot.snapshot,
    snapshotStringify: snapshot.stringify,
    SnapshotAccessError: snapshot.SnapshotAccessError,
}

module.exports = JSON5
