const minimumMajor = 20;
const currentVersion = process.versions.node;
const currentMajor = Number(currentVersion.split('.')[0]);

if (currentMajor < minimumMajor) {
  console.error(
    `[startup] Node ${currentVersion} no es compatible. ` +
    `Muchotexto Server necesita Node ${minimumMajor} o superior (recomendado: Node 22 LTS).`
  );
  console.error('[startup] Con nvm: nvm install 22 && nvm use 22');
  process.exit(1);
}

console.log(`[startup] Node ${currentVersion} compatible.`);
