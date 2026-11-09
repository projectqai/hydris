const { globalIgnores } = require("eslint/config");
const baseConfig = require("@hydris/eslint-config");

module.exports = [
  ...baseConfig,
  globalIgnores([".rnstorybook/storybook.requires.ts", "storybook-static/"], "Generated files"),
  { rules: { "no-restricted-imports": "off" } },
];
