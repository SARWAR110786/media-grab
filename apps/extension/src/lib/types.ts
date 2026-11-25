import type { MediaCategory } from "@mediagrab/shared";

export type MediaSource = "video" | "audio" | "source" | "link" | "meta" | "network" | "embed";

export interface DetectedMedia {
  /** Stable key: the URL, or a synthetic key for blob/DRM media. */
  id: string;
  url: string;
  filename: string;
  ext: string;
  mime: string;
  category: MediaCategory;
  label: string;
  source: MediaSource;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  supported: boolean;
  reason?: string;
}

export interface FrameReport {
  pageId: string;
  pageUrl: string;
  title: string;
  items: DetectedMedia[];
  notes: string[];
}

export interface TabMedia {
  pageId: string;
  pageUrl: string;
  title: string;
  frames: Record<string, FrameReport>;
}

export interface ProbeResult {
  size?: number;
  mime?: string;
  acceptRanges?: boolean;
}

export interface DownloadEntry {
  id: number;
  url: string;
  filename: string;
  pageTitle?: string;
  startedAt: number;
}

export type Message =
  | { type: "media:update"; report: FrameReport }
  | { type: "media:get"; tabId: number }
  | { type: "media:probe"; urls: string[] }
  | { type: "mediagrab:rescan" }
  | { type: "download:start"; items: Array<{ url: string; filename: string }>; pageTitle?: string };

export interface StartResult {
  url: string;
  ok: boolean;
  downloadId?: number;
  error?: string;
}
