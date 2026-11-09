{
  description = "Hydris development environment";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";

    bun2nix = {
      url = "github:nix-community/bun2nix/2.1.2";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    bun2nix,
    ...
  }: let
    inherit (nixpkgs) lib;

    systems = ["x86_64-linux" "aarch64-linux" "aarch64-darwin"];
    forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

    version = self.shortRev or self.dirtyShortRev or "dev";

    hydrisFor = pkgs:
      import ./nix {
        inherit pkgs version;
        bun2nix = bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
      };
  in {
    packages = forAllSystems (pkgs: let
      h = hydrisFor pkgs;
    in {
      default = h.hydris;
      inherit (h) hydris hydris-frontend;
    });

    apps = forAllSystems (pkgs:
      lib.mapAttrs (_: drv: {
        type = "app";
        program = lib.getExe drv;
        meta.description = drv.meta.description;
      }) (lib.removeAttrs self.packages.${pkgs.stdenv.hostPlatform.system} ["hydris-frontend"]));

    overlays.default = final: _prev: lib.removeAttrs (hydrisFor final) ["src" "version" "bun2nix"];

    checks = forAllSystems (pkgs: self.packages.${pkgs.stdenv.hostPlatform.system});

    devShells = forAllSystems (pkgs: let
      h = hydrisFor pkgs;

      goTools = with pkgs; [go gopls gotools go-tools golangci-lint govulncheck delve];

      protoTools = with pkgs; [buf protobuf protoc-gen-go protoc-gen-go-grpc protoc-gen-connect-go];

      frontendTools = with pkgs; [bun nodejs_22 bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default];

      pythonTools = with pkgs; [python3 poetry];

      packagingTools = with pkgs; [zip unzip binutils gcc jq];

      editorTools = with pkgs; [nixd alejandra taplo dprint];
    in {
      default = pkgs.mkShell {
        packages = goTools ++ protoTools ++ frontendTools ++ pythonTools ++ packagingTools ++ editorTools ++ [h.hydris];

        # Use Go toolchain from Nix
        GOTOOLCHAIN = "local";
      };
    });

    formatter = forAllSystems (pkgs: pkgs.alejandra);
  };
}
