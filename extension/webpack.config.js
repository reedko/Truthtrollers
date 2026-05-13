const path = require("path");
const fs = require("fs");
const ReactRefreshWebpackPlugin = require("@pmmmwh/react-refresh-webpack-plugin");
const webpack = require("webpack");
const Dotenv = require("dotenv-webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const { BundleAnalyzerPlugin } = require("webpack-bundle-analyzer");

// Ensure public/ folder is clean before each build
const publicPath = path.resolve(__dirname, "public");
if (fs.existsSync(publicPath)) {
  fs.rmSync(publicPath, { recursive: true, force: true });
}

module.exports = {
  target: "web",
  entry: {
    content: "./src/content.js", // Content script
    popup: "./src/components/Popup.tsx", // React Popup component
    background: "./src/background.js",
    viewer: "./src/viewer.js",
  },
  output: {
    path: publicPath,
    filename: "[name].js", // Will output content.js and popup.js
  },
  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx"],
  },
  plugins: [
    new ReactRefreshWebpackPlugin(), // Add React Fast Refresh Plugin
    new Dotenv({
      path: path.resolve(__dirname, "../backend/.env"), // ✅ Load shared .env file
      systemvars: true, // ✅ Also load system env variables
    }),
    new webpack.DefinePlugin({
      "process.env": JSON.stringify(process.env), // ✅ Inject env variables
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: "src/manifest.json", to: "manifest.json" }, // Copy manifest.json
        { from: "src/assets", to: "assets" }, // Copy all assets
        { from: "src/viewer.html", to: "viewer.html" },
        { from: "src/viewer.js", to: "viewer.js" },
      ],
    }),
  ],
  devServer: {
    hot: true, // Enable hot module replacement
    open: true, // Open the browser on server start
  },
  mode: "development",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"], // Ensure CSS is bundled
      },
      {
        test: /\.(jpe?g|png|gif|svg)$/i,
        use: [
          {
            loader: "babel-loader",
            options: {
              query: {
                name: "assets/[name].[ext]",
              },
              presets: ["@babel/preset-env", "@babel/preset-react"],
              plugins: ["react-refresh/babel"], // Add React Refresh babel plugin
            },
          },
          {
            loader: "image-webpack-loader",
            options: {
              query: {
                mozjpeg: { progressive: true },
                gifsicle: { interlaced: true },
                optipng: { optimizationLevel: 7 },
              },
            },
          },
        ],
      },
    ],
  },
};
