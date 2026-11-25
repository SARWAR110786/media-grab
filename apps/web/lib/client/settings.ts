"use client";
import { useSyncExternalStore } from "react";

export interface Settings {
  /** Parallel connections per file (1 disables acceleration). */
  connections: number;
  /** Smallest segment size in MiB. */
  minSegmentMB: number;
  /** Simultaneous downloads; the rest wait in the queue. */
  maxConcurrent: number;
  /** Fetch straight from the file host when it allows CORS, instead of through the server. */
  preferDirect: boolean;
  /** Save the file automatically when the download completes. */
  autoSave: boolean;
  /** Retries per segment before giving up. */
  retries: number;
  /** Total download speed limit in KB/s across all downloads; 0 = unlimited. */
  speedLimitKBps: number;
}

export const DEFAULT_SETTINGS: Settings = {
  connections: 4,
  minSegmentMB: 2,
  maxConcurrent: 3,
  preferDirect: true,
  autoSave: true,
  retries: 4,
  speedLimitKBps: 0,
};

const KEY = "mediagrab.settings.v1";
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

function load(): Settings {
  if (cache) return cache;
  let raw: Partial<Settings> = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    /* ignore */
  }
  cache = {
    connections: clamp(raw.connections, 1, 16, DEFAULT_SETTINGS.connections),
    minSegmentMB: clamp(raw.minSegmentMB, 1, 64, DEFAULT_SETTINGS.minSegmentMB),
    maxConcurrent: clamp(raw.maxConcurrent, 1, 6, DEFAULT_SETTINGS.maxConcurrent),
    retries: clamp(raw.retries, 0, 10, DEFAULT_SETTINGS.retries),
    speedLimitKBps: clamp(raw.speedLimitKBps, 0, 10_000_000, DEFAULT_SETTINGS.speedLimitKBps),
    preferDirect: typeof raw.preferDirect === "boolean" ? raw.preferDirect : DEFAULT_SETTINGS.preferDirect,
    autoSave: typeof raw.autoSave === "boolean" ? raw.autoSave : DEFAULT_SETTINGS.autoSave,
  };
  return cache;
}

export function getSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  return load();
}

export function updateSettings(patch: Partial<Settings>): void {
  cache = { ...load(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage full or blocked */
  }
  cache = null;
  load();
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSettings,
    () => DEFAULT_SETTINGS,
  );
}
