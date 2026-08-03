const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { extractFile, listPackage } = require('@electron/asar');

const appRun = `#!/usr/bin/env bash
set -e

if [ -z "\${APPDIR:-}" ]; then
  APPDIR="$(dirname "$(readlink -f "$0")")"
fi

export PATH="\${APPDIR}:\${APPDIR}/usr/sbin\${PATH:+:\${PATH}}"
export XDG_DATA_DIRS="\${APPDIR}/usr/share/\${XDG_DATA_DIRS:+:\${XDG_DATA_DIRS}}:/usr/share/gnome:/usr/local/share/:/usr/share/"
export LD_LIBRARY_PATH="\${APPDIR}/usr/lib\${LD_LIBRARY_PATH:+:\${LD_LIBRARY_PATH}}"
export GSETTINGS_SCHEMA_DIR="\${APPDIR}/usr/share/glib-2.0/schemas\${GSETTINGS_SCHEMA_DIR:+:\${GSETTINGS_SCHEMA_DIR}}"

BIN="\${APPDIR}/gameplay-simulator"

if [ ! -x "\${BIN}" ]; then
  echo "GameplaySimulator executable was not found inside the AppImage." >&2
  exit 1
fi

exec "\${BIN}" "$@"
`;

module.exports = async function installSandboxedAppImageLauncher(context) {
  const sourceLicense = await readFile(join(context.packager.projectDir, 'LICENSE'), 'utf8');
  const asarPath = join(context.appOutDir, 'resources', 'app.asar');
  const packagedFiles = listPackage(asarPath).map((path) => path.replaceAll('\\', '/'));

  if (!packagedFiles.includes('/LICENSE')) {
    throw new Error('The packaged application is missing the root MIT LICENSE file.');
  }

  const packagedLicense = extractFile(asarPath, 'LICENSE').toString('utf8');
  if (packagedLicense !== sourceLicense) {
    throw new Error('The packaged MIT LICENSE does not match the source LICENSE file.');
  }

  if (context.electronPlatformName !== 'linux') {
    return;
  }

  await writeFile(join(context.appOutDir, 'AppRun'), appRun, {
    encoding: 'utf8',
    mode: 0o755
  });
};
