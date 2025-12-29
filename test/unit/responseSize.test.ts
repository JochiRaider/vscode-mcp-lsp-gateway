import { expect } from 'chai';
import { jsonByteLength, utf8ByteLength } from '../../src/util/responseSize';
import { truncateHoverToolCallResult } from '../../src/tools/truncate';

describe('response size helpers', () => {
  it('measures UTF-8 byte length deterministically', () => {
    const ascii = 'abc';
    const unicode = '✓';

    expect(utf8ByteLength(ascii)).to.equal(3);
    expect(utf8ByteLength(unicode)).to.equal(Buffer.byteLength(unicode, 'utf8'));
  });

  it('measures JSON byte length deterministically', () => {
    const payload = { ok: true, value: '✓' };
    expect(jsonByteLength(payload)).to.equal(Buffer.byteLength(JSON.stringify(payload), 'utf8'));
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
    const measured = (candidate: unknown) =>
      jsonByteLength({ jsonrpc: '2.0', id: 1, result: candidate });

    const truncated = truncateHoverToolCallResult(
      toolResult,
      maxResponseBytes,
      measured,
      { maxFragments: 8, maxFragmentCodepoints: 8192 },
    );

    const size = measured(truncated.result);
    expect(size).to.be.at.most(maxResponseBytes);

    const structured = truncated.result.structuredContent as {
      contents: Array<{ value: string }>;
      summary?: string;
    };
    expect(structured.contents[0].value.length).to.be.lessThan(longValue.length);
    expect(structured.summary ?? '').to.include('Truncated');
  });
});
