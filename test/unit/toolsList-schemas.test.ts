import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { dispatchToolsList } from '../../src/tools/dispatcher';
import { SchemaRegistry } from '../../src/tools/schemaRegistry';

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
});
