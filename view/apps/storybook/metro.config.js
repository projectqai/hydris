const { FileStore } = require("@expo/metro/metro-cache");
const { withStorybook } = require("@storybook/react-native/metro/withStorybook");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

config.watchFolders = [
  path.resolve(__dirname, "../../../node_modules"),
  path.resolve(__dirname, "../../packages"),
  path.resolve(__dirname, "../../../proto/ts"),
];

config.cacheStores = [
  new FileStore({ root: path.join(__dirname, "node_modules", ".cache", "metro") }),
];

config.resolver.blockList = [/node_modules[/\\]\.bin[/\\].*/];

// Metro has no sb.mock. Keep in sync with the web sb.mock calls
const MOCK_BY_FILE = new Map(
  [
    "core/src/lib/api/world-client.ts",
    "core/src/lib/api/use-chat.ts",
    "core/src/lib/download.ts",
    "core/src/lib/location-search.ts",
    "core/src/features/sensors/use-alarm-audio.ts",
    "core/src/features/aware/components/video-stream/use-whep-connection.ts",
    "ui/src/hooks/hold-to-confirm-flag.ts",
  ].map((file) => {
    const real = path.resolve(__dirname, "../../packages", file);

    return [real, path.join(path.dirname(real), "__mocks__", path.basename(real))];
  }),
);

// keep in sync with the web Storybook's package mocks
const MOCK_BY_PACKAGE = new Map([
  ["expo-router", path.resolve(__dirname, "__mocks__/expo-router.ts")],
  ["expo-clipboard", path.resolve(__dirname, "__mocks__/expo-clipboard.js")],
]);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const packageMock = MOCK_BY_PACKAGE.get(moduleName);

  if (packageMock) return { type: "sourceFile", filePath: packageMock };

  const resolved = context.resolveRequest(context, moduleName, platform);
  const fileMock = resolved.type === "sourceFile" && MOCK_BY_FILE.get(resolved.filePath);

  return fileMock ? { type: "sourceFile", filePath: fileMock } : resolved;
};

module.exports = withNativeWind(withStorybook(config), { input: "../foss/global.css" });
