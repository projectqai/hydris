const { withMainActivity, AndroidConfig } = require("@expo/config-plugins");

const IMPORTS = [
  "ai.projectq.hydris.HydrisManager",
  "expo.modules.hydrisengine.HydrisEngineModule",
];

const METHOD = `
  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    HydrisManager.onPermissionsResult(requestCode)
    HydrisEngineModule.onPermissionsResult(requestCode)
  }`;

const withHydrisEngine = (config) => {
  return withMainActivity(config, (config) => {
    let contents = config.modResults.contents;

    contents = AndroidConfig.CodeMod.addImports(contents, IMPORTS, false);

    if (!contents.includes("onRequestPermissionsResult")) {
      contents = AndroidConfig.CodeMod.appendContentsInsideDeclarationBlock(
        contents,
        "class MainActivity",
        METHOD,
      );
    }

    config.modResults.contents = contents;
    return config;
  });
};

module.exports = withHydrisEngine;
