import { expect } from "chai";
import { dispatchToolCall } from "../../src/tools/dispatcher";
import type { SchemaRegistry } from "../../src/tools/schemaRegistry";

describe("dispatcher", () => {
  it("returns INVALID_PARAMS for unknown tool names", async () => {
    const deps = {
      schemaRegistry: {} as SchemaRegistry,
      allowedRootsRealpaths: [],
      maxItemsPerPage: 200,
      requestTimeoutMs: 1000,
    };

    const res = await dispatchToolCall("unknown.tool", {}, deps);
    expect(res.ok).to.equal(false);
    if (!res.ok) {
      expect(res.error.code).to.equal(-32602);
      const data = res.error.data as { code?: string };
      expect(data.code).to.equal("MCP_LSP_GATEWAY/INVALID_PARAMS");
    }
  });
});
