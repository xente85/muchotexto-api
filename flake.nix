{
  description = "MuchoTexto API dev environment with Node.js 18";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-23.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
      in {
        devShell = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_18
            pkgs.nodePackages.npm
          ];

          shellHook = ''
            if [ ! -d node_modules ]; then
              echo "Instalando dependencias npm..."
              npm install
            fi

            echo "Listo para desarrollar con Node $(node -v)"
          '';
        };
      });
}
