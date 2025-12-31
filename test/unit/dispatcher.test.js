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
describe('dispatcher', () => {
  it('returns INVALID_PARAMS for unknown tool names', async () => {
    const deps = {
      schemaRegistry: {},
      allowedRootsRealpaths: [],
      maxItemsPerPage: 200,
      requestTimeoutMs: 1000,
    };
    const res = await (0, dispatcher_1.dispatchToolCall)('unknown.tool', {}, deps);
    (0, chai_1.expect)(res.ok).to.equal(false);
    if (!res.ok) {
      (0, chai_1.expect)(res.error.code).to.equal(-32602);
      const data = res.error.data;
      (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/INVALID_PARAMS');
    }
  });
  it('returns INVALID_PARAMS for schema failures before handler gating', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const context = createTestContext(repoRoot);
    const schemaRegistry = await schemaRegistry_1.SchemaRegistry.create(context);
    const deps = {
      schemaRegistry,
      allowedRootsRealpaths: [],
      maxItemsPerPage: 200,
      requestTimeoutMs: 1000,
    };
    const res = await (0, dispatcher_1.dispatchToolCall)(
      'vscode.lsp.hover',
      { uri: 'file:///does-not-matter', position: { line: -1, character: 0 } },
      deps,
    );
    (0, chai_1.expect)(res.ok).to.equal(false);
    if (!res.ok) {
      (0, chai_1.expect)(res.error.code).to.equal(-32602);
      const data = res.error.data;
      (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/INVALID_PARAMS');
    }
  });
});
//# sourceMappingURL=dispatcher.test.js.map
