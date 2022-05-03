const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const TerserPlugin = require('terser-webpack-plugin-legacy');

const MonacoEditorSrc = path.join(__dirname, 'node_modules', 'react-monaco-editor');
const VSMonacoEditorSrc = path.join(__dirname, 'node_modules', 'monaco-editor', 'min', 'vs');

let distDir = path.resolve(__dirname, 'docs');

module.exports = {
  entry: {
    jsx: "./src/index.tsx",
    // html: './public/index.html',
    // vendor: ['react', 'react-dom']
  },
  output: {
    path: distDir,
    filename: "index.js",
    publicPath: "./",
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
    alias: { "react-monaco-editor": MonacoEditorSrc },
  },
  module: {
    rules: [
      {
        test: /webworkerscript\.js$/,
        use: { loader: "worker-loader" },
      },
      {
        test: /\.tsx?$/,
        loader: ["ts-loader"],
      },
    ],
  },
  devServer: {
    contentBase: distDir,
    publicPath: "/",
  },
  plugins: [
    // used to change hostPrefix in index.tsx to 'https://tqft.net/lean/web-editor/'
    new webpack.EnvironmentPlugin({
      COMMUNITY: false,
    }),
    new HtmlWebpackPlugin({
      template: "public/index.html",
    }),
    new CopyWebpackPlugin([
      { from: VSMonacoEditorSrc, to: "vs" },
      { from: "public/index.css", to: "index.css" },
      { from: "public/lean_logo.svg", to: "lean_logo.svg" },
      { from: "public/chesium_studio.png", to: "chesium_studio.png" },
      { from: "public/display-goal-light.svg", to: "display-goal-light.svg" },
      { from: "public/display-list-light.svg", to: "display-list-light.svg" },
      { from: "lib/lean_js_js.js", to: "lean_js_js.js" },
      { from: "lib/lean_js_wasm.js", to: "lean_js_wasm.js" },
      { from: "lib/lean_js_wasm.wasm", to: "lean_js_wasm.wasm" },
      { from: "lib/library.info.json", to: "library.info.json" },
      { from: "lib/library.olean_map.json", to: "library.olean_map.json" },
      { from: "lib/library.zip", to: "library.zip" },
    ]),
    new TerserPlugin(),
  ],
  node: {
    child_process: "empty",
    readline: "empty",
  },
  externals: {
    // react: 'require("react")',
    // 'react-dom': 'require("react-dom")',
  },
};
