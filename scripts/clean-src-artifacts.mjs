import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const srcDir = path.join(rootDir, 'src');

async function removeArtifacts(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await removeArtifacts(fullPath);
        return;
      }
      if (entry.name.endsWith('.js') || entry.name.endsWith('.js.map')) {
        await fs.unlink(fullPath);
      }
    }),
  );
}

await removeArtifacts(srcDir);
