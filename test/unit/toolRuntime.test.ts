import { expect } from 'chai';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';

const flushMicrotasks = async (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(resolve));

const getEpochAt = (snapshot: readonly number[], index: number): number => {
  const value = snapshot[index];
  if (value === undefined) {
    throw new Error(`expected epoch at index ${index}`);
  }
  return value;
};

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

describe('ToolRuntime epochs', () => {
  it('returns a stable snapshot ordering per tool', () => {
    const runtime = new ToolRuntime();

    const references = runtime.getEpochSnapshotForTool('vscode.lsp.references');
    expect(references.length).to.equal(3);

    const workspaceDiagnostics = runtime.getEpochSnapshotForTool(
      'vscode.lsp.diagnostics.workspace',
    );
    expect(workspaceDiagnostics.length).to.equal(3);

    const hover = runtime.getEpochSnapshotForTool('vscode.lsp.hover');
    expect(hover.length).to.equal(4);
  });

  it('coalesces text epoch bumps within a tick', async () => {
    const runtime = new ToolRuntime();
    const before = runtime.getEpochSnapshotForTool('vscode.lsp.references');

    runtime.bumpTextEpoch();
    runtime.bumpTextEpoch();
    runtime.bumpTextEpoch();

    const mid = runtime.getEpochSnapshotForTool('vscode.lsp.references');
    expect(getEpochAt(mid, 1)).to.equal(getEpochAt(before, 1));

    await flushMicrotasks();

    const after = runtime.getEpochSnapshotForTool('vscode.lsp.references');
    expect(getEpochAt(after, 1)).to.equal(getEpochAt(before, 1) + 1);

    runtime.bumpTextEpoch();
    await flushMicrotasks();

    const afterSecond = runtime.getEpochSnapshotForTool('vscode.lsp.references');
    expect(getEpochAt(afterSecond, 1)).to.equal(getEpochAt(before, 1) + 2);
  });

  it('coalesces diagnostics epoch bumps within a tick', async () => {
    const runtime = new ToolRuntime();
    const before = runtime.getEpochSnapshotForTool('vscode.lsp.diagnostics.workspace');

    runtime.bumpDiagnosticsEpoch();
    runtime.bumpDiagnosticsEpoch();

    const mid = runtime.getEpochSnapshotForTool('vscode.lsp.diagnostics.workspace');
    expect(getEpochAt(mid, 2)).to.equal(getEpochAt(before, 2));

    await flushMicrotasks();

    const after = runtime.getEpochSnapshotForTool('vscode.lsp.diagnostics.workspace');
    expect(getEpochAt(after, 2)).to.equal(getEpochAt(before, 2) + 1);
  });

  it('does not apply pending bumps after dispose', async () => {
    const runtime = new ToolRuntime();
    const before = runtime.getEpochSnapshotForTool('vscode.lsp.references');

    runtime.bumpTextEpoch();
    runtime.dispose();
    await flushMicrotasks();

    const after = runtime.getEpochSnapshotForTool('vscode.lsp.references');
    expect(getEpochAt(after, 1)).to.equal(getEpochAt(before, 1));
  });
});
