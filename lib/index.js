const parse = require('./parse')
const stringify = require('./stringify')
const snapshot = require('./snapshot')

const JSON5 = {
    parse,
    stringify,
    snapshot,
}

module.exports = JSON5
