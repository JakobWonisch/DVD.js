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
        # Default ffmpeg disables libdvdread/libdvdnav, so it cannot decrypt
        # CSS discs. ffmpeg-full enables both (via libdvdcss).
        ffmpegForDvd = pkgs.ffmpeg-full;
      in
      {
        # Rip CSS-encrypted discs with dvdbackup (libdvdread→libdvdcss).
        # Convert stills/WebM use ffmpeg-full so dvd:// / CSS-aware demux works.
        # See AGENTS.md.
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            pnpm
            ffmpegForDvd
            libdvdcss
            libdvdread
            libdvdnav
            dvdbackup
            typescript-language-server
            nixfmt-rfc-style
          ];

          shellHook = ''
            export DVDCSS_CACHE="''${XDG_CACHE_HOME:-$HOME/.cache}/dvdcss"
            mkdir -p "$DVDCSS_CACHE"

            echo "DVD.js devShell — node $(node --version), pnpm $(pnpm --version)"
            echo "Setup: pnpm install && pnpm build"
            echo "Run:   cp config/app.example.json config/app.json  # then edit webFolder"
            echo "Rip:   pnpm convert -- --rip /dev/sr0"
            echo "       dvdbackup -i /dev/sr0 -o ~/dvd/work -M"
            echo "       # or: pnpm convert -- --rip-only --work-dir ~/dvd/work /dev/sr0"
            echo "       pnpm convert -- /path/to/DVD && pnpm start"
            echo "CSS:   libdvdcss via dvdbackup when --rip; cache at $DVDCSS_CACHE"
          '';
        };
      }
    );
}
