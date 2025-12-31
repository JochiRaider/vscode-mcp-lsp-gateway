'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const chai_1 = require('chai');
const responseSize_1 = require('../../src/util/responseSize');
const truncate_1 = require('../../src/tools/truncate');
describe('response size helpers', () => {
  it('measures UTF-8 byte length deterministically', () => {
    const ascii = 'abc';
    const unicode = '✓';
    (0, chai_1.expect)((0, responseSize_1.utf8ByteLength)(ascii)).to.equal(3);
    (0, chai_1.expect)((0, responseSize_1.utf8ByteLength)(unicode)).to.equal(
      Buffer.byteLength(unicode, 'utf8'),
    );
  });
  it('measures JSON byte length deterministically', () => {
    const payload = { ok: true, value: '✓' };
    (0, chai_1.expect)((0, responseSize_1.jsonByteLength)(payload)).to.equal(
      Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    );
  });
});
describe('hover truncation', () => {
  it('truncates hover content to fit maxResponseBytes', () => {
    const longValue = 'x'.repeat(5000);
    const toolResult = {
      isError: false,
      structuredContent: {
        contents: [{ kind: 'markdown', value: longValue }],
        summary: 'Hover available.',
      },
      content: [{ type: 'text', text: 'Hover available.' }],
    };
    const maxResponseBytes = 1200;
    const measured = (candidate) =>
      (0, responseSize_1.jsonByteLength)({ jsonrpc: '2.0', id: 1, result: candidate });
    const truncated = (0, truncate_1.truncateHoverToolCallResult)(
      toolResult,
      maxResponseBytes,
      measured,
      {
        maxFragments: 8,
        maxFragmentCodepoints: 8192,
      },
    );
    const size = measured(truncated.result);
    (0, chai_1.expect)(size).to.be.at.most(maxResponseBytes);
    const structured = truncated.result.structuredContent;
    (0, chai_1.expect)(structured.contents[0].value.length).to.be.lessThan(longValue.length);
    (0, chai_1.expect)(structured.summary ?? '').to.include('Truncated');
  });
  it('truncates hover content at UTF-8 boundaries', () => {
    const emoji = '😀';
    const longValue = emoji.repeat(2000);
    const toolResult = {
      isError: false,
      structuredContent: {
        contents: [{ kind: 'markdown', value: longValue }],
        summary: 'Hover available.',
      },
      content: [{ type: 'text', text: 'Hover available.' }],
    };
    const maxResponseBytes = 900;
    const measured = (candidate) =>
      (0, responseSize_1.jsonByteLength)({ jsonrpc: '2.0', id: 1, result: candidate });
    const truncated = (0, truncate_1.truncateHoverToolCallResult)(
      toolResult,
      maxResponseBytes,
      measured,
    );
    const size = measured(truncated.result);
    (0, chai_1.expect)(size).to.be.at.most(maxResponseBytes);
    const structured = truncated.result.structuredContent;
    const truncatedValue = structured.contents[0].value;
    const originalCodepoints = Array.from(longValue);
    const truncatedCodepoints = Array.from(truncatedValue);
    (0, chai_1.expect)(truncatedValue).to.equal(
      originalCodepoints.slice(0, truncatedCodepoints.length).join(''),
    );
  });
});
//# sourceMappingURL=responseSize.test.js.map
