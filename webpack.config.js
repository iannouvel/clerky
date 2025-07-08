const path = require('path');

module.exports = {
  mode: 'production',
  entry: './scripts/bundle-libretto.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'libretto-bundle.js',
    library: {
      name: 'LibrettoRedact',
      type: 'umd'
    },
    globalObject: 'this'
  },
  resolve: {
    fallback: {
      "fs": false,
      "path": require.resolve("path-browserify"),
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "buffer": require.resolve("buffer")
    }
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ]
  },
  optimization: {
    minimize: false // Keep readable for debugging
  }
}; 