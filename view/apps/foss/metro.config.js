const { FileStore } = require("@expo/metro/metro-cache");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

// Keep Metro on the JS workspace instead of watching the repository's Go and native trees.
config.watchFolders = [
  path.resolve(__dirname, "../../../node_modules"),
  path.resolve(__dirname, "../../packages"),
  path.resolve(__dirname, "../../../proto/ts"),
];

config.cacheStores = [
  new FileStore({ root: path.join(__dirname, "node_modules", ".cache", "metro") }),
];

config.resolver.blockList = [/node_modules[/\\]\.bin[/\\].*/];

module.exports = withNativeWind(config, { input: "./global.css" });
