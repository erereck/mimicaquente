import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const children = [
  spawn(process.execPath, [join(root, "server", "game-server.mjs")], {
    cwd: root,
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    [join(root, "node_modules", "vinext", "dist", "cli.js"), "dev", "--hostname", "0.0.0.0"],
    { cwd: root, stdio: "inherit" },
  ),
];

function stop(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) stop(code);
  });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
