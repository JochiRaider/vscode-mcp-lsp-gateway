import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { FORCE_ENV_VAR, shouldSkipIntegrationTests } from './vscode-test-gate.mjs';

const formatSkipMessage = () =>
  [
    '[vscode-test] Skipping VS Code integration tests in CI.',
    `Set ${FORCE_ENV_VAR}=1 to force-run (may still fail in sandboxed environments).`,
  ].join(' ');

const runVscodeTest = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn('vscode-test', args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

const main = async () => {
  const decision = shouldSkipIntegrationTests(process.env);
  if (decision.shouldSkip) {
    console.log(formatSkipMessage());
    return 0;
  }

  const exitCode = await runVscodeTest(process.argv.slice(2));
  return exitCode;
};

const isMain = () => {
  if (!process.argv[1]) {
    return false;
  }
  return import.meta.url === pathToFileURL(process.argv[1]).href;
};

if (isMain()) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error('[vscode-test] Failed to launch integration tests.');
      console.error(error);
      process.exitCode = 1;
    });
}
