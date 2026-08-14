import type { ParsedDocument } from '../document-import.mjs';
import type { SyncItem } from '../contracts/domain';

export type SourceDescriptor = {
  source: string;
  kind: string;
  id: string;
  pageUrl: string;
  name: string;
};

export type StoredSourceMembership = {
  source: string;
  sourceId: string;
  name: string;
  externalId: string;
  documentSource: string;
  url: string | null;
};

export type DiscoveredSource = SourceDescriptor & {
  owned: boolean;
  writable: boolean;
  itemCount?: number;
};

export type SourceResponse = {
  status: number;
  payload: unknown | null;
  marker: string;
  verificationUrl?: string | null;
  fetchedAt: string;
};

export type CaptureResult = {
  ok: boolean;
  sourceType?: string;
  sourceId?: string;
  collectionId?: string;
  itemCount: number;
  pageCount: number;
  items: SyncItem[];
  failureType?: string;
};

export type ImportedSourceDocument = {
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
};

export interface SourceAdapter {
  readonly id: string;
  supports(url: string): boolean;
  resolve(url: string): SourceDescriptor;
  open(descriptor: SourceDescriptor): Promise<void>;
  capture(url: string, hooks?: Record<string, unknown>): Promise<CaptureResult>;
  importDocument(url: string, fetchJson?: (url: string, include?: string) => Promise<SourceResponse>): Promise<ImportedSourceDocument>;
  fetchJson(url: string, include?: string): Promise<SourceResponse>;
  verifySession(): Promise<boolean | null>;
  recover(response: SourceResponse, failureType: string): Promise<void>;
  hideRecovery(): void;
  localize(document: ParsedDocument): Promise<ParsedDocument>;
  discoverSources?(): Promise<DiscoveredSource[]>;
  resolveMembership?(membership: StoredSourceMembership): SourceDescriptor;
  removeMembership?(source: SourceDescriptor, item: SyncItem): Promise<{ ok: boolean; error?: string }>;
}
