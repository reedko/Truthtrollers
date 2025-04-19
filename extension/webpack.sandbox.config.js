const path = require("path");
const ReactRefreshWebpackPlugin = require("@pmmmwh/react-refresh-webpack-plugin");
const webpack = require("webpack");

module.exports = {
  mode: "development",
  target: "web",
  entry: "./src/sandbox.tsx", // ⬅️ Your meter test entry
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
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
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
  ],
};
