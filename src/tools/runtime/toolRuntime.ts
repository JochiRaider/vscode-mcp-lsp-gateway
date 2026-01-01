import { createHash } from 'node:crypto';
import { LruCache } from './lruCache.js';
import { formatEpochTupleString } from '../paging/cursor.js';
import { stableJsonStringify } from '../../util/stableStringify.js';

const PAGED_FULL_SET_PER_ENTRY_CAP_BYTES = 2 * 1024 * 1024;
const PAGED_FULL_SET_TOTAL_CAP_BYTES = 20 * 1024 * 1024;
const PAGED_FULL_SET_TTL_MS = 10_000;
const UNPAGED_PER_ENTRY_CAP_BYTES = 1 * 1024 * 1024;
const UNPAGED_TOTAL_CAP_BYTES = 5 * 1024 * 1024;

export class ToolRuntime {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly unpagedCaches = new Map<string, LruCache<string, unknown>>();
  private textEpoch = 0;
  private fsEpoch = 0;
  private diagnosticsEpoch = 0;
  private rootsEpoch = 0;
  private textEpochPending = false;
  private diagnosticsEpochPending = false;
  private disposed = false;
  public readonly pagedFullSetCache = new LruCache<string, unknown>({
    perEntryCapBytes: PAGED_FULL_SET_PER_ENTRY_CAP_BYTES,
    totalCapBytes: PAGED_FULL_SET_TOTAL_CAP_BYTES,
    ttlMs: PAGED_FULL_SET_TTL_MS,
  });

  public async singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = Promise.resolve()
      .then(fn)
      .finally(() => {
        const current = this.inFlight.get(key);
        if (current === pending) this.inFlight.delete(key);
      });

    this.inFlight.set(key, pending);
    return pending;
  }

  public getUnpagedCache(toolName: string): LruCache<string, unknown> {
    const existing = this.unpagedCaches.get(toolName);
    if (existing) return existing;
    const cache = new LruCache<string, unknown>({
      perEntryCapBytes: UNPAGED_PER_ENTRY_CAP_BYTES,
      totalCapBytes: UNPAGED_TOTAL_CAP_BYTES,
      ttlMs: 0,
    });
    this.unpagedCaches.set(toolName, cache);
    return cache;
  }

  public dispose(): void {
    this.disposed = true;
    this.textEpochPending = false;
    this.diagnosticsEpochPending = false;
    this.inFlight.clear();
    this.pagedFullSetCache.clear();
    for (const cache of this.unpagedCaches.values()) {
      cache.clear();
    }
    this.unpagedCaches.clear();
  }

  public bumpTextEpoch(): void {
    if (this.disposed || this.textEpochPending) return;
    this.textEpochPending = true;
    queueMicrotask(() => {
      this.textEpochPending = false;
      if (this.disposed) return;
      this.textEpoch = nextEpoch(this.textEpoch);
    });
  }

  public bumpFsEpoch(): void {
    this.fsEpoch = nextEpoch(this.fsEpoch);
  }

  public bumpDiagnosticsEpoch(): void {
    if (this.disposed || this.diagnosticsEpochPending) return;
    this.diagnosticsEpochPending = true;
    queueMicrotask(() => {
      this.diagnosticsEpochPending = false;
      if (this.disposed) return;
      this.diagnosticsEpoch = nextEpoch(this.diagnosticsEpoch);
    });
  }

  public bumpRootsEpoch(): void {
    this.rootsEpoch = nextEpoch(this.rootsEpoch);
  }

  public getEpochSnapshotForTool(toolName: string): readonly number[] {
    const epochs = epochsForTool(toolName);
    const snapshot = [this.rootsEpoch];
    if (epochs.text) snapshot.push(this.textEpoch);
    if (epochs.fs) snapshot.push(this.fsEpoch);
    if (epochs.diagnostics) snapshot.push(this.diagnosticsEpoch);
    return snapshot;
  }

  public getSnapshotFingerprint(
    toolName: string,
    allowedRootsRealpaths: readonly string[],
  ): string {
    const rootsKey = sha256hex(stableJsonStringify(sortRoots(allowedRootsRealpaths)));
    const epochTuple = this.getEpochSnapshotForTool(toolName);
    return formatEpochTupleString(rootsKey, epochTuple);
  }
}

type EpochMask = Readonly<{ text: boolean; fs: boolean; diagnostics: boolean }>;

function epochsForTool(toolName: string): EpochMask {
  switch (toolName) {
    case 'vscode.lsp.references':
    case 'vscode.lsp.workspaceSymbols':
      return { text: true, fs: true, diagnostics: false };
    case 'vscode.lsp.diagnostics.workspace':
      return { text: false, fs: true, diagnostics: true };
    default:
      return { text: true, fs: true, diagnostics: true };
  }
}

function sortRoots(roots: readonly string[]): readonly string[] {
  return [...roots].sort();
}

function nextEpoch(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 1;
  const next = Math.floor(value) + 1;
  return next > Number.MAX_SAFE_INTEGER ? 1 : next;
}

function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
