import { ipcMain } from "electron";
import type { ReaderListOptions } from "../../contracts/domain";
import type { ReaderStore } from "../../ports/knowledge-store";
import { ReaderService } from "../../services/reader-service";

function objectInput(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function registerReaderIpc(options: {
  reader: ReaderService;
  assertTrusted(sender: Electron.WebContents): void;
  log(event: string, details?: Record<string, unknown>): void;
  onPreferencesSaved?(
    preferences: ReturnType<ReaderService["preferences"]>,
  ): void;
}) {
  const { reader, assertTrusted, log, onPreferencesSaved } = options;
  const failure = (operation: string, error: unknown) => {
    log(operation, {
      code:
        error instanceof Error && "code" in error
          ? error.code
          : "DATABASE_ERROR",
    });
    return {
      ok: false,
      error:
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "database_error",
    };
  };
  const handle = (
    channel: string,
    operation: string,
    action: (...args: unknown[]) => unknown,
  ) => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrusted(event.sender);
      try {
        return { ok: true, ...((await action(...args)) as object) };
      } catch (error) {
        return failure(operation, error);
      }
    });
  };

  ipcMain.handle("reader:bootstrap", (event, input?: ReaderListOptions) => {
    assertTrusted(event.sender);
    try {
      return { ok: true, ...reader.bootstrap(input ?? {}) };
    } catch (error) {
      return failure("reader-bootstrap-failed", error);
    }
  });

  ipcMain.handle(
    "reader:get-document",
    (event, documentId?: unknown, versionId?: unknown) => {
      assertTrusted(event.sender);
      try {
        const document = reader.document(
          typeof documentId === "string" ? documentId : "",
          typeof versionId === "string" ? versionId : null,
        );
        return document
          ? { ok: true, document }
          : { ok: false, error: "document_not_found" };
      } catch (error) {
        return failure("reader-document-failed", error);
      }
    },
  );

  handle("reader:list-annotations", "reader-annotations-failed", (input) => ({
    annotations: reader.annotations(objectInput(input)),
  }));

  handle("annotation:create-highlight", "highlight-create-failed", (input) => ({
    highlight: reader.createHighlight(
      objectInput(input) as Parameters<ReaderStore["addHighlight"]>[0],
    ),
  }));
  handle(
    "annotation:update-highlight",
    "highlight-update-failed",
    (id, input) => ({
      highlight: reader.updateHighlight(
        typeof id === "string" ? id : "",
        objectInput(input),
      ),
    }),
  );
  handle("annotation:delete-highlight", "highlight-delete-failed", (id) =>
    reader.deleteHighlight(typeof id === "string" ? id : ""),
  );
  handle("annotation:create-note", "note-create-failed", (input) => ({
    note: reader.createNote(
      objectInput(input) as Parameters<ReaderStore["addNote"]>[0],
    ),
  }));
  handle("annotation:update-note", "note-update-failed", (id, input) => ({
    note: reader.updateNote(
      typeof id === "string" ? id : "",
      objectInput(input),
    ),
  }));
  handle("annotation:delete-note", "note-delete-failed", (id) =>
    reader.deleteNote(typeof id === "string" ? id : ""),
  );
  handle("annotation:add-tag", "tag-create-failed", (documentId, name) => ({
    tag: reader.addTag(
      typeof documentId === "string" ? documentId : "",
      typeof name === "string" ? name : "",
    ),
  }));
  handle(
    "annotation:update-tag-memberships",
    "tag-memberships-update-failed",
    (input) => {
      const value = objectInput(input);
      return reader.updateTagMemberships({
        documentIds: Array.isArray(value.documentIds)
          ? value.documentIds.filter(
              (id): id is string => typeof id === "string" && Boolean(id),
            )
          : [],
        tagId: typeof value.tagId === "string" ? value.tagId : undefined,
        name: typeof value.name === "string" ? value.name : undefined,
        present: value.present !== false,
      });
    },
  );
  handle("annotation:remove-tag", "tag-delete-failed", (documentId, tagId) =>
    reader.removeTag(
      typeof documentId === "string" ? documentId : "",
      typeof tagId === "string" ? tagId : "",
    ),
  );
  handle("annotation:rename-tag", "tag-update-failed", (tagId, name) => ({
    tag: reader.renameTag(
      typeof tagId === "string" ? tagId : "",
      typeof name === "string" ? name : "",
    ),
  }));
  handle("reader:save-state", "reader-state-save-failed", (input) => ({
    state: reader.saveState(
      objectInput(input) as Parameters<ReaderStore["saveReadingState"]>[0],
    ),
  }));
  handle(
    "reader:update-properties",
    "reader-properties-save-failed",
    (input) => ({
      state: reader.updateProperties(
        objectInput(input) as {
          documentId: string;
          tier?: string;
          favorite?: boolean;
          tags?: string[];
        },
      ),
    }),
  );
  handle("reader:save-session", "reader-session-save-failed", (documentId) => ({
    session: reader.saveSession(
      typeof documentId === "string" ? documentId : null,
    ),
  }));
  handle("reader:trash", "reader-trash-failed", (documentId) =>
    reader.trash(typeof documentId === "string" ? documentId : ""),
  );
  handle("reader:restore", "reader-restore-failed", (documentId) =>
    reader.restore(typeof documentId === "string" ? documentId : ""),
  );
  handle("reader:delete-permanently", "reader-delete-failed", (documentId) =>
    reader.deletePermanently(typeof documentId === "string" ? documentId : ""),
  );
  handle("reader:empty-trash", "reader-empty-trash-failed", () =>
    reader.emptyTrash(),
  );
  handle("reader:preferences", "reader-preferences-failed", () => ({
    preferences: reader.preferences(),
  }));
  handle(
    "reader:save-preferences",
    "reader-preferences-save-failed",
    (input) => {
      const preferences = reader.savePreferences(objectInput(input));
      onPreferencesSaved?.(preferences);
      return { preferences };
    },
  );
  handle("reader:import-font", "reader-font-import-failed", (input) => {
    const value = objectInput(input);
    return reader
      .importFont({
        name: typeof value.name === "string" ? value.name : "",
        mimeType: typeof value.mimeType === "string" ? value.mimeType : "",
        bytes:
          value.bytes instanceof Uint8Array ? value.bytes : new Uint8Array(),
      })
      .then((preferences) => ({ preferences }));
  });
}
