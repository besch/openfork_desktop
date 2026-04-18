const { chmod, rename, stat, writeFile } = require("fs/promises");
const path = require("path");

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "linux") return;

  const targetNames = context.targets.map((target) => target.name.toLowerCase());
  const isAppImageOnlyBuild =
    targetNames.length === 1 && targetNames[0] === "appimage";

  if (!isAppImageOnlyBuild) return;

  const executableName = context.packager.executableName;
  const executablePath = path.join(context.appOutDir, executableName);
  const realExecutablePath = `${executablePath}.bin`;

  if (await pathExists(realExecutablePath)) return;

  await rename(executablePath, realExecutablePath);

  const wrapper = [
    "#!/bin/sh",
    "set -e",
    'DIR=$(dirname "$(readlink -f "$0")")',
    `exec "$DIR/${executableName}.bin" --no-sandbox "$@"`,
    "",
  ].join("\n");

  await writeFile(executablePath, wrapper, "utf8");
  await chmod(executablePath, 0o755);
  await chmod(realExecutablePath, 0o755);

  console.log(
    `Wrapped ${shellQuote(executableName)} with --no-sandbox for AppImage packaging.`,
  );
};
