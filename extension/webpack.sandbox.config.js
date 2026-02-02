const path = require("path");
const ReactRefreshWebpackPlugin = require("@pmmmwh/react-refresh-webpack-plugin");
const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
  mode: "development",
  target: "web",
  entry: "./src/taskcard-sandbox.tsx", // ⬅️ TaskCard transparency test
  output: {
    path: path.resolve(__dirname, "sandbox-dist"), // ⬅️ Avoids nuking public/
    filename: "bundle.js",
  },
  devServer: {
    static: {
      directory: path.resolve(__dirname, "sandbox-dist"),
    },
    compress: true,
    port: 3002,
    hot: true,
    open: true,
    https: false,
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
    alias: {
      'webextension-polyfill': path.resolve(__dirname, 'src/mock-browser.ts'),
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      "process.env": JSON.stringify(process.env),
    }),
    new ReactRefreshWebpackPlugin(),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "public/assets",
          to: "assets",
        },
      ],
    }),
  ],
};
