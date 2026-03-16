import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const tscBin = path.join(cwd, "node_modules", "typescript", "bin", "tsc");
const viteBin = path.join(cwd, "node_modules", "vite", "bin", "vite.js");
const serverEntry = path.join(cwd, "dist", "server", "server", "index.js");

const children = [];

const shutdown = (code = 0) => {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  process.exit(code);
};

const spawnChild = (command, args) => {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
  });

  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown(code);
    }
  });

  return child;
};

const buildServer = () =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tscBin, "-p", "tsconfig.node.json"], {
      cwd,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`Initial server build failed with code ${code}`));
    });
  });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

await buildServer();

spawnChild(process.execPath, [tscBin, "-p", "tsconfig.node.json", "--watch", "--preserveWatchOutput"]);
spawnChild(process.execPath, ["--watch", serverEntry]);
spawnChild(process.execPath, [viteBin]);
