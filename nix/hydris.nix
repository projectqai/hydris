# The hydris CLI/server, with the web UI embedded.
{
  buildGoModule,
  hydris-frontend,
  src,
  version,
}:
buildGoModule {
  pname = "hydris";
  inherit version src;

  # proxyVendor keeps the local `replace => ./proto/go` out of the module
  # download, so only go.sum changes require bumping this hash.
  proxyVendor = true;
  vendorHash = "sha256-eCQJ6lkeIE3KO6MMRck0QGBnSGbaTbl3aynOw9hxdBM=";

  # Same name for every package of the root module so they share one module download.
  overrideModAttrs = _: {name = "hydris-go-modules";};

  subPackages = ["."];

  env.CGO_ENABLED = "0";

  ldflags = [
    "-s"
    "-w"
    "-X github.com/projectqai/hydris/pkg/version.Version=${version}"
  ];

  postConfigure = ''
    cp -r ${hydris-frontend} view/apps/foss/build
  '';

  doCheck = false;

  meta = {
    description = "Hydris engine and CLI";
    homepage = "https://github.com/projectqai/hydris";
    mainProgram = "hydris";
  };
}
