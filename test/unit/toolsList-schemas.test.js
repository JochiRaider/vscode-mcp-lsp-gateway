'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const path = require('node:path');
const chai_1 = require('chai');
const vscode = require('vscode');
const dispatcher_1 = require('../../src/tools/dispatcher');
const schemaRegistry_1 = require('../../src/tools/schemaRegistry');
function createTestContext(repoRoot) {
  return {
    extensionUri: vscode.Uri.file(repoRoot),
    asAbsolutePath: (relPath) => path.join(repoRoot, relPath),
  };
}
describe('tools/list schemas', () => {
  it('includes inputSchema and outputSchema for every v1 tool', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const context = createTestContext(repoRoot);
    const schemaRegistry = await schemaRegistry_1.SchemaRegistry.create(context);
    const res = (0, dispatcher_1.dispatchToolsList)(schemaRegistry);
    for (const tool of res.tools) {
      (0, chai_1.expect)(tool.inputSchema).to.be.an('object');
      (0, chai_1.expect)(tool.outputSchema).to.be.an('object');
      const inputSchema = tool.inputSchema;
      const outputSchema = tool.outputSchema;
      (0, chai_1.expect)(inputSchema['$schema']).to.be.a('string');
      (0, chai_1.expect)(inputSchema['type']).to.equal('object');
      (0, chai_1.expect)(inputSchema['additionalProperties']).to.equal(false);
      (0, chai_1.expect)(outputSchema['$schema']).to.be.a('string');
      (0, chai_1.expect)(outputSchema['type']).to.equal('object');
      (0, chai_1.expect)(outputSchema['additionalProperties']).to.equal(false);
    }
  });
});
//# sourceMappingURL=toolsList-schemas.test.js.map
