var path = require('path')

module.exports = {
    entry: path.join(__dirname, '/index.js'),
    externals: {
      'bsv': 'bsv'
    },
    output: {
        library: 'bsvup',
        path: path.join(__dirname, '/'),
        filename: 'bsvup.min.js'
    }
  }
  