const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const excluded = new Set(["node_modules", ".git", ".tmp", "coverage"]);
let checked = 0;
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (entry.isFile() && file.endsWith(".js")) {
      const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", windowsHide: true });
      checked++;
      if (result.error || result.status !== 0) {
        process.stderr.write(result.stderr || `${result.error}\n`);
        process.exitCode = 1;
      }
    }
  }
}
check(root);
process.stdout.write(`Syntax checked ${checked} JavaScript files\n`);
