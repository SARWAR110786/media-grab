import type { MediaCategory } from "./media";

export type AnalyzeErrorKind =
  | "invalid"
  | "blocked"
  | "unsupported"
  | "streaming"
  | "unreachable"
  | "http_error"
  | "auth_required"
  | "rate_limited";

export interface AnalyzeFile {
  ok: true;
  kind: "file";
  url: string;
  finalUrl: string;
  redirected: boolean;
  filename: string;
  mimeType: string;
  category: MediaCategory;
  formatLabel: string;
  size: number | null;
  acceptRanges: boolean;
  /** True when the file can be split into several concurrent range requests. */
  segmentable: boolean;
  /** True when the origin allows this web app to fetch the file directly (CORS). */
  corsDirect: boolean;
  /** Bigger than the server's proxy limit — only a direct browser download is possible. */
  exceedsLimit: boolean;
  maxProxySize: number;
  warnings: string[];
}

export interface MediaCandidate {
  url: string;
  filename: string;
  category: MediaCategory;
  formatLabel: string;
  source: string;
  supported: boolean;
  reason?: string;
}

export interface AnalyzeWebpage {
  ok: true;
  kind: "webpage";
  url: string;
  finalUrl: string;
  title: string | null;
  candidates: MediaCandidate[];
  message: string;
}

export interface AnalyzeError {
  ok: false;
  kind: AnalyzeErrorKind;
  message: string;
  status?: number;
  url?: string;
}

export type AnalyzeResponse = AnalyzeFile | AnalyzeWebpage | AnalyzeError;
