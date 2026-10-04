const parse = require('./parse')
const stringify = require('./stringify')
const migrate = require('./migrate')

const JSON5 = {
    parse,
    stringify,
    migrate,
}

module.exports = JSON5
