export type StoredMedia = {
  url: string;
  contentHash: string;
  mimeType: string;
  byteLength: number;
};

export type MediaReadResult = {
  bytes: Uint8Array;
  mimeType: string;
};

export interface MediaStore {
  put(input: { bytes: Uint8Array; mimeType: string }): Promise<StoredMedia>;
  read(url: string): Promise<MediaReadResult | null>;
  remove(url: string): Promise<boolean>;
}
