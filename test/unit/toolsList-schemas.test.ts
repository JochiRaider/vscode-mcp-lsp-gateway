import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { V1_TOOL_NAMES } from '../../src/tools/catalog.js';
import { dispatchToolsList } from '../../src/tools/dispatcher.js';
import { SchemaRegistry } from '../../src/tools/schemaRegistry.js';

function createTestContext(repoRoot: string): vscode.ExtensionContext {
  return {
    extensionUri: vscode.Uri.file(repoRoot),
    asAbsolutePath: (relPath: string) => path.join(repoRoot, relPath),
  } as unknown as vscode.ExtensionContext;
}

describe('tools/list schemas', () => {
  it('includes inputSchema and outputSchema for every v1 tool', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const context = createTestContext(repoRoot);
    const schemaRegistry = await SchemaRegistry.create(context);

    const res = dispatchToolsList(schemaRegistry);
    for (const tool of res.tools) {
      expect(tool.inputSchema).to.be.an('object');
      expect(tool.outputSchema).to.be.an('object');

      const inputSchema = tool.inputSchema as Record<string, unknown>;
      const outputSchema = tool.outputSchema as Record<string, unknown>;

      expect(inputSchema['$schema']).to.be.a('string');
      expect(inputSchema['type']).to.equal('object');
      expect(inputSchema['additionalProperties']).to.equal(false);

      expect(outputSchema['$schema']).to.be.a('string');
      expect(outputSchema['type']).to.equal('object');
      expect(outputSchema['additionalProperties']).to.equal(false);
    }
  });

  it('fails closed when an output schema file is missing', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const outDir = path.join(repoRoot, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const tempRoot = fs.mkdtempSync(path.join(outDir, 'schema-registry-'));

    try {
      const tempSchemaDir = path.join(tempRoot, 'schemas', 'tools');
      fs.mkdirSync(path.dirname(tempSchemaDir), { recursive: true });
      fs.cpSync(path.join(repoRoot, 'schemas', 'tools'), tempSchemaDir, { recursive: true });

      const missingTool = V1_TOOL_NAMES[0];
      fs.rmSync(path.join(tempSchemaDir, `${missingTool}.output.json`));

      const context = createTestContext(tempRoot);
      let caught: unknown;
      try {
        await SchemaRegistry.create(context);
      } catch (err) {
        caught = err;
      }

      expect(caught).to.be.instanceOf(Error);
      if (caught instanceof Error) {
        expect(caught.message).to.contain(`Missing tool output schema file for "${missingTool}"`);
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
