const parse = require('./parse')
const stringify = require('./stringify')

const JSON5 = {
    parse,
    parseWithTokens: parse.parseWithTokens,
    stringify,
}

module.exports = JSON5
