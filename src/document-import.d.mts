export const IMPORT_STATUS: Readonly<Record<string, string>>;

export type ParsedDocument = {
  source: string;
  externalId: string;
  title: string;
  author: string;
  url: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  body: string;
  mediaRefs: Array<{ type: string; url: string; alt: string }>;
  importError: string | null;
};

export function markdownToHtml(markdown: string): string;
export function zhihuContentDetailRequest(url: string): {
  type: 'answer' | 'article' | 'pin';
  id: string;
  url: string;
  include: string;
} | null;
export function parseDocument(input: Record<string, unknown>): {
  ok: boolean;
  status: string;
  error?: string;
  source?: string;
  externalId?: string;
  url?: string;
  document?: ParsedDocument;
};
export function importUrl(url: string, options: {
  fetchHtml?: (url: string) => Promise<{ status: number; body?: string; fetchedAt?: string }>;
  fetchJson?: (url: string, include?: string) => Promise<{ status: number; payload?: unknown; marker?: string; fetchedAt?: string }>;
}): Promise<{
  ok: boolean;
  status: string;
  error?: string;
  httpStatus?: number | null;
  failureStage?: string;
  failureCode?: string;
  source?: string;
  externalId?: string;
  url?: string;
  document?: ParsedDocument;
}>;

export function importZhihuContent(url: string, options: {
  fetchJson: (url: string, include?: string) => Promise<{ status: number; payload?: unknown; marker?: string; fetchedAt?: string }>;
}): Promise<{
  ok: boolean;
  status: string;
  error?: string;
  httpStatus?: number | null;
  failureStage?: string;
  failureCode?: string;
  source?: string;
  externalId?: string;
  url?: string;
  document?: ParsedDocument;
}>;
