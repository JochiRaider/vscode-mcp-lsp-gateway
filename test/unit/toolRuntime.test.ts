import { expect } from 'chai';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';

describe('ToolRuntime singleflight', () => {
  it('shares a single in-flight promise and clears on resolve', async () => {
    const runtime = new ToolRuntime();
    let calls = 0;

    const fn = async (): Promise<string> => {
      calls += 1;
      return 'ok';
    };

    const p1 = runtime.singleflight('key', fn);
    const p2 = runtime.singleflight('key', fn);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).to.equal('ok');
    expect(r2).to.equal('ok');
    expect(calls).to.equal(1);

    await runtime.singleflight('key', fn);
    expect(calls).to.equal(2);
  });

  it('shares rejections and clears on reject', async () => {
    const runtime = new ToolRuntime();
    let calls = 0;
    const err = new Error('boom');

    const fn = async (): Promise<string> => {
      calls += 1;
      throw err;
    };

    const p1 = runtime.singleflight('key', fn);
    const p2 = runtime.singleflight('key', fn);

    try {
      await p1;
      throw new Error('expected rejection');
    } catch (caught) {
      expect(caught).to.equal(err);
    }

    try {
      await p2;
      throw new Error('expected rejection');
    } catch (caught) {
      expect(caught).to.equal(err);
    }

    expect(calls).to.equal(1);

    await runtime.singleflight('key', async () => {
      calls += 1;
      return 'ok';
    });
    expect(calls).to.equal(2);
  });
});
