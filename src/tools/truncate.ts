// src/tools/truncate.ts
//
// Deterministic truncation helpers (v1).

import type { ToolCallResult } from './dispatcher.js';

const DEFAULT_MAX_FRAGMENTS = 8;
const DEFAULT_MAX_FRAGMENT_CODEPOINTS = 8192;

type HoverContent = Readonly<{ kind: 'markdown' | 'plaintext'; value: string }>;
export function truncateHoverToolCallResult(
  result: ToolCallResult,
  maxResponseBytes: number,
  measureJsonRpcBytes: (candidate: ToolCallResult) => number,
  opts: Readonly<{ maxFragments?: number; maxFragmentCodepoints?: number }> = {},
): Readonly<{ result: ToolCallResult; truncated: boolean }> {
  if (result.isError) return { result, truncated: false };

  const structured = result.structuredContent;
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) {
    return { result, truncated: false };
  }

  const rec = structured as Record<string, unknown>;
  const contentsRaw = rec.contents;
  if (!Array.isArray(contentsRaw)) return { result, truncated: false };

  const contents = normalizeHoverContents(contentsRaw);
  if (!contents) return { result, truncated: false };

  const maxFragments = opts.maxFragments ?? DEFAULT_MAX_FRAGMENTS;
  const maxFragmentCodepoints = opts.maxFragmentCodepoints ?? DEFAULT_MAX_FRAGMENT_CODEPOINTS;

  let truncated = false;
  let nextContents = contents.slice(0, Math.max(0, maxFragments));
  if (nextContents.length !== contents.length) truncated = true;

  nextContents = nextContents.map((frag) => {
    const clamped = clampCodepoints(frag.value, maxFragmentCodepoints);
    if (clamped !== frag.value) truncated = true;
    return { kind: frag.kind, value: clamped };
  });

  let candidate = buildResult(result, rec, nextContents, truncated);
  if (!shouldEnforceBytes(maxResponseBytes)) {
    return { result: candidate, truncated };
  }

  if (measureJsonRpcBytes(candidate) <= Math.floor(maxResponseBytes)) {
    return { result: candidate, truncated };
  }

  if (nextContents.length === 0) {
    return { result: candidate, truncated };
  }

  const lastIndex = nextContents.length - 1;
  const last = nextContents[lastIndex]!;
  const codepoints = Array.from(last.value);

  let lo = 0;
  let hi = codepoints.length;
  let best = -1;
  let bestValue = '';

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const value = codepoints.slice(0, mid).join('');
    const adjusted = nextContents.slice(0);
    adjusted[lastIndex] = { kind: last.kind, value };
    const adjustedResult = buildResult(result, rec, adjusted, true);
    if (measureJsonRpcBytes(adjustedResult) <= Math.floor(maxResponseBytes)) {
      best = mid;
      bestValue = value;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best >= 0 && best < codepoints.length) truncated = true;
  if (best >= 0) {
    nextContents = nextContents.slice(0);
    nextContents[lastIndex] = { kind: last.kind, value: bestValue };
    candidate = buildResult(result, rec, nextContents, truncated);
  }

  return { result: candidate, truncated };
}

function normalizeHoverContents(raw: unknown[]): HoverContent[] | undefined {
  const out: HoverContent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return undefined;
    const rec = item as Record<string, unknown>;
    const kind = rec.kind;
    const value = rec.value;
    if (kind !== 'markdown' && kind !== 'plaintext') return undefined;
    if (typeof value !== 'string') return undefined;
    out.push({ kind, value });
  }
  return out;
}

function buildResult(
  base: ToolCallResult,
  structured: Record<string, unknown>,
  contents: readonly HoverContent[],
  truncated: boolean,
): ToolCallResult {
  const summary = truncated ? withTruncationSummary(structured.summary) : structured.summary;
  const structuredContent = {
    ...structured,
    contents,
    ...(summary ? { summary } : undefined),
  };
  const text = typeof summary === 'string' && summary.trim().length > 0 ? summary.trim() : 'OK';
  return {
    ...base,
    structuredContent,
    content: [{ type: 'text', text }],
  };
}

function withTruncationSummary(summary: unknown): string {
  const base = typeof summary === 'string' ? summary.trim() : '';
  if (!base) return 'Hover truncated.';
  if (base.includes('Truncated')) return base;
  return `${base} (Truncated.)`;
}

function clampCodepoints(value: string, max: number): string {
  if (!Number.isFinite(max) || max <= 0) return '';
  const codepoints = Array.from(value);
  if (codepoints.length <= max) return value;
  return codepoints.slice(0, Math.floor(max)).join('');
}

function shouldEnforceBytes(maxResponseBytes: number): boolean {
  return Number.isFinite(maxResponseBytes) && maxResponseBytes > 0;
}
