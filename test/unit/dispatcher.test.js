'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const chai_1 = require('chai');
const dispatcher_1 = require('../../src/tools/dispatcher');
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
});
//# sourceMappingURL=dispatcher.test.js.map
