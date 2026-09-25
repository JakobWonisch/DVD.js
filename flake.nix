{
  description = "DVD.js — convert and preserve DVD menus for the browser";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            pnpm
            ffmpeg
            typescript-language-server
            nixfmt-rfc-style
          ];

          shellHook = ''
            echo "DVD.js devShell — node $(node --version), pnpm $(pnpm --version)"
            echo "Setup: pnpm install && pnpm build"
            echo "Run:   cp config/app.example.json config/app.json  # then edit webFolder"
            echo "       pnpm convert -- /path/to/DVD && pnpm start"
          '';
        };
      }
    );
}
