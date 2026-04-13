const baseConfig = require("@hydris/eslint-config");

module.exports = [
  ...baseConfig,
  {
    ignores: ["expo-env.d.ts"],
  },
];
