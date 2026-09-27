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
        # libdvdcss/libdvdread/dvdbackup: optional convert front-end for
        # CSS-encrypted optical discs (rip to a writable tree, then convert).
        # See AGENTS.md — not used by the Node pipeline until the rip step lands.
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            pnpm
            ffmpeg
            libdvdcss
            libdvdread
            dvdbackup
            typescript-language-server
            nixfmt-rfc-style
          ];

          shellHook = ''
            echo "DVD.js devShell — node $(node --version), pnpm $(pnpm --version)"
            echo "Setup: pnpm install && pnpm build"
            echo "Run:   cp config/app.example.json config/app.json  # then edit webFolder"
            echo "       pnpm convert -- /path/to/DVD && pnpm start"
            echo "Rip tools: dvdbackup (libdvdcss) for encrypted discs — see AGENTS.md"
          '';
        };
      }
    );
}
