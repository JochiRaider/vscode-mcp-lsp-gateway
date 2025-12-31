import { build, context } from 'esbuild';
import process from 'node:process';

const args = new Set(process.argv.slice(2));
const isWatch = args.has('--watch');
const isProduction = args.has('--production');

const options = {
  entryPoints: ['src/extension.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: !isProduction,
  minify: isProduction,
  external: ['vscode'],
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
