// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

// Self-built translation layer for the own-signal client.
// Contract: GET /tr?k=<key>&q=<text>&f=<src>&t=<dst> -> [[["译文"]]]
// The key is injected at build time (placeholder below is replaced by CI).

import { useEffect, useState } from 'react';

const TR_ENDPOINT = 'https://translate.juyan.cc/tr';
const TR_KEY = '__TR_KEY__';

const CACHE = new Map<string, string>();
const MAX_CONCURRENT = 4;
let inFlight = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => {
    waiting.push(() => {
      inFlight += 1;
      resolve();
    });
  });
}

function release(): void {
  inFlight -= 1;
  const next = waiting.shift();
  if (next) {
    next();
  }
}

function extractTranslation(data: unknown): string | null {
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const segments = data[0] as unknown[];
    if (Array.isArray(segments[0])) {
      const first = (segments[0] as unknown[])[0];
      if (typeof first === 'string' && first.length > 0) {
        return first;
      }
    }
  }
  return null;
}

export function isMostlyChinese(text: string): boolean {
  let cjk = 0;
  let total = 0;
  for (const ch of text) {
    total += 1;
    if (ch >= '\u4e00' && ch <= '\u9fff') {
      cjk += 1;
    }
  }
  return total > 0 && cjk / total > 0.3;
}

export async function translateText(
  text: string,
  from: string,
  to: string
): Promise<string | null> {
  const cacheKey = `${from}|${to}|${text}`;
  const cached = CACHE.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  if (TR_KEY === '__TR_KEY__' || !TR_KEY) {
    return null;
  }
  await acquire();
  try {
    const params = new URLSearchParams({
      k: TR_KEY,
      q: text,
      f: from,
      t: to,
    });
    const res = await fetch(`${TR_ENDPOINT}?${params.toString()}`);
    if (!res.ok) {
      return null;
    }
    const json: unknown = await res.json();
    const out = extractTranslation(json);
    if (out) {
      CACHE.set(cacheKey, out);
    }
    return out;
  } catch {
    return null;
  } finally {
    release();
  }
}

export function useAutoTranslate(
  text: string,
  enabled: boolean
): string | null {
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    const trimmed = text.trim();
    if (!enabled || trimmed.length === 0 || isMostlyChinese(trimmed)) {
      return undefined;
    }
    let cancelled = false;
    void translateText(trimmed, 'auto', 'zh').then(out => {
      if (!cancelled) {
        setResult(out);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [text, enabled]);

  return result;
}
