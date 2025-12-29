"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const redact_1 = require("../../src/logging/redact");
class FakeOutputChannel {
    lines = [];
    appendLine(line) {
        this.lines.push(line);
    }
}
describe('redaction', () => {
    it('redacts authorization and session ids in structured meta', () => {
        const output = new FakeOutputChannel();
        const logger = (0, redact_1.createLogger)(output, {
            debugEnabled: true,
            maxChars: 2048,
        });
        logger.debug('test', {
            authorization: 'Bearer secret-token',
            'mcp-session-id': 'session-123',
            nested: { Authorization: 'Bearer another-secret' },
        });
        const line = output.lines[0] ?? '';
        (0, chai_1.expect)(line).to.include('[REDACTED]');
        (0, chai_1.expect)(line).to.not.include('secret-token');
        (0, chai_1.expect)(line).to.not.include('another-secret');
        (0, chai_1.expect)(line).to.not.include('session-123');
    });
    it('redacts session id and authorization headers in header maps', () => {
        const redacted = (0, redact_1.redactHeaders)({
            'MCP-Session-Id': 'session-123',
            authorization: 'Bearer secret-token',
            'content-type': 'application/json',
        });
        (0, chai_1.expect)(redacted['MCP-Session-Id']).to.equal('[REDACTED]');
        (0, chai_1.expect)(redacted['authorization']).to.equal('[REDACTED]');
        (0, chai_1.expect)(redacted['content-type']).to.equal('application/json');
    });
});
//# sourceMappingURL=redact.test.js.map