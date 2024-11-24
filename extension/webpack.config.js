const path = require("path");
const ReactRefreshWebpackPlugin = require("@pmmmwh/react-refresh-webpack-plugin");
const Dotenv = require("dotenv-webpack");
const { BundleAnalyzerPlugin } = require("webpack-bundle-analyzer");

module.exports = {
  target: "web",
  entry: {
    content: "./src/content.js", // Content script
    popup: "./src/components/Popup.tsx", // React Popup component
    background: "./src/background.js",
  },
  output: {
    path: path.resolve(__dirname, "public"),
    filename: "[name].js", // Will output `content.js` and `popup.js`
  },
  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx"],
  },
  plugins: [
    new ReactRefreshWebpackPlugin(), // Add React Fast Refresh Plugin
    /* new webpack.DefinePlugin({
      "process.env.REACT_APP_OPENAI_API_KEY": JSON.stringify(
        process.env.REACT_APP_OPENAI_API_KEY
      ),
    }), */
    new Dotenv({
      path: path.resolve(__dirname, "../backend/.env"), // Path to your .env file
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
              plugins: [
                "react-refresh/babel", // Add React Refresh babel plugin
              ],
            },
          },
          {
            loader: "image-webpack-loader",
            options: {
              query: {
                mozjpeg: {
                  progressive: true,
                },
                gifsicle: {
                  interlaced: true,
                },
                optipng: {
                  optimizationLevel: 7,
                },
              },
            },
          },
        ],
      },
    ],
  },
};
