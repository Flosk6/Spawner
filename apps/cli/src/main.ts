import { runCli } from "./cli";

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) {
  process.stderr.write(`spawner needs Node.js 20 or later (this is ${process.version})\n`);
  process.exit(1);
}

runCli(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, env: process.env, cwd: process.cwd() }).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`error: ${(error as Error).message}\n`);
    process.exitCode = 1;
  },
);
