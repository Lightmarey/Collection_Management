import type { ReaderListOptions } from "../contracts/domain";
import type { ReaderStore } from "../ports/knowledge-store";
import type { MediaStore } from "../ports/media-store";

export class ReaderService {
  constructor(
    private readonly database: ReaderStore,
    private readonly media?: MediaStore,
  ) {}

  bootstrap(options: ReaderListOptions = {}) {
    return {
      documents: this.database.listDocuments(options),
      tags: this.database.listTags(),
      sources: this.database.listSources(),
      session: this.database.getReaderSession(),
    };
  }

  document(documentId: string, versionId: string | null = null) {
    const document = this.database.getDocument(documentId, versionId);
    if (document && typeof document === "object" && "id" in document) {
      document.versions = this.database.listDocumentVersions(
        String(document.id),
      );
      document.sourceMemberships = this.database.getDocumentSourceMemberships(
        String(document.id),
      );
    }
    return document;
  }

  annotations(input: { query?: string; kind?: string } = {}) {
    return this.database.listAnnotations(input);
  }

  createHighlight(input: Parameters<ReaderStore["addHighlight"]>[0]) {
    return this.database.addHighlight(input);
  }
  updateHighlight(id: string, input: Record<string, unknown>) {
    return this.database.updateHighlight(id, input);
  }
  deleteHighlight(id: string) {
    return this.database.deleteHighlight(id);
  }
  createNote(input: Parameters<ReaderStore["addNote"]>[0]) {
    return this.database.addNote(input);
  }
  updateNote(id: string, input: Record<string, unknown>) {
    return this.database.updateNote(id, input);
  }
  deleteNote(id: string) {
    return this.database.deleteNote(id);
  }
  addTag(documentId: string, name: string) {
    return this.database.addTag(documentId, name);
  }
  updateTagMemberships(input: {
    documentIds: string[];
    tagId?: string;
    name?: string;
    present: boolean;
  }) {
    return this.database.updateTagMemberships(input.documentIds, input);
  }
  removeTag(documentId: string, tagId: string) {
    return this.database.removeTag(documentId, tagId);
  }
  renameTag(tagId: string, name: string) {
    return this.database.renameTag(tagId, name);
  }
  saveState(input: Parameters<ReaderStore["saveReadingState"]>[0]) {
    return this.database.saveReadingState(input);
  }
  updateProperties(input: {
    documentId: string;
    tier?: string;
    favorite?: boolean;
    tags?: string[];
  }) {
    const state = this.database.saveReadingState(input);
    if (Array.isArray(input.tags)) {
      const document = this.database.getDocument(input.documentId) as {
        tags?: Array<{ id: string; name: string }>;
      } | null;
      const wanted = new Set(
        input.tags.map((name) => name.trim()).filter(Boolean),
      );
      for (const tag of document?.tags ?? [])
        if (!wanted.has(tag.name))
          this.database.removeTag(input.documentId, tag.id);
      for (const name of wanted)
        if (!(document?.tags ?? []).some((tag) => tag.name === name))
          this.database.addTag(input.documentId, name);
    }
    return state;
  }
  saveSession(documentId: string | null) {
    return this.database.saveReaderSession(documentId);
  }
  trash(documentId: string) {
    return this.database.trashDocument(documentId);
  }
  restore(documentId: string) {
    return this.database.restoreDocument(documentId);
  }
  async deletePermanently(documentId: string) {
    const result = this.database.deleteDocumentPermanently(documentId) as {
      orphanedMediaUrls?: string[];
    };
    await Promise.all(
      (result.orphanedMediaUrls ?? []).map((url) => this.media?.remove(url)),
    );
    return result;
  }
  async emptyTrash() {
    const result = this.database.emptyTrash() as {
      deleted: number;
      orphanedMediaUrls?: string[];
    };
    await Promise.all(
      (result.orphanedMediaUrls ?? []).map((url) => this.media?.remove(url)),
    );
    return result;
  }
  preferences() {
    return this.database.getReaderPreferences();
  }
  savePreferences(input: Record<string, unknown>) {
    return this.database.saveReaderPreferences(input);
  }
  async importFont(input: {
    name: string;
    mimeType: string;
    bytes: Uint8Array;
  }) {
    if (
      !this.media ||
      !input.name.trim() ||
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > 64 * 1024 * 1024
    )
      throw Object.assign(new Error("字体文件无效"), {
        code: "VALIDATION_ERROR",
      });
    const allowed = new Set([
      "font/woff",
      "font/woff2",
      "font/ttf",
      "font/otf",
    ]);
    if (!allowed.has(input.mimeType))
      throw Object.assign(new Error("字体格式不支持"), {
        code: "VALIDATION_ERROR",
      });
    const stored = await this.media.put({
      bytes: input.bytes,
      mimeType: input.mimeType,
    });
    return this.database.saveReaderPreferences({
      customFontUrl: stored.url,
      customFontName: input.name,
      fontFamily: "custom",
    });
  }
}
