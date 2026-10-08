import { runCli } from "./cli";
import { skipWorkingDirectoryLookup, unsupportedRuntime } from "./runtime";

const unsupported = unsupportedRuntime(process.versions);
if (unsupported) {
  process.stderr.write(`${unsupported}\n`);
  process.exit(1);
}
// Before any program runs: no module imported above starts one as it loads.
skipWorkingDirectoryLookup(process.platform, process.env);

runCli(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, env: process.env, cwd: process.cwd() }).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`error: ${(error as Error).message}\n`);
    process.exitCode = 1;
  },
);
