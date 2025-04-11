{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs_18
    pkgs.nodePackages.npm
  ];

  shellHook = ''
    if [ ! -d node_modules ]; then
      echo "⚙️ Instalando dependencias npm..."
      npm install
    fi
    echo "✅ Entorno Node listo con versión $(node -v)"
  '';
}
