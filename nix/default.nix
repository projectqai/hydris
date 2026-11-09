# Hydris packages.
{
  pkgs,
  bun2nix,
  version,
}: let
  inherit (pkgs) lib;

  relPath = path: lib.removePrefix (toString ../. + "/") (toString path);

  # The repo minus stuff, so editing stuff doesn't rebuild everything.
  src = lib.cleanSourceWith {
    name = "hydris-source";
    src = lib.cleanSource ../.;
    filter = path: type: let
      rel = relPath path;
      base = baseNameOf path;
    in
      !(type == "directory" && builtins.elem base ["node_modules" ".direnv" ".turbo"])
      && !(builtins.elem rel ["bin" "nix" "flake.nix" "flake.lock" "view/apps/foss/build" "plugins/ros2/build"])
      && !(lib.hasPrefix "result" base);
  };

  # Just the bun workspace, so stuff changes don't rebuild the frontend.
  jsSrc = lib.cleanSourceWith {
    name = "hydris-js-source";
    inherit src;
    filter = path: type: let
      rel = relPath path;
    in
      builtins.elem rel ["package.json" "bun.lock" "view" "proto" "proto/ts"]
      || lib.hasPrefix "view/" rel
      || lib.hasPrefix "proto/ts/" rel;
  };

  callPackage = lib.callPackageWith (pkgs // scope);

  scope = {
    inherit src version bun2nix;

    hydris-frontend = callPackage ./frontend.nix {src = jsSrc;};
    hydris = callPackage ./hydris.nix {};
  };
in
  scope
