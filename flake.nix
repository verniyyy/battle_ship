{
  description = "battle_ship development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        # Docker itself (daemon + compose plugin) comes from the host system.
        # wrangler comes from nixpkgs because the npm build's workerd binary
        # does not run on NixOS; Node.js runs it and the Vercel CLI (via npx).
        # cwebp (libwebp) makes the portraits' small copies (go run ./cmd/portraits thumbs).
        # Playwright's browsers come from nixpkgs too (the downloaded ones do
        # not run on NixOS); frontend/package.json pins @playwright/test to
        # the same version as playwright-driver.
        default = pkgs.mkShell {
          packages = [
            pkgs.just
            pkgs.bun
            pkgs.nodejs_22
            pkgs.wrangler
            pkgs.libwebp
          ];
          PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
        };
      });
    };
}
