{
  lib,
  stdenvNoCC,
  nodejs_22,
  bun2nix,
  src,
  version,
}:
stdenvNoCC.mkDerivation {
  pname = "hydris-frontend";
  inherit version src;

  nativeBuildInputs = [bun2nix.hook nodejs_22];

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.nix;
    overrides = bun2nix.patchedDependenciesToOverrides {
      patchedDependencies =
        lib.mapAttrs (_: path: ../. + "/${path}")
        (lib.importJSON ../package.json).patchedDependencies or {};
    };
  };

  # Lifecycle scripts only matter for native (android) builds.
  dontRunLifecycleScripts = true;

  # node_modules/.bin scripts use `#!/usr/bin/env node`, which the sandbox lacks.
  postBunNodeModulesInstallPhase = ''
    patchShebangs node_modules view/*/*/node_modules proto/ts/node_modules
  '';

  env = {
    CI = "1";
    EXPO_NO_TELEMETRY = "1";
    EXPO_OFFLINE = "1";
  };

  buildPhase = ''
    runHook preBuild
    bun run build:web
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -r view/apps/foss/build $out
    runHook postInstall
  '';
}
