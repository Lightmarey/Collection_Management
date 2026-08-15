import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  Columns3,
  Copy,
  Expand,
  FileText,
  Highlighter,
  Inbox,
  Info,
  Keyboard,
  List,
  Menu,
  Minus,
  Monitor,
  MoreHorizontal,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Star,
  Square,
  Sun,
  Table2,
  Tags,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  ReaderDocument,
  ReaderAnnotationListItem,
  ReaderListItem,
  ReaderPreferences,
  ReaderTag,
  SourceOption,
  SyncItem,
} from "./contracts/domain";
import {
  AnnotationToolbar,
  type SelectionAnchor,
} from "./renderer/annotation-toolbar";
import { ReaderBody } from "./renderer/reader-body";
import {
  CommandPalette,
  type AppCommand,
} from "./renderer/command-palette";
import { useSourceSync } from "./renderer/use-source-sync";
import { readerClient } from "./renderer/reader-client";
import { toggleSelection } from "./renderer/selection-model.mjs";
import {
  commandBinding,
  formatShortcut,
  resolveShortcut,
  shortcutConflict,
  shortcutStroke,
  tagTogglePlan,
} from "./renderer/keyboard-shortcuts.mjs";
import "lxgw-wenkai-webfont/style.css";
import "./renderer.css";
import "./renderer/theme.css";

const TIERS = [
  { key: "inbox", label: "收件箱", icon: Inbox },
  { key: "short", label: "短期", icon: Bookmark },
  { key: "medium", label: "中期", icon: Columns3 },
  { key: "long", label: "长期", icon: Star },
  { key: "archived", label: "已归档", icon: Archive },
] as const;
const TIER_LABEL: Record<string, string> = Object.fromEntries(
  TIERS.map(({ key, label }) => [key, label]),
);
const EN_TIER_LABEL: Record<string, string> = {
  inbox: "Inbox",
  short: "Short term",
  medium: "Medium term",
  long: "Long term",
  archived: "Archived",
};
const DEFAULT_PREFS: ReaderPreferences = {
  locale: "zh-CN",
  theme: "system",
  fontFamily: "wenkai",
  fontSize: 20,
  lineHeight: 1.75,
  paragraphSpacing: 0.8,
  contentWidth: 760,
  pageMargin: 48,
  listView: "list",
  sidebarCollapsed: false,
  tocHidden: false,
  infoHidden: false,
  rightTab: "body",
  navWidth: 220,
  listWidth: 440,
  tocWidth: 250,
  infoWidth: 330,
  remoteCleanupOnDelete: false,
  characterShortcutsEnabled: true,
  shortcutBindings: {},
  quickTagSlots: {},
};

function formatDate(value?: string | null, long = false) {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "未知"
    : new Intl.DateTimeFormat(
        "zh-CN",
        long
          ? { year: "numeric", month: "long", day: "numeric" }
          : { month: "short", day: "numeric" },
      ).format(date);
}

function isEditing(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

type TocItem = {
  index: number;
  level: number;
  title: string;
  children: TocItem[];
};

type RemoteRemovalState = "idle" | "loading" | "success" | "partial" | "error";
type DocumentMenuState = {
  ids: string[];
  x: number;
  y: number;
  mode: "main" | "tier" | "tags";
};
type SettingsSection = "general" | "shortcuts" | "data" | "about";

function buildToc(items: Array<Omit<TocItem, "children">>) {
  const roots: TocItem[] = [];
  const stack: TocItem[] = [];
  for (const source of items) {
    const item = { ...source, children: [] };
    while (stack.length && stack.at(-1)!.level >= item.level) stack.pop();
    if (stack.length) stack.at(-1)!.children.push(item);
    else roots.push(item);
    stack.push(item);
  }
  return roots;
}

function syncFailure(item: SyncItem) {
  const stage =
    (
      {
        document_detail: "正文详情",
        media_localization: "媒体本地化",
        database_write: "数据库写入",
        collection_link: "来源关联",
      } as Record<string, string>
    )[item.failureStage ?? ""] ?? item.failureStage;
  return [
    item.failureType ?? "unknown",
    item.httpStatus ? `HTTP ${item.httpStatus}` : "",
    stage ?? "",
    item.failureCode ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function App() {
  const [workspace, setWorkspace] = useState<
    "library" | "annotations" | "settings"
  >("library");
  const [filter, setFilter] = useState("inbox");
  const [query, setQuery] = useState("");
  const [documents, setDocuments] = useState<ReaderListItem[]>([]);
  const [allTags, setAllTags] = useState<ReaderTag[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reader, setReader] = useState<ReaderDocument | null>(null);
  const [rightTab, setRightTab] = useState<"body" | "properties">("body");
  const [detailTab, setDetailTab] = useState<"info" | "notes">("info");
  const [expanded, setExpanded] = useState(false);
  const [tocHidden, setTocHidden] = useState(false);
  const [infoHidden, setInfoHidden] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [preferences, setPreferences] =
    useState<ReaderPreferences>(DEFAULT_PREFS);
  const [importOpen, setImportOpen] = useState(false);
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [commandOverlay, setCommandOverlay] = useState<
    "commands" | "shortcuts" | null
  >(null);
  const [readerToolbarOpen, setReaderToolbarOpen] = useState<
    "type" | "tier" | "tags" | null
  >(null);
  const [shortcutPrefix, setShortcutPrefix] = useState("");
  const [shortcutOptions, setShortcutOptions] = useState<
    Array<{ id: string; title: string; binding: string }>
  >([]);
  const [accountState, setAccountState] = useState<boolean | null>(null);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [publicUrl, setPublicUrl] = useState("");
  const [removeRemote, setRemoveRemote] = useState(false);
  const [status, setStatus] = useState("正在打开本地知识库…");
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<SelectionAnchor | null>(null);
  const [activeHighlightIds, setActiveHighlightIds] = useState<string[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [remoteRemovalState, setRemoteRemovalState] =
    useState<RemoteRemovalState>("idle");
  const [documentMenu, setDocumentMenu] = useState<DocumentMenuState | null>(null);
  const [annotations, setAnnotations] = useState<ReaderAnnotationListItem[]>([]);
  const [annotationQuery, setAnnotationQuery] = useState("");
  const [annotationKind, setAnnotationKind] = useState<
    "all" | "highlight" | "note"
  >("all");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(
    null,
  );
  const [settingsSection, setSettingsSection] = useState<
    SettingsSection
  >("general");
  const [appInfo, setAppInfo] = useState<{
    version: string;
    packaged: boolean;
    updateConfigured: boolean;
  } | null>(null);
  const [updateStatus, setUpdateStatus] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const appRef = useRef<HTMLElement>(null);
  const readerPaneRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const syncPanelRef = useRef<HTMLDivElement>(null);
  const commandsRef = useRef<AppCommand[]>([]);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listScroll = useRef(0);
  const lastProgress = useRef("");
  const selectionAnchorId = useRef<string | null>(null);
  const preferencesLoaded = useRef(false);
  const preferenceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingPreferences = useRef<Partial<ReaderPreferences>>({});
  const pendingAnnotationText = useRef<string | null>(null);
  const shortcutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceSync = useSourceSync();

  const loadAnnotations = useCallback(async () => {
    const result = await readerClient.listReaderAnnotations({
      query: annotationQuery,
      kind: annotationKind,
    });
    if (!result.ok) {
      setStatus(`读取标注失败：${result.error ?? "database_error"}`);
      return;
    }
    const next = result.annotations ?? [];
    setAnnotations(next);
    setSelectedAnnotationId((current) =>
      current && next.some((item) => item.id === current)
        ? current
        : (next[0]?.id ?? null),
    );
  }, [annotationKind, annotationQuery]);

  useEffect(() => setRemoteRemovalState("idle"), [reader?.id]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("smoke") !== "1")
      return;
    void (async () => {
      const ping = await window.desktop.ping();
      if (!ping.ok || !ping.database.ok) return;
      const bootstrap = await readerClient.readerBootstrap({ limit: 1 });
      const first = bootstrap.documents?.[0];
      const loaded = first
        ? (await readerClient.getReaderDocument(first.id)).ok
        : true;
      const controlsAreClickable = () => {
        const closeButton = document.querySelector<HTMLElement>(
          ".window-controls .close",
        );
        const rect = closeButton?.getBoundingClientRect();
        const hit = rect
          ? document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            )
          : null;
        return Boolean(closeButton && hit && closeButton.contains(hit));
      };
      const libraryControls = controlsAreClickable();
      setExpanded(true);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const detailControls = controlsAreClickable();
      const firstMaximize = await window.desktop.toggleMaximizeAppWindow();
      const secondMaximize = await window.desktop.toggleMaximizeAppWindow();
      const windowControls = Boolean(
        firstMaximize.maximized &&
          !secondMaximize.maximized &&
          libraryControls &&
          detailControls,
      );
      await window.desktop.smokeReady({
        hasDocuments: Boolean(first),
        readerLoaded: loaded,
        windowControls,
      });
    })();
  }, []);

  const loadList = useCallback(
    async (preferred?: string | null, quiet = false) => {
      if (!quiet) setLoading(true);
      const result = await readerClient.readerBootstrap({
        filter,
        query,
        sort: "updated",
        limit: 10000,
      });
      if (!result.ok) {
        setStatus(`读取失败：${result.error ?? "database_error"}`);
        setDocuments([]);
        setLoading(false);
        return;
      }
      const next = result.documents ?? [];
      setDocuments(next);
      setAllTags(result.tags ?? []);
      setSelectedId((current) =>
        current && next.some((item) => item.id === current)
          ? current
          : preferred && next.some((item) => item.id === preferred)
            ? preferred
            : (next.find(
                (item) => item.id === result.session?.selectedDocumentId,
              )?.id ??
              next[0]?.id ??
              null),
      );
      setStatus(`${next.length} 篇本地内容`);
      if (!quiet) setLoading(false);
    },
    [filter, query],
  );

  const loadReader = useCallback(async (id: string) => {
    const result = await readerClient.getReaderDocument(id);
    if (result.ok && result.document) {
      startTransition(() => setReader(result.document!));
      void readerClient.saveReaderSession(id);
    } else {
      setReader(null);
      setStatus(`正文不可用：${result.error ?? "document_not_found"}`);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadList(), 120);
    return () => clearTimeout(timer);
  }, [loadList]);
  useEffect(() => {
    if (workspace !== "annotations") return;
    const timer = setTimeout(() => void loadAnnotations(), 100);
    return () => clearTimeout(timer);
  }, [loadAnnotations, workspace]);
  useEffect(() => {
    if (workspace !== "settings") return;
    void window.desktop.getAppInfo().then((result) => {
      if (result.ok) setAppInfo(result);
    });
  }, [workspace]);
  useEffect(() => {
    if (selectedId) void loadReader(selectedId);
    else setReader(null);
  }, [loadReader, selectedId]);
  useEffect(() => {
    void readerClient.getReaderPreferences().then((result) => {
      if (!result.preferences) return;
      setPreferences(result.preferences);
      setSidebarCollapsed(Boolean(result.preferences.sidebarCollapsed));
      setTocHidden(Boolean(result.preferences.tocHidden));
      setInfoHidden(Boolean(result.preferences.infoHidden));
      setRightTab(
        result.preferences.rightTab === "properties" ? "properties" : "body",
      );
      preferencesLoaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (preferencesLoaded.current)
      void savePreferences({
        sidebarCollapsed,
        tocHidden,
        infoHidden,
        rightTab,
      });
  }, [sidebarCollapsed, tocHidden, infoHidden, rightTab]);
  useEffect(() => {
    if (!expanded && listRef.current)
      listRef.current.scrollTop = listScroll.current;
  }, [expanded]);
  useEffect(() => {
    const text = pendingAnnotationText.current;
    if (!expanded || !reader || !text) return;
    pendingAnnotationText.current = null;
    requestAnimationFrame(() => jumpToText(bodyRef.current, text));
  }, [expanded, reader?.id]);
  useEffect(() => {
    const progress = sourceSync.progress;
    if (!sourceSync.job?.id || !progress) return;
    const key = `${sourceSync.job.id}:${progress.completed}:${progress.skipped}`;
    if (lastProgress.current === key) return;
    lastProgress.current = key;
    if (progress.completed || progress.skipped) void loadList(undefined, true);
  }, [loadList, sourceSync.job?.id, sourceSync.progress]);
  useEffect(() => {
    if (
      !sourceSync.job ||
      !["completed", "stopped", "cancelled", "failed"].includes(
        sourceSync.job.status,
      )
    )
      return;
    void loadList();
  }, [loadList, sourceSync.job?.status]);
  useEffect(() => {
    setSelection(null);
    setActiveHighlightIds([]);
    setActiveNoteId(null);
    setNoteBody("");
    setNoteOpen(false);
  }, [selectedId]);
  useEffect(() => {
    setSelectedIds(new Set());
    selectionAnchorId.current = null;
  }, [filter]);
  useEffect(() => {
    if (!syncPanelOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (
        syncPanelRef.current?.contains(target) ||
        target.closest("[data-sync-toggle]")
      )
        return;
      setSyncPanelOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [syncPanelOpen]);

  function saveState(input: {
    tier?: string;
    favorite?: boolean;
    scrollTop?: number;
  }) {
    if (!reader) return;
    void readerClient
      .saveReadingState({ documentId: reader.id, ...input })
      .then((result) => {
        if (!result.ok || !result.state)
          return setStatus(`保存失败：${result.error ?? "unknown"}`);
        setReader((current) =>
          current?.id === reader.id
            ? {
                ...current,
                tier: result.state!.tier as ReaderDocument["tier"],
                favorite: result.state!.favorite,
                scrollTop: result.state!.scrollTop,
              }
            : current,
        );
        setDocuments((current) =>
          current.map((item) =>
            item.id === reader.id
              ? {
                  ...item,
                  tier: result.state!.tier as ReaderListItem["tier"],
                  favorite: result.state!.favorite,
                }
              : item,
          ),
        );
      });
  }

  function onScroll() {
    if (!reader || !readerPaneRef.current) return;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    const scrollTop = readerPaneRef.current.scrollTop;
    const documentId = reader.id;
    scrollTimer.current = setTimeout(
      () => void readerClient.saveReadingState({ documentId, scrollTop }),
      500,
    );
  }

  function refreshReader() {
    if (reader) void loadReader(reader.id);
  }
  function addHighlight(color: string) {
    if (!reader || !selection) return;
    if (activeHighlightIds.length) {
      void Promise.all(
        activeHighlightIds.map((id) =>
          readerClient.updateHighlight(id, { color }),
        ),
      ).then((results) => {
        if (results.some((result) => !result.ok))
          return setStatus("高亮颜色修改失败");
        setReader((current) =>
          current
            ? {
                ...current,
                highlights: current.highlights.map((item) =>
                  activeHighlightIds.includes(item.id)
                    ? { ...item, color }
                    : item,
                ),
              }
            : current,
        );
        setSelection(null);
        setActiveHighlightIds([]);
      });
      return;
    }
    void readerClient
      .createHighlight({
        documentId: reader.id,
        documentVersionId: reader.versionId,
        ...selection,
        color,
      })
      .then(() => {
        setSelection(null);
        setActiveHighlightIds([]);
        refreshReader();
      });
  }
  function deleteActiveHighlights() {
    if (!activeHighlightIds.length) return;
    const ids = [...activeHighlightIds];
    void Promise.all(ids.map((id) => readerClient.deleteHighlight(id))).then(
      (results) => {
        if (results.some((result) => !result.ok))
          return setStatus("删除高亮失败");
        setReader((current) =>
          current
            ? {
                ...current,
                highlights: current.highlights.filter(
                  (item) => !ids.includes(item.id),
                ),
              }
            : current,
        );
        setSelection(null);
        setActiveHighlightIds([]);
      },
    );
  }
  function saveNote() {
    if (!reader || !selection || !noteBody.trim()) return;
    if (activeNoteId) {
      const body = noteBody.trim();
      void readerClient.updateNote(activeNoteId, body).then((result) => {
        if (!result.ok) return setStatus("批注修改失败");
        setReader((current) =>
          current
            ? {
                ...current,
                notes: current.notes.map((item) =>
                  item.id === activeNoteId ? { ...item, body } : item,
                ),
              }
            : current,
        );
        closeAnnotationToolbar();
      });
      return;
    }
    void readerClient
      .createNote({
        documentId: reader.id,
        documentVersionId: reader.versionId,
        ...selection,
        body: noteBody.trim(),
      })
      .then(() => {
        closeAnnotationToolbar();
        refreshReader();
      });
  }
  function deleteActiveNote() {
    if (!activeNoteId) return;
    const id = activeNoteId;
    void readerClient.deleteNote(id).then((result) => {
      if (!result.ok) return setStatus("删除批注失败");
      setReader((current) =>
        current
          ? {
              ...current,
              notes: current.notes.filter((item) => item.id !== id),
            }
          : current,
      );
      closeAnnotationToolbar();
    });
  }
  function closeAnnotationToolbar() {
    setSelection(null);
    setActiveHighlightIds([]);
    setActiveNoteId(null);
    setNoteBody("");
    setNoteOpen(false);
  }
  async function addReaderTag(name: string) {
    if (!reader || !name.trim()) return false;
    const result = await readerClient.addDocumentTag(reader.id, name.trim());
    if (!result.ok || !result.tag) {
      setStatus(`添加标签失败：${result.error ?? "unknown"}`);
      return false;
    }
    setReader((current) =>
      current?.id === reader.id &&
      !current.tags.some((tag) => tag.id === result.tag!.id)
        ? { ...current, tags: [...current.tags, result.tag!] }
        : current,
    );
    setDocuments((current) =>
      current.map((item) =>
        item.id === reader.id && !item.tagNames.includes(result.tag!.name)
          ? { ...item, tagNames: [...item.tagNames, result.tag!.name] }
          : item,
      ),
    );
    void loadList(reader.id, true);
    return true;
  }
  function addTag() {
    void addReaderTag(tagDraft).then((ok) => ok && setTagDraft(""));
  }
  async function removeReaderTag(tagId: string) {
    if (!reader) return;
    const removed = reader.tags.find((tag) => tag.id === tagId);
    const result = await readerClient.removeDocumentTag(reader.id, tagId);
    if (!result.ok)
      return setStatus(`移除标签失败：${result.error ?? "unknown"}`);
    setReader((current) =>
      current?.id === reader.id
        ? { ...current, tags: current.tags.filter((tag) => tag.id !== tagId) }
        : current,
    );
    if (removed)
      setDocuments((current) =>
        current.map((item) =>
          item.id === reader.id
            ? {
                ...item,
                tagNames: item.tagNames.filter((name) => name !== removed.name),
              }
            : item,
        ),
      );
    void loadList(reader.id, true);
  }
  async function trashDocuments(ids: string[]) {
    const results = await Promise.all(ids.map((id) => readerClient.trashDocument(id)));
    const removed = ids.filter((_, index) => results[index].ok);
    removeVisibleDocuments(removed);
    if (removed.length !== ids.length)
      setStatus(`${ids.length - removed.length} 篇移入废纸篓失败`);
  }
  async function trash(id: string) {
    await trashDocuments([id]);
  }
  async function restoreDocuments(ids: string[]) {
    const results = await Promise.all(ids.map((id) => readerClient.restoreDocument(id)));
    removeVisibleDocuments(ids.filter((_, index) => results[index].ok));
  }
  async function restore(id: string) {
    await restoreDocuments([id]);
  }
  async function deleteDocumentsPermanently(
    ids: string[],
    options: { forceLocal?: boolean; confirmed?: boolean } = {},
  ) {
    const cleanup = preferences.remoteCleanupOnDelete === true && !options.forceLocal;
    const loaded = cleanup
      ? await Promise.all(ids.map((id) => readerClient.getReaderDocument(id)))
      : [];
    const membershipCount = loaded.reduce(
      (count, result) => count + (result.document?.sourceMemberships?.length ?? 0),
      0,
    );
    if (!options.confirmed && !window.confirm(
      cleanup
        ? `永久删除 ${ids.length} 篇本地内容，并先取消 ${membershipCount} 个远程收藏关系？\n\n远程取消失败的内容会继续保留在废纸篓。`
        : `永久删除 ${ids.length} 篇正文、标注、批注和未共享媒体？此操作不可恢复。`,
    )) return { deleted: 0, failed: 0 };

    const deleted: string[] = [];
    let failed = 0;
    for (const [index, id] of ids.entries()) {
      if (cleanup && (!loaded[index]?.ok || !loaded[index]?.document)) {
        failed += 1;
        continue;
      }
      const memberships = loaded[index]?.document?.sourceMemberships ?? [];
      if (cleanup && memberships.length) {
        const remote = await removeRemoteMemberships([id], false);
        if (remote.failed) {
          failed += 1;
          continue;
        }
      }
      const result = await readerClient.deleteDocumentPermanently(id);
      if (result.ok) deleted.push(id);
      else failed += 1;
    }
    removeVisibleDocuments(deleted);
    setStatus(failed
      ? `已永久删除 ${deleted.length} 篇，${failed} 篇因远程或本地操作失败而保留`
      : `已永久删除 ${deleted.length} 篇内容`);
    return { deleted: deleted.length, failed };
  }
  async function permanentDelete(id: string, forceLocal = false) {
    await deleteDocumentsPermanently([id], { forceLocal });
  }

  async function emptyTrash() {
    if (!documents.length) return;
    if (preferences.remoteCleanupOnDelete) {
      await deleteDocumentsPermanently(documents.map((item) => item.id));
      return;
    }
    if (!window.confirm(`永久删除废纸篓中的 ${documents.length} 篇内容？此操作不可恢复。`)) return;
    const result = await readerClient.emptyTrash();
    if (!result.ok) return setStatus(`清空废纸篓失败：${result.error}`);
    removeVisibleDocuments(documents.map((item) => item.id));
    setStatus(`已清空废纸篓，共删除 ${result.deleted ?? documents.length} 篇`);
  }

  function removeVisibleDocuments(ids: string[]) {
    const removed = new Set(ids);
    const currentIndex = documents.findIndex((item) => item.id === selectedId);
    const next = documents.filter((item) => !removed.has(item.id));
    setDocuments(next);
    setSelectedIds(
      (current) => new Set([...current].filter((id) => !removed.has(id))),
    );
    if (selectedId && removed.has(selectedId))
      setSelectedId(
        next[Math.min(Math.max(0, currentIndex), next.length - 1)]?.id ?? null,
      );
  }

  function selectDocument(item: ReaderListItem, event: React.MouseEvent) {
    const index = documents.findIndex((entry) => entry.id === item.id);
    const anchorIndex = documents.findIndex(
      (entry) => entry.id === selectionAnchorId.current,
    );
    if (event.shiftKey && anchorIndex >= 0) {
      const [from, to] = [anchorIndex, index].sort(
        (left, right) => left - right,
      );
      setSelectedIds(
        new Set(documents.slice(from, to + 1).map((entry) => entry.id)),
      );
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedIds((current) =>
        toggleSelection(current, selectedId, item.id),
      );
      selectionAnchorId.current = item.id;
    } else {
      setSelectedIds(new Set());
      selectionAnchorId.current = item.id;
    }
    setSelectedId(item.id);
  }

  function openDocumentMenu(
    item: ReaderListItem,
    event: React.MouseEvent | React.KeyboardEvent,
    mode: DocumentMenuState["mode"] = "main",
  ) {
    event.preventDefault();
    event.stopPropagation();
    const inSelection = selectedIds.has(item.id) && selectedIds.size > 0;
    const ids = inSelection ? [...selectedIds] : [item.id];
    if (!inSelection) {
      setSelectedIds(new Set());
      setSelectedId(item.id);
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setDocumentMenu({
      ids,
      mode,
      x: event.type === "contextmenu" && "clientX" in event ? event.clientX : rect.right,
      y: event.type === "contextmenu" && "clientY" in event ? event.clientY : rect.bottom + 4,
    });
  }

  function openReaderDocumentMenu(
    event: React.MouseEvent,
    mode: DocumentMenuState["mode"] = "main",
  ) {
    if (!reader) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setDocumentMenu({
      ids: [reader.id],
      mode,
      x: event.type === "contextmenu" ? event.clientX : rect.right,
      y: event.type === "contextmenu" ? event.clientY : rect.bottom + 4,
    });
  }

  async function setDocumentsState(
    ids: string[],
    patch: { tier?: string; favorite?: boolean },
  ) {
    await Promise.all(
      ids.map((documentId) =>
        readerClient.saveReadingState({ documentId, ...patch }),
      ),
    );
    setDocuments((current) =>
      current.map((item) =>
        ids.includes(item.id)
          ? {
              ...item,
              ...patch,
              tier: (patch.tier ?? item.tier) as ReaderListItem["tier"],
            }
          : item,
      ),
    );
    if (reader && ids.includes(reader.id))
      setReader({
        ...reader,
        ...patch,
        tier: (patch.tier ?? reader.tier) as ReaderDocument["tier"],
      });
  }

  async function batchState(patch: { tier?: string; favorite?: boolean }) {
    await setDocumentsState([...selectedIds], patch);
  }

  async function addTagToDocuments(ids: string[], name: string) {
    const tagName = name.trim();
    if (!tagName) return false;
    const results = await Promise.all(
      ids.map((id) => readerClient.addDocumentTag(id, tagName)),
    );
    setDocuments((current) =>
      current.map((item) =>
        ids.includes(item.id) && !item.tagNames.includes(tagName)
          ? { ...item, tagNames: [...item.tagNames, tagName] }
          : item,
      ),
    );
    if (reader && ids.includes(reader.id)) refreshReader();
    void loadList(reader?.id, true);
    if (results.some((result) => !result.ok)) {
      setStatus("部分文档添加标签失败");
      return false;
    }
    return true;
  }

  async function toggleTagOnDocuments(ids: string[], tag: ReaderTag) {
    const hasTag = (id: string) => {
      const item = documents.find((document) => document.id === id);
      return item?.tagNames.includes(tag.name) ||
        (reader?.id === id && reader.tags.some((current) => current.id === tag.id));
    };
    const { remove, targets } = tagTogglePlan(ids, ids.filter(hasTag));
    const results = await Promise.all(
      targets.map((id) =>
        remove
          ? readerClient.removeDocumentTag(id, tag.id)
          : readerClient.addDocumentTag(id, tag.name),
      ),
    );
    const changed = targets.filter((_, index) => results[index].ok);
    setDocuments((current) =>
      current.map((item) =>
        changed.includes(item.id)
          ? {
              ...item,
              tagNames: remove
                ? item.tagNames.filter((name) => name !== tag.name)
                : [...new Set([...item.tagNames, tag.name])],
            }
          : item,
      ),
    );
    if (reader && changed.includes(reader.id))
      setReader({
        ...reader,
        tags: remove
          ? reader.tags.filter((current) => current.id !== tag.id)
          : [...reader.tags, tag],
      });
    void loadList(reader?.id, true);
    if (changed.length !== targets.length)
      setStatus(`部分文档${remove ? "移除" : "添加"}标签失败`);
  }

  async function batchAddTag() {
    const name = window.prompt("为选中文档添加标签")?.trim();
    if (!name) return;
    const ids = [...selectedIds];
    await addTagToDocuments(ids, name);
  }

  async function editDocumentTags(item: ReaderListItem, tags: string[]) {
    const result = await readerClient.updateDocumentProperties({
      documentId: item.id,
      tags,
    });
    if (!result.ok) {
      setStatus(`更新标签失败：${result.error ?? "unknown"}`);
      return false;
    }
    setDocuments((current) =>
      current.map((document) =>
        document.id === item.id ? { ...document, tagNames: tags } : document,
      ),
    );
    void loadList(item.id, true);
    if (reader?.id === item.id) refreshReader();
    return true;
  }

  async function batchRemove(action: "trash" | "restore" | "delete") {
    const ids = [...selectedIds];
    if (action === "trash") await trashDocuments(ids);
    else if (action === "restore") await restoreDocuments(ids);
    else await deleteDocumentsPermanently(ids);
  }

  function savePreferences(patch: Partial<ReaderPreferences>) {
    setPreferences((current) => ({ ...current, ...patch }));
    pendingPreferences.current = { ...pendingPreferences.current, ...patch };
    if (preferenceSaveTimer.current) clearTimeout(preferenceSaveTimer.current);
    preferenceSaveTimer.current = setTimeout(() => {
      const pending = pendingPreferences.current;
      pendingPreferences.current = {};
      void readerClient.saveReaderPreferences(pending).then((result) => {
        if (
          result.preferences &&
          !Object.keys(pendingPreferences.current).length
        )
          setPreferences(result.preferences);
      });
    }, 180);
  }

  async function openImport() {
    setImportOpen(true);
    const state = await window.desktop.getSourceAccountState("zhihu");
    setAccountState(state.state?.authenticated ?? null);
    if (state.state?.authenticated) {
      const result = await window.desktop.discoverSources("zhihu");
      if (result.sources) {
        setSources(result.sources);
        setSelectedSources(result.sources.map((source) => source.url));
      }
    }
  }
  async function addPublicSource() {
    const result = await window.desktop.resolvePublicSource(
      "zhihu",
      publicUrl.trim(),
    );
    if (!result.source) return setStatus("仅支持公开知乎收藏夹或专栏 URL");
    setSources((current) =>
      current.some((source) => source.url === result.source!.url)
        ? current
        : [...current, result.source!],
    );
    setSelectedSources((current) => [
      ...new Set([...current, result.source!.url]),
    ]);
    setPublicUrl("");
  }
  async function startSync(mode: "incremental" | "full") {
    if (!selectedSources.length) return setStatus("请至少选择一个来源");
    if (
      mode === "full" &&
      !window.confirm("全量同步会重新下载全部正文与媒体，继续？")
    )
      return;
    const writableUrls = new Set(
      sources.filter((source) => source.writable).map((source) => source.url),
    );
    const canRemove =
      removeRemote && selectedSources.every((url) => writableUrls.has(url));
    if (removeRemote && !canRemove)
      return setStatus("取消远程收藏仅支持当前账号拥有的收藏夹");
    const result = await sourceSync.startBatch(
      selectedSources,
      mode,
      canRemove,
    );
    if (result.job) {
      setImportOpen(false);
      setStatus("同步已转入后台");
    } else setStatus(`同步未开始：${result.error}`);
  }
  async function removeRemoteMemberships(ids: string[], confirm = true) {
    if (!ids.length) return { completed: 0, failed: 0 };
    if (confirm && !window.confirm(
      `从选中内容所属的全部自有知乎收藏夹中取消收藏？本地正文会保留。\n\n共 ${ids.length} 篇内容。`,
    )) return { completed: 0, failed: 0 };
    setRemoteRemovalState("loading");
    setStatus("正在取消知乎收藏…");
    let completed = 0;
    let failed = 0;
    let firstError = "";
    for (const [index, id] of ids.entries()) {
      if (index) await new Promise((resolve) => setTimeout(resolve, 1200));
      const result = await window.desktop.removeDocumentSourceMemberships(id);
      completed += result.completed ?? 0;
      if (!result.ok) {
        failed += 1;
        firstError ||= result.error ?? result.errors?.[0]?.error ?? "unknown";
      }
      if (reader?.id === id && (result.completed ?? 0) > 0) {
        const removed = new Set(result.removedSourceIds ?? []);
        setReader((current) => current?.id === id ? {
          ...current,
          sourceMemberships: (current.sourceMemberships ?? []).filter(
            (item) => !removed.has(item.sourceId),
          ),
        } : current);
      }
    }
    if (!failed) {
      setRemoteRemovalState("success");
      setStatus(`已从 ${completed} 个知乎收藏夹取消收藏`);
      return { completed, failed: 0 };
    }
    setRemoteRemovalState(completed ? "partial" : "error");
    const code = firstError;
    const message =
      (
        {
          remote_permission_check_failed: "无法确认收藏夹权限",
          remote_membership_not_writable: "这不是当前账号可修改的收藏夹",
          remote_membership_not_found: "没有可取消的远程收藏关系",
          remote_request_failed: "知乎请求失败",
          local_membership_update_failed: "远程已处理，但本地状态更新失败",
          sync_already_running: "同步进行中，请稍后重试",
        } as Record<string, string>
      )[code] ?? code;
    setStatus(
      completed
        ? `已取消 ${completed} 个，另有 ${failed} 篇失败：${message}`
        : `取消收藏失败：${message}`,
    );
    return { completed, failed };
  }

  async function removeRemoteMembership() {
    if (!reader) return;
    await removeRemoteMemberships([reader.id]);
  }
  async function importFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (!/\.(?:md|markdown|html?|htm)$/i.test(file.name)) continue;
      const kind = /\.html?$/i.test(file.name) ? "html" : "markdown";
      await window.desktop.importDocumentFile({
        name: file.name,
        kind,
        content: await file.text(),
      });
    }
    void loadList();
  }

  async function createBackup() {
    setStatus("正在创建备份…");
    setBackupStatus("正在创建备份…");
    const result = await window.desktop.createDataBackup();
    if (result.cancelled) {
      setStatus("已取消备份");
      setBackupStatus("已取消备份");
      return;
    }
    const message = result.ok
        ? `备份已创建：${result.path}（${result.mediaFiles ?? 0} 个媒体文件）`
        : `备份失败：${result.error ?? "backup_create_failed"}`;
    setStatus(message);
    setBackupStatus(message);
  }

  async function restoreBackup() {
    if (
      !window.confirm(
        "恢复备份会替换当前数据库。恢复前会自动保存数据库安全副本，继续？",
      )
    )
      return;
    setStatus("正在恢复备份…");
    setBackupStatus("正在恢复备份…");
    const result = await window.desktop.restoreDataBackup();
    if (result.cancelled) {
      setStatus("已取消恢复");
      setBackupStatus("已取消恢复");
      return;
    }
    if (!result.ok) {
      const message = `恢复失败：${result.error ?? "backup_restore_failed"}`;
      setStatus(message);
      setBackupStatus(message);
      return;
    }
    window.location.reload();
  }

  async function checkUpdates() {
    setUpdateStatus("正在检查…");
    const result = await window.desktop.checkForUpdates();
    if (!result.ok) {
      setUpdateStatus(
        result.error === "update_not_configured"
          ? "当前构建未配置更新源"
          : "检查更新失败",
      );
      return;
    }
    setUpdateStatus(
      result.updateAvailable
        ? `发现新版本 ${result.latestVersion}`
        : `已是最新版本 ${result.currentVersion}`,
    );
    if (
      result.updateAvailable &&
      result.downloadUrl &&
      window.confirm(`发现新版本 ${result.latestVersion}，打开下载页面？`)
    )
      await window.desktop.openUpdatePage(result.downloadUrl);
  }

  function openAnnotation(item: ReaderAnnotationListItem) {
    pendingAnnotationText.current = item.quote || item.body;
    setWorkspace("library");
    setSelectedId(item.documentId);
    setExpanded(true);
  }

  async function deleteAnnotation(item: ReaderAnnotationListItem) {
    const result =
      item.kind === "highlight"
        ? await readerClient.deleteHighlight(item.id)
        : await readerClient.deleteNote(item.id);
    if (!result.ok) {
      setStatus(`删除${item.kind === "highlight" ? "高亮" : "批注"}失败`);
      return;
    }
    const remaining = annotations.filter((candidate) => candidate.id !== item.id);
    setAnnotations(remaining);
    setSelectedAnnotationId((current) =>
      current === item.id ? (remaining[0]?.id ?? null) : current,
    );
    setStatus(`已删除${item.kind === "highlight" ? "高亮" : "批注"}`);
  }

  const toc = useMemo(() => {
    if (!reader) return [];
    const doc = new DOMParser().parseFromString(reader.body, "text/html");
    return buildToc(
      Array.from(doc.querySelectorAll("h1,h2,h3")).map((node, index) => ({
        index,
        level: Number(node.tagName[1]),
        title: node.textContent?.trim() || `章节 ${index + 1}`,
      })),
    );
  }, [reader?.body]);
  const font =
    preferences.fontFamily === "custom"
      ? "ReaderCustom"
      : preferences.fontFamily === "serif"
        ? "SimSun, STSong, serif"
        : preferences.fontFamily === "sans"
          ? "Microsoft YaHei, system-ui, sans-serif"
          : "LXGW WenKai, serif";
  const readerStyle = {
    "--reader-font": font,
    "--reader-size": `${preferences.fontSize}px`,
    "--reader-line": String(preferences.lineHeight),
    "--reader-paragraph": `${preferences.paragraphSpacing}em`,
    "--reader-width": `${preferences.contentWidth}px`,
    "--reader-margin": `${preferences.pageMargin}px`,
    "--nav-width": `${preferences.navWidth ?? 220}px`,
    "--list-width": `${preferences.listWidth ?? 440}px`,
    "--toc-width": `${preferences.tocWidth ?? 250}px`,
    "--info-width": `${preferences.infoWidth ?? 330}px`,
  } as React.CSSProperties;
  const filterLabel =
    filter === "trash"
      ? preferences.locale === "en-US" ? "Trash" : "废纸篓"
      : filter.startsWith("tag:")
        ? (allTags.find((tag) => `tag:${tag.id}` === filter)?.name ?? "标签")
        : ((preferences.locale === "en-US" ? EN_TIER_LABEL : TIER_LABEL)[filter] ?? "Library");
  const english = preferences.locale === "en-US";
  const selectedAnnotation =
    annotations.find((item) => item.id === selectedAnnotationId) ?? null;

  function resize(
    key: "navWidth" | "listWidth" | "tocWidth" | "infoWidth",
    direction: 1 | -1,
    event: React.PointerEvent,
  ) {
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
    const start = event.clientX;
    const initial = Number(
      preferences[key] ??
        { navWidth: 220, listWidth: 440, tocWidth: 250, infoWidth: 330 }[key],
    );
    const limits =
      key === "navWidth"
        ? [170, 360]
        : key === "listWidth"
          ? [300, 760]
          : key === "tocWidth"
            ? [180, 420]
            : [300, 520];
    const variable = `--${key.replace("Width", "-width")}`;
    const move = (next: PointerEvent) =>
      appRef.current?.style.setProperty(
        variable,
        `${Math.max(limits[0], Math.min(limits[1], initial + (next.clientX - start) * direction))}px`,
      );
    const up = (next: PointerEvent) => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.body.classList.remove("is-resizing");
      const value = Math.max(
        limits[0],
        Math.min(limits[1], initial + (next.clientX - start) * direction),
      );
      void savePreferences({ [key]: value });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up, { once: true });
  }

  function selectRelative(direction: -1 | 1) {
    const index = selectedId
      ? documents.findIndex((item) => item.id === selectedId)
      : -1;
    const next = Math.max(
      0,
      Math.min(documents.length - 1, index + direction),
    );
    setSelectedId(documents[next]?.id ?? null);
  }

  function toggleTagEditor() {
    if (!reader) return;
    if (expanded) {
      setReaderToolbarOpen((current) => (current === "tags" ? null : "tags"));
      return;
    }
    if (rightTab === "properties") {
      setRightTab("body");
      requestAnimationFrame(() => readerPaneRef.current?.focus());
    } else {
      setRightTab("properties");
      requestAnimationFrame(() => tagInputRef.current?.focus());
    }
  }

  function scrollReader(direction: -1 | 1, page = false) {
    const pane = readerPaneRef.current;
    if (!pane) return;
    pane.scrollBy({
      top: direction * (page ? pane.clientHeight * 0.85 : 72),
      behavior: "smooth",
    });
  }

  function activeDocumentIds() {
    return selectedIds.size
      ? [...selectedIds]
      : reader
        ? [reader.id]
        : [];
  }

  const commandDefinitions: AppCommand[] = [
    {
      id: "command-palette",
      title: "打开命令面板",
      category: "全局",
      defaultBinding: "Mod+k",
      contexts: ["global"],
      palette: false,
      run: () => setCommandOverlay("commands"),
    },
    {
      id: "shortcut-help",
      title: "查看快捷键",
      category: "全局",
      defaultBinding: "?",
      contexts: ["global"],
      palette: false,
      run: () => setCommandOverlay("shortcuts"),
    },
    {
      id: "search",
      title: "搜索本地知识",
      category: "全局",
      defaultBinding: "/",
      contexts: ["global"],
      keywords: ["查找"],
      run: () => searchRef.current?.focus(),
    },
    {
      id: "import",
      title: "导入与来源同步",
      category: "全局",
      keywords: ["知乎", "文件", "同步"],
      run: () => void openImport(),
    },
    {
      id: "sync-center",
      title: "打开同步中心",
      category: "全局",
      keywords: ["进度", "任务"],
      run: () => setSyncPanelOpen(true),
    },
    {
      id: "annotations",
      title: "查看全部标注与高亮",
      category: "全局",
      keywords: ["笔记", "批注"],
      run: () => setWorkspace("annotations"),
    },
    {
      id: "settings",
      title: "打开设置",
      category: "全局",
      run: () => setWorkspace("settings"),
    },
    {
      id: "library-next-document",
      title: "选择下一篇",
      category: "Library",
      defaultBinding: "Down",
      contexts: ["library"],
      disabledReason: documents.length ? undefined : "没有可选择的文档",
      run: () => selectRelative(1),
    },
    {
      id: "library-previous-document",
      title: "选择上一篇",
      category: "Library",
      defaultBinding: "Up",
      contexts: ["library"],
      disabledReason: documents.length ? undefined : "没有可选择的文档",
      run: () => selectRelative(-1),
    },
    {
      id: "reader-next-document",
      title: "下一篇",
      category: "阅读器",
      defaultBinding: "Right",
      contexts: ["reader"],
      disabledReason: documents.length ? undefined : "没有可选择的文档",
      run: () => selectRelative(1),
    },
    {
      id: "reader-previous-document",
      title: "上一篇",
      category: "阅读器",
      defaultBinding: "Left",
      contexts: ["reader"],
      disabledReason: documents.length ? undefined : "没有可选择的文档",
      run: () => selectRelative(-1),
    },
    {
      id: "reader-scroll-down",
      title: "向下滚动",
      category: "阅读器",
      defaultBinding: "Down",
      contexts: ["reader"],
      run: () => scrollReader(1),
    },
    {
      id: "reader-scroll-up",
      title: "向上滚动",
      category: "阅读器",
      defaultBinding: "Up",
      contexts: ["reader"],
      run: () => scrollReader(-1),
    },
    {
      id: "reader-page-down",
      title: "向下翻页",
      category: "阅读器",
      defaultBinding: "PageDown",
      contexts: ["reader"],
      run: () => scrollReader(1, true),
    },
    {
      id: "reader-page-up",
      title: "向上翻页",
      category: "阅读器",
      defaultBinding: "PageUp",
      contexts: ["reader"],
      run: () => scrollReader(-1, true),
    },
    {
      id: "open-reader",
      title: "展开阅读",
      category: "阅读器",
      defaultBinding: "Enter",
      contexts: ["library"],
      disabledReason: reader ? undefined : "请先选择文档",
      run: () => setExpanded(true),
    },
    {
      id: "close-reader",
      title: "退出展开阅读",
      category: "阅读器",
      defaultBinding: "Esc",
      contexts: ["reader"],
      run: () => setExpanded(false),
    },
    {
      id: "favorite",
      title: reader?.favorite ? "取消收藏" : "收藏文档",
      category: "文档",
      defaultBinding: "f",
      contexts: ["library", "reader"],
      disabledReason: reader ? undefined : "请先选择文档",
      run: () => reader && saveState({ favorite: !reader.favorite }),
    },
    {
      id: "tags",
      title: "编辑标签",
      category: "文档",
      defaultBinding: "t",
      contexts: ["library", "reader"],
      disabledReason: reader ? undefined : "请先选择文档",
      run: toggleTagEditor,
    },
    ...TIERS.map(({ key, label }, index) => ({
      id: `tier-${key}`,
      title: `移到${label}`,
      category: "文档",
      defaultBinding: `c ${index === 0 ? 0 : index}`,
      contexts: ["library", "reader"] as Array<"library" | "reader">,
      keywords: ["层级", "分类"],
      disabledReason: reader || selectedIds.size ? undefined : "请先选择文档",
      run: () => void setDocumentsState(activeDocumentIds(), { tier: key }),
    })),
    ...Array.from({ length: 9 }, (_, index) => {
      const slot = String(index + 1);
      const tagId = preferences.quickTagSlots?.[slot];
      const tag = allTags.find((candidate) => candidate.id === tagId);
      return {
        id: `quick-tag-${slot}`,
        title: tag ? `切换标签 #${tag.name}` : `设置快捷标签 ${slot}`,
        category: "文档",
        defaultBinding: `x ${slot}`,
        contexts: ["library", "reader"] as Array<"library" | "reader">,
        keywords: ["标签", "快捷标签"],
        disabledReason: reader || selectedIds.size ? undefined : "请先选择文档",
        run: () => {
          if (tag) void toggleTagOnDocuments(activeDocumentIds(), tag);
          else {
            setWorkspace("settings");
            setSettingsSection("shortcuts");
            setStatus(`请先为 X ${slot} 选择一个标签`);
          }
        },
      };
    }),
    {
      id: "open-original",
      title: "打开原文",
      category: "文档",
      defaultBinding: "o",
      contexts: ["library", "reader"],
      disabledReason: reader?.url ? undefined : "当前文档没有来源链接",
      run: () => reader?.url && void window.desktop.openZhihuUrl(reader.url),
    },
    {
      id: "delete",
      title: filter === "trash" ? "永久删除" : "移到废纸篓",
      category: "文档",
      defaultBinding: "d",
      contexts: ["library", "reader"],
      disabledReason: reader || selectedIds.size ? undefined : "请先选择文档",
      run: () => {
        if (selectedIds.size)
          void batchRemove(filter === "trash" ? "delete" : "trash");
        else if (reader)
          void (filter === "trash" ? permanentDelete(reader.id) : trash(reader.id));
      },
    },
    {
      id: "highlight",
      title: "高亮选区",
      category: "标注",
      defaultBinding: "h",
      contexts: ["library", "reader"],
      disabledReason: selection ? undefined : "请先选择正文",
      run: () => selection && addHighlight("yellow"),
    },
    {
      id: "note",
      title: "高亮并批注",
      category: "标注",
      defaultBinding: "n",
      contexts: ["library", "reader"],
      disabledReason: selection ? undefined : "请先选择正文",
      run: () => selection && setNoteOpen(true),
    },
    {
      id: "toggle-toc",
      title: tocHidden ? "显示目录栏" : "隐藏目录栏",
      category: "阅读器",
      defaultBinding: "[",
      contexts: ["reader"],
      disabledReason: expanded ? undefined : "仅在展开阅读中可用",
      run: () => setTocHidden((value) => !value),
    },
    {
      id: "toggle-info",
      title: infoHidden ? "显示信息栏" : "隐藏信息栏",
      category: "阅读器",
      defaultBinding: "]",
      contexts: ["reader"],
      disabledReason: expanded ? undefined : "仅在展开阅读中可用",
      run: () => setInfoHidden((value) => !value),
    },
  ];
  const commands = commandDefinitions.map((command) => {
    const binding = command.defaultBinding
      ? commandBinding(
          command as AppCommand & { defaultBinding: string; contexts: string[] },
          preferences.shortcutBindings,
        )
      : "";
    return { ...command, shortcut: binding ? formatShortcut(binding) : undefined };
  });
  commandsRef.current = commands;

  function runCommand(id: string) {
    const command = commandsRef.current.find((candidate) => candidate.id === id);
    if (!command?.disabledReason) command?.run();
  }

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.isComposing) return;
      if (commandOverlay) {
        if (event.key === "Escape") setCommandOverlay(null);
        return;
      }
      if (event.key === "Escape" && readerToolbarOpen) {
        event.preventDefault();
        setReaderToolbarOpen(null);
        return;
      }
      if (isEditing(event.target)) return;
      if (event.key === "Escape" && syncPanelOpen) {
        setSyncPanelOpen(false);
        return;
      }
      const stroke = shortcutStroke(event);
      if (!stroke) return;
      const context = expanded
        ? "reader"
        : workspace === "settings"
          ? "settings"
          : workspace === "annotations"
            ? "annotations"
            : "library";
      const result = resolveShortcut({
        commands: commandsRef.current.filter(
          (command): command is AppCommand & {
            defaultBinding: string;
            contexts: Array<"global" | "library" | "reader" | "settings" | "annotations">;
          } => Boolean(command.defaultBinding && command.contexts),
        ),
        overrides: preferences.shortcutBindings,
        context,
        pending: shortcutPrefix,
        stroke,
        characterShortcuts: preferences.characterShortcutsEnabled !== false,
      });
      if (result.commandId || result.pending) {
        event.preventDefault();
        setShortcutPrefix(result.pending);
        setShortcutOptions(result.options);
        if (shortcutTimer.current) clearTimeout(shortcutTimer.current);
        if (result.pending)
          shortcutTimer.current = setTimeout(() => {
            setShortcutPrefix("");
            setShortcutOptions([]);
          }, 1500);
        if (result.commandId) runCommand(result.commandId);
      } else if (shortcutPrefix) {
        setShortcutPrefix("");
        setShortcutOptions([]);
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [
    commandOverlay,
    expanded,
    preferences.characterShortcutsEnabled,
    preferences.shortcutBindings,
    readerToolbarOpen,
    shortcutPrefix,
    syncPanelOpen,
    workspace,
  ]);

  return (
    <main
      ref={appRef}
      className={`app ${expanded ? "is-expanded" : ""} ${sidebarCollapsed ? "nav-collapsed" : ""}`}
      data-theme={preferences.theme}
      style={readerStyle}
    >
      {preferences.customFontUrl && (
        <style>{`@font-face{font-family:ReaderCustom;src:url("${preferences.customFontUrl}")}`}</style>
      )}
      <AppWindowControls />
      {shortcutPrefix && (
        <div className="shortcut-prefix" role="status" aria-live="polite">
          <b>{formatShortcut(shortcutPrefix)}</b>
          {shortcutOptions.map((option) => (
            <span key={option.id}>
              {formatShortcut(option.binding).replace(`${formatShortcut(shortcutPrefix)}  `, "")}
              <small>{option.title}</small>
            </span>
          ))}
        </div>
      )}
      {expanded && (
        <button
          className="detail-info-toggle"
          aria-label={infoHidden ? "显示信息栏" : "隐藏信息栏"}
          title={infoHidden ? "显示信息栏" : "隐藏信息栏"}
          onClick={() => setInfoHidden((value) => !value)}
        >
          {infoHidden ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
        </button>
      )}
      {!expanded && (
        <header className="titlebar">
          <button
            className="brand-button"
            onClick={() =>
              setSidebarCollapsed((value) => {
                void savePreferences({ sidebarCollapsed: !value });
                return !value;
              })
            }
            aria-label="切换导航"
          >
            <Menu size={18} />
            <b>Reader</b>
          </button>
          <label className="global-search">
            <Search size={15} />
            <input
              ref={searchRef}
              value={workspace === "annotations" ? annotationQuery : query}
              onChange={(event) =>
                workspace === "annotations"
                  ? setAnnotationQuery(event.target.value)
                  : setQuery(event.target.value)
              }
              placeholder={workspace === "annotations"
                ? english ? "Search highlights and notes" : "搜索标注和批注"
                : english ? "Search your library" : "搜索本地知识"}
              disabled={workspace === "settings"}
            />
            <kbd>/</kbd>
          </label>
          <div className="title-actions">
            <button onClick={() => void openImport()}>
              <Plus size={16} />
              {english ? "Import" : "导入"}
            </button>
          </div>
        </header>
      )}

      <section
        className={
          expanded
            ? `detail-layout ${tocHidden ? "toc-hidden" : ""} ${infoHidden ? "info-hidden" : ""}`
            : "library-layout"
        }
      >
        {expanded ? (
          <>
            {!tocHidden && (
              <aside className="toc-pane">
                <header className="toc-header">
                  <button aria-label="返回列表" title="返回列表" onClick={() => setExpanded(false)}>
                    <ArrowLeft size={17} />
                  </button>
                  <button aria-label="隐藏目录" title="隐藏目录" onClick={() => setTocHidden(true)}>
                    <PanelLeftClose size={17} />
                  </button>
                  <strong>目录</strong>
                </header>
                <nav>
                  {toc.length ? (
                    <TocNodes items={toc} bodyRef={bodyRef} />
                  ) : (
                    <small>正文没有标题目录</small>
                  )}
                </nav>
              </aside>
            )}
            {!tocHidden && (
              <ResizeHandle
                onPointerDown={(event) => resize("tocWidth", 1, event)}
              />
            )}
            <ReaderPane
              reader={reader}
              expanded
              paneRef={readerPaneRef}
              bodyRef={bodyRef}
              onScroll={onScroll}
              onSelection={(value) => {
                setSelection(value);
                setActiveHighlightIds([]);
                setActiveNoteId(null);
                setNoteBody("");
                setNoteOpen(false);
              }}
              onHighlightClick={(ids, value) => {
                setActiveHighlightIds(ids);
                setActiveNoteId(null);
                setNoteBody("");
                setSelection(value);
                setNoteOpen(false);
              }}
              onNoteClick={(id, value) => {
                const note = reader?.notes.find((item) => item.id === id);
                if (!note) return;
                setActiveHighlightIds([]);
                setActiveNoteId(id);
                setSelection(value);
                setNoteBody(note.body);
                setNoteOpen(true);
              }}
              onCollapse={() => setExpanded(false)}
              tocHidden={tocHidden}
              onToggleToc={() => {
                setTocHidden((value) => !value);
              }}
              preferences={preferences}
              allTags={allTags}
              savePreferences={savePreferences}
              saveState={saveState}
              addTag={addReaderTag}
              removeTag={removeReaderTag}
              toolbarOpen={readerToolbarOpen}
              setToolbarOpen={setReaderToolbarOpen}
              openActions={openReaderDocumentMenu}
            />
            {!infoHidden && (
              <ResizeHandle
                onPointerDown={(event) => resize("infoWidth", -1, event)}
              />
            )}
            {!infoHidden && (
              <aside className="detail-side">
                <div className="tabs">
                  <button
                    className={detailTab === "info" ? "active" : ""}
                    onClick={() => setDetailTab("info")}
                  >
                    信息
                  </button>
                  <button
                    className={detailTab === "notes" ? "active" : ""}
                    onClick={() => setDetailTab("notes")}
                  >
                    笔记{" "}
                    <span>
                      {(reader?.notes.length ?? 0) +
                        (reader?.highlights.length ?? 0)}
                    </span>
                  </button>
                </div>
                {detailTab === "info" ? (
                  <Properties
                    reader={reader}
                    tagDraft={tagDraft}
                    setTagDraft={setTagDraft}
                    addTag={addTag}
                    removeTag={removeReaderTag}
                    saveState={saveState}
                    sync={() =>
                      reader?.url &&
                      void window.desktop
                        .syncZhihuDocument(reader.url)
                        .then(refreshReader)
                    }
                    trash={() => reader && void trash(reader.id)}
                    removeRemote={removeRemoteMembership}
                    remoteRemovalState={remoteRemovalState}
                    tagInputRef={tagInputRef}
                  />
                ) : (
                  <Notes
                    reader={reader}
                    bodyRef={bodyRef}
                    refresh={refreshReader}
                  />
                )}
              </aside>
            )}
          </>
        ) : (
          <>
            <aside className="nav-pane">
              <div className="nav-section">
                <span>LIBRARY</span>
                {TIERS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    className={
                      workspace === "library" && filter === key ? "active" : ""
                    }
                    title={english ? EN_TIER_LABEL[key] : label}
                    onClick={() => {
                      setWorkspace("library");
                      setFilter(key);
                    }}
                  >
                    <Icon size={17} />
                    <em>{english ? EN_TIER_LABEL[key] : label}</em>
                  </button>
                ))}
              </div>
              <div className="nav-section tags-nav">
                <span>{english ? "TAGS" : "标签"}</span>
                {allTags.map((tag) => (
                  <button
                    key={tag.id}
                    className={
                      workspace === "library" && filter === `tag:${tag.id}`
                        ? "active"
                        : ""
                    }
                    onClick={() => {
                      setWorkspace("library");
                      setFilter(`tag:${tag.id}`);
                    }}
                  >
                    <Tags size={16} />
                    <em>{tag.name}</em>
                    <b>{tag.documentCount}</b>
                  </button>
                ))}
              </div>
              <div className="nav-section knowledge-nav">
                <span>{english ? "KNOWLEDGE" : "知识"}</span>
                <button
                  className={workspace === "annotations" ? "active" : ""}
                  onClick={() => setWorkspace("annotations")}
                >
                  <Highlighter size={17} />
                  <em>{english ? "Annotations" : "标注与高亮"}</em>
                  <b>{annotations.length || ""}</b>
                </button>
              </div>
              {sourceSync.active && (
                <SyncMini
                  sync={sourceSync}
                  open={() => setSyncPanelOpen((value) => !value)}
                />
              )}
              <div className="nav-bottom">
                <button
                  data-sync-toggle
                  className={syncPanelOpen ? "active" : ""}
                  onClick={() => setSyncPanelOpen((value) => !value)}
                  aria-label="同步中心"
                  title="同步中心"
                >
                  <RotateCcw size={17} />
                  <em>{english ? "Sync center" : "同步中心"}</em>
                  {sourceSync.active && <i />}
                </button>
                <button
                  className={
                    workspace === "library" && filter === "trash" ? "active" : ""
                  }
                  onClick={() => {
                    setWorkspace("library");
                    setFilter("trash");
                  }}
                  aria-label="废纸篓"
                  title="废纸篓"
                >
                  <Trash2 size={17} />
                  <em>{english ? "Trash" : "废纸篓"}</em>
                </button>
                <button
                  className={workspace === "settings" ? "active" : ""}
                  onClick={() => setWorkspace("settings")}
                  aria-label="设置"
                  title="设置"
                >
                  <Settings size={17} />
                  <em>{english ? "Settings" : "设置"}</em>
                </button>
              </div>
            </aside>
            <ResizeHandle
              onPointerDown={(event) => resize("navWidth", 1, event)}
            />

            <section className="list-pane">
              {workspace === "library" ? (
                <>
              <div className="list-toolbar">
                <div>
                  <small>LIBRARY</small>
                  <h1>{filterLabel}</h1>
                </div>
                {filter === "trash" ? (
                  <button
                    className="empty-trash-button"
                    onClick={() => void emptyTrash()}
                    disabled={!documents.length}
                  >
                    <Trash2 size={15} />
                    清空废纸篓
                  </button>
                ) : (
                  <div className="view-toggle">
                    <button
                      className={
                        preferences.listView === "list" ? "active" : ""
                      }
                      onClick={() => void savePreferences({ listView: "list" })}
                    >
                      <List size={16} />
                    </button>
                    <button
                      className={
                        preferences.listView === "table" ? "active" : ""
                      }
                      onClick={() =>
                        void savePreferences({ listView: "table" })
                      }
                    >
                      <Table2 size={16} />
                    </button>
                  </div>
                )}
              </div>
              <p className="list-count">
                {documents.length} 篇 · {status}
              </p>
              {selectedIds.size > 0 && (
                <div className="bulk-actions">
                  <b>{selectedIds.size} 项</b>
                  <button
                    onClick={() =>
                      setSelectedIds(new Set(documents.map((item) => item.id)))
                    }
                  >
                    全选
                  </button>
                  <button onClick={() => setSelectedIds(new Set())}>
                    清除
                  </button>
                  {filter === "trash" ? (
                    <>
                      <button
                        onClick={() => void batchRemove("restore")}
                        title="恢复"
                      >
                        <RotateCcw size={15} />
                      </button>
                      <button
                        className="danger"
                        onClick={() => void batchRemove("delete")}
                        title="永久删除"
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => void batchState({ favorite: true })}
                        title="收藏"
                      >
                        <Star size={15} />
                      </button>
                      <button
                        onClick={() => void batchAddTag()}
                        title="添加标签"
                      >
                        <Tags size={15} />
                      </button>
                      <select
                        aria-label="批量设置层级"
                        defaultValue=""
                        onChange={(event) => {
                          if (event.target.value)
                            void batchState({ tier: event.target.value });
                          event.target.value = "";
                        }}
                      >
                        <option value="" disabled>
                          层级
                        </option>
                        {TIERS.map((tier) => (
                          <option key={tier.key} value={tier.key}>
                            {tier.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="danger"
                        onClick={() => void batchRemove("trash")}
                        title="移到废纸篓"
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              )}
              <div
                className={`documents ${preferences.listView}`}
                ref={listRef}
                onScroll={(event) => {
                  listScroll.current = event.currentTarget.scrollTop;
                }}
              >
                {loading ? (
                  <Empty text="正在读取本地知识库…" />
                ) : documents.length ? (
                  filter !== "trash" && preferences.listView === "table" ? (
                    <DocumentTable
                      documents={documents}
                      selectedId={selectedId}
                      selectedIds={selectedIds}
                      select={selectDocument}
                      openMenu={openDocumentMenu}
                      editTags={editDocumentTags}
                      save={(item, patch) => {
                        setReader(
                          reader?.id === item.id
                            ? {
                                ...reader,
                                ...patch,
                                tier: (patch.tier ??
                                  reader.tier) as ReaderDocument["tier"],
                              }
                            : reader,
                        );
                        void readerClient
                          .saveReadingState({ documentId: item.id, ...patch })
                          .then(() => loadList(item.id, true));
                      }}
                    />
                  ) : (
                    documents.map((item) => (
                      <DocumentCard
                        key={item.id}
                        item={item}
                        selected={item.id === selectedId}
                        multiSelected={selectedIds.has(item.id)}
                        onClick={(event) => selectDocument(item, event)}
                        openMenu={(event, mode) =>
                          openDocumentMenu(item, event, mode)
                        }
                        trash={filter === "trash"}
                        restore={() => void restore(item.id)}
                        remove={() => void permanentDelete(item.id)}
                      />
                    ))
                  )
                ) : (
                  <Empty text="这里还没有内容" />
                )}
              </div>
                </>
              ) : workspace === "annotations" ? (
                <AnnotationIndex
                  annotations={annotations}
                  selectedId={selectedAnnotationId}
                  kind={annotationKind}
                  setKind={setAnnotationKind}
                  select={setSelectedAnnotationId}
                  locale={preferences.locale}
                />
              ) : (
                <SettingsNavigation
                  selected={settingsSection}
                  select={setSettingsSection}
                  locale={preferences.locale}
                />
              )}
            </section>
            <ResizeHandle
              onPointerDown={(event) => resize("listWidth", 1, event)}
            />

            <section className="content-pane">
              {workspace === "library" ? (
                <>
              <div className="content-tabs">
                <button
                  className={rightTab === "body" ? "active" : ""}
                  onClick={() => setRightTab("body")}
                >
                  <FileText size={15} />
                  正文
                </button>
                <button
                  className={rightTab === "properties" ? "active" : ""}
                  onClick={() => setRightTab("properties")}
                >
                  <Info size={15} />
                  属性
                </button>
                {rightTab === "body" && reader && (
                  <button
                    className="expand-button"
                    onClick={() => setExpanded(true)}
                  >
                    <Expand size={15} />
                    展开阅读
                  </button>
                )}
              </div>
              {rightTab === "body" ? (
                <ReaderPane
                  reader={reader}
                  paneRef={readerPaneRef}
                  bodyRef={bodyRef}
                  onScroll={onScroll}
                  onSelection={(value) => {
                    setSelection(value);
                    setActiveHighlightIds([]);
                    setActiveNoteId(null);
                    setNoteBody("");
                    setNoteOpen(false);
                  }}
                  onHighlightClick={(ids, value) => {
                    setActiveHighlightIds(ids);
                    setActiveNoteId(null);
                    setNoteBody("");
                    setSelection(value);
                    setNoteOpen(false);
                  }}
                  onNoteClick={(id, value) => {
                    const note = reader?.notes.find((item) => item.id === id);
                    if (!note) return;
                    setActiveHighlightIds([]);
                    setActiveNoteId(id);
                    setSelection(value);
                    setNoteBody(note.body);
                    setNoteOpen(true);
                  }}
                  onCollapse={() => {}}
                  tocHidden={tocHidden}
                  onToggleToc={() => {}}
                  preferences={preferences}
                  allTags={allTags}
                  savePreferences={savePreferences}
                  saveState={saveState}
                  addTag={addReaderTag}
                  removeTag={removeReaderTag}
                  toolbarOpen={readerToolbarOpen}
                  setToolbarOpen={setReaderToolbarOpen}
                  openActions={openReaderDocumentMenu}
                />
              ) : (
                <Properties
                  reader={reader}
                  tagDraft={tagDraft}
                  setTagDraft={setTagDraft}
                  addTag={addTag}
                  removeTag={removeReaderTag}
                  saveState={saveState}
                  sync={() =>
                    reader?.url &&
                    void window.desktop
                      .syncZhihuDocument(reader.url)
                      .then(refreshReader)
                  }
                  trash={() =>
                    reader &&
                    (filter === "trash"
                      ? void permanentDelete(reader.id)
                      : void trash(reader.id))
                  }
                  removeRemote={removeRemoteMembership}
                  remoteRemovalState={remoteRemovalState}
                  tagInputRef={tagInputRef}
                  restore={
                    filter === "trash" && reader
                      ? () => void restore(reader.id)
                      : undefined
                  }
                />
              )}
                </>
              ) : workspace === "annotations" ? (
                <AnnotationDetail
                  item={selectedAnnotation}
                  open={openAnnotation}
                  remove={(item) => void deleteAnnotation(item)}
                />
              ) : (
                <SettingsPage
                  section={settingsSection}
                  preferences={preferences}
                  savePreferences={savePreferences}
                  commands={commands}
                  tags={allTags}
                  appInfo={appInfo}
                  updateStatus={updateStatus}
                  backupStatus={backupStatus}
                  checkUpdates={checkUpdates}
                  createBackup={createBackup}
                  restoreBackup={restoreBackup}
                />
              )}
            </section>
          </>
        )}
      </section>

      {syncPanelOpen && (
        <div className="sync-center-popover" ref={syncPanelRef}>
          <header>
            <b>同步中心</b>
            <button
              onClick={() => setSyncPanelOpen(false)}
              aria-label="关闭同步中心"
              title="关闭"
            >
              <X size={16} />
            </button>
          </header>
          <SyncCenter sync={sourceSync} />
        </div>
      )}
      {commandOverlay && (
        <CommandPalette
          mode={commandOverlay}
          commands={commands}
          close={() => setCommandOverlay(null)}
        />
      )}
      {documentMenu && (
        <DocumentActionsMenu
          menu={documentMenu}
          items={documents.filter((item) => documentMenu.ids.includes(item.id))}
          reader={reader && documentMenu.ids.includes(reader.id) ? reader : null}
          tags={allTags}
          trash={filter === "trash"}
          remoteCleanupOnDelete={preferences.remoteCleanupOnDelete === true}
          close={() => setDocumentMenu(null)}
          setMode={(mode) =>
            setDocumentMenu((current) => current && { ...current, mode })
          }
          setTier={(tier) => void setDocumentsState(documentMenu.ids, { tier })}
          addTag={(name) => void addTagToDocuments(documentMenu.ids, name)}
          removeRemote={() => {
            const eligible = documentMenu.ids.filter((id) => {
              const item = documents.find((document) => document.id === id);
              return (
                item?.source.split(":", 1)[0] === "zhihu" ||
                /^https:\/\/(?:www|zhuanlan)\.zhihu\.com\//.test(item?.url ?? "") ||
                (reader?.id === id && reader.sourceMemberships.length > 0)
              );
            });
            void removeRemoteMemberships(eligible);
          }}
          moveToTrash={() => void trashDocuments(documentMenu.ids)}
          restore={() => void restoreDocuments(documentMenu.ids)}
          permanentlyDelete={(forceLocal) =>
            void deleteDocumentsPermanently(documentMenu.ids, { forceLocal })
          }
          openOriginal={(url) => void window.desktop.openZhihuUrl(url)}
        />
      )}
      {selection && (
        <AnnotationToolbar
          selection={selection}
          noteBody={noteBody}
          noteEditorOpen={noteOpen}
          onHighlight={addHighlight}
          onNoteBody={setNoteBody}
          onToggleNote={() => setNoteOpen((value) => !value)}
          onSaveNote={saveNote}
          onDelete={
            activeNoteId
              ? deleteActiveNote
              : activeHighlightIds.length
                ? deleteActiveHighlights
                : undefined
          }
          deleteLabel={activeNoteId ? "删除批注" : "删除高亮"}
          editingNote={Boolean(activeNoteId)}
          onClose={closeAnnotationToolbar}
        />
      )}
      {importOpen && (
        <Modal title="导入" close={() => setImportOpen(false)}>
          <div className="import-tabs">
            <h3>来源同步</h3>
            <div className="account-row">
              <b>知乎</b>
              <span className={accountState ? "ok" : "warn"}>
                {accountState === true
                  ? "已登录"
                  : accountState === false
                    ? "未登录"
                    : "状态未知"}
              </span>
              <button
                onClick={() =>
                  void window.desktop
                    .loginSource("zhihu")
                    .then(() => setStatus("已打开知乎官方登录窗口"))
                }
              >
                登录
              </button>
              <button onClick={() => void openImport()}>刷新</button>
            </div>
            {sources.length > 0 && (
              <>
                <div className="source-selection-actions">
                  <span>选择收藏夹 / 专栏</span>
                  <button
                    onClick={() =>
                      setSelectedSources(sources.map((source) => source.url))
                    }
                  >
                    全选
                  </button>
                  <button
                    onClick={() =>
                      setSelectedSources((current) =>
                        sources
                          .map((source) => source.url)
                          .filter((url) => !current.includes(url)),
                      )
                    }
                  >
                    反选
                  </button>
                </div>
                <div className="source-options">
                  {sources.map((source) => (
                    <label
                      key={source.url}
                      className={
                        selectedSources.includes(source.url) ? "selected" : ""
                      }
                    >
                      <input
                        type="checkbox"
                        checked={selectedSources.includes(source.url)}
                        onChange={() =>
                          setSelectedSources((current) =>
                            current.includes(source.url)
                              ? current.filter((url) => url !== source.url)
                              : [...current, source.url],
                          )
                        }
                      />
                      <span>
                        <b>{source.name}</b>
                        <small>
                          {source.itemCount != null
                            ? `${source.itemCount} 条`
                            : source.kind === "column"
                              ? "公开专栏"
                              : "公开收藏夹"}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className="public-source">
              <input
                value={publicUrl}
                onChange={(event) => setPublicUrl(event.target.value)}
                placeholder="公开收藏夹或专栏 URL"
              />
              <button onClick={() => void addPublicSource()}>添加</button>
            </div>
            <label className="danger-option">
              <input
                type="checkbox"
                checked={removeRemote}
                onChange={(event) => setRemoveRemote(event.target.checked)}
              />
              同步完成后预览并确认取消远程收藏
            </label>
            <div className="modal-actions">
              <button onClick={() => void startSync("incremental")}>
                增量同步
              </button>
              <button
                className="secondary"
                onClick={() => void startSync("full")}
              >
                全量同步
              </button>
            </div>
            <hr />
            <h3>本地文件</h3>
            <label
              className="drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void importFiles(event.dataTransfer.files);
              }}
            >
              <Upload size={24} />
              <b>拖放 Markdown / HTML</b>
              <small>或点击选择文件</small>
              <input
                type="file"
                multiple
                accept=".md,.markdown,.html,.htm"
                onChange={(event) =>
                  event.target.files && void importFiles(event.target.files)
                }
              />
            </label>
          </div>
        </Modal>
      )}
    </main>
  );
}

function jumpToText(root: HTMLElement | null, text: string) {
  if (!root || !text) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode()))
    if (node.textContent?.includes(text)) {
      node.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
}

function AnnotationIndex({
  annotations,
  selectedId,
  kind,
  setKind,
  select,
  locale,
}: {
  annotations: ReaderAnnotationListItem[];
  selectedId: string | null;
  kind: "all" | "highlight" | "note";
  setKind(value: "all" | "highlight" | "note"): void;
  select(id: string): void;
  locale: ReaderPreferences["locale"];
}) {
  const english = locale === "en-US";
  return (
    <>
      <div className="list-toolbar annotation-list-toolbar">
        <div>
          <small>KNOWLEDGE</small>
          <h1>{english ? "Annotations" : "标注与高亮"}</h1>
        </div>
        <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="all">{english ? "All" : "全部"}</option>
          <option value="highlight">{english ? "Highlights" : "高亮"}</option>
          <option value="note">{english ? "Notes" : "批注"}</option>
        </select>
      </div>
      <p className="list-count">{annotations.length} {english ? "items" : "条"}</p>
      <div className="annotation-index">
        {annotations.map((item) => (
          <button
            key={item.id}
            className={item.id === selectedId ? "selected" : ""}
            onClick={() => select(item.id)}
          >
            <span className={`annotation-kind ${item.kind}`}>
              {item.kind === "highlight" ? <Highlighter size={14} /> : <FileText size={14} />}
              {item.kind === "highlight"
                ? english ? "Highlight" : "高亮"
                : english ? "Note" : "批注"}
            </span>
            <b>{item.documentTitle || "无标题内容"}</b>
            {item.quote && <q>{item.quote}</q>}
            {item.body && <p>{item.body}</p>}
            <small>{formatDate(item.updatedAt)}</small>
          </button>
        ))}
        {!annotations.length && <Empty text={english ? "No annotations yet" : "还没有标注或批注"} />}
      </div>
    </>
  );
}

function AnnotationDetail({
  item,
  open,
  remove,
}: {
  item: ReaderAnnotationListItem | null;
  open(item: ReaderAnnotationListItem): void;
  remove(item: ReaderAnnotationListItem): void;
}) {
  if (!item) return <Empty text="选择一条标注查看详情" />;
  return (
    <div className="annotation-detail">
      <header>
        <span className={`annotation-kind ${item.kind}`}>
          {item.kind === "highlight" ? <Highlighter size={15} /> : <FileText size={15} />}
          {item.kind === "highlight" ? "高亮" : "批注"}
        </span>
        <div className="annotation-detail-actions">
          <button onClick={() => open(item)}>
            <Expand size={15} /> 在正文中打开
          </button>
          <button className="danger" onClick={() => remove(item)}>
            <Trash2 size={15} /> 删除
          </button>
        </div>
      </header>
      <h1>{item.documentTitle || "无标题内容"}</h1>
      {item.quote && (
        <blockquote className={`annotation-quote ${item.color ?? "yellow"}`}>
          {item.quote}
        </blockquote>
      )}
      {item.body && <div className="annotation-note-body">{item.body}</div>}
      <dl>
        <div><dt>状态</dt><dd>{item.status === "resolved" ? "已定位" : "需要修复锚点"}</dd></div>
        <div><dt>创建时间</dt><dd>{formatDate(item.createdAt, true)}</dd></div>
        <div><dt>更新时间</dt><dd>{formatDate(item.updatedAt, true)}</dd></div>
      </dl>
    </div>
  );
}

function SettingsNavigation({
  selected,
  select,
  locale,
}: {
  selected: SettingsSection;
  select(value: SettingsSection): void;
  locale: ReaderPreferences["locale"];
}) {
  const english = locale === "en-US";
  const items = [
    ["general", english ? "General" : "通用", Settings],
    ["shortcuts", english ? "Shortcuts" : "快捷键", Keyboard],
    ["data", english ? "Data & backup" : "数据与备份", Archive],
    ["about", english ? "About & updates" : "关于与更新", Info],
  ] as const;
  return (
    <>
      <div className="list-toolbar"><div><small>READER</small><h1>{english ? "Settings" : "设置"}</h1></div></div>
      <nav className="settings-navigation">
        {items.map(([key, label, Icon]) => (
          <button key={key} className={selected === key ? "selected" : ""} onClick={() => select(key)}>
            <Icon size={17} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

function SettingsPage({
  section,
  preferences,
  savePreferences,
  commands,
  tags,
  appInfo,
  updateStatus,
  backupStatus,
  checkUpdates,
  createBackup,
  restoreBackup,
}: {
  section: SettingsSection;
  preferences: ReaderPreferences;
  savePreferences(patch: Partial<ReaderPreferences>): void;
  commands: AppCommand[];
  tags: ReaderTag[];
  appInfo: { version: string; packaged: boolean; updateConfigured: boolean } | null;
  updateStatus: string;
  backupStatus: string;
  checkUpdates(): void;
  createBackup(): void;
  restoreBackup(): void;
}) {
  const english = preferences.locale === "en-US";
  const copy = (zh: string, en: string) => (english ? en : zh);
  return (
    <div className="settings-page">
      {section === "general" && (
        <>
          <header><small>{copy("通用", "General")}</small><h1>{copy("界面与语言", "Interface & language")}</h1><p>{copy("阅读排版请在正文顶栏的 Aa 菜单中调整。", "Adjust reading typography from the Aa menu in the article toolbar.")}</p></header>
          <section className="settings-card">
            <label>
              <span><b>{copy("界面语言", "Interface language")}</b><small>{copy("更改主要导航和系统页面的显示语言", "Change the language used by navigation and system pages")}</small></span>
              <select
                value={preferences.locale}
                onChange={(event) => savePreferences({ locale: event.target.value as ReaderPreferences["locale"] })}
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
            </label>
            <label>
              <span><b>{copy("界面主题", "Interface theme")}</b><small>{copy("跟随系统或固定浅色、深色模式", "Follow the system or use a fixed light or dark theme")}</small></span>
              <select
                value={preferences.theme}
                onChange={(event) => savePreferences({ theme: event.target.value as ReaderPreferences["theme"] })}
              >
                <option value="system">{copy("跟随系统", "System")}</option>
                <option value="light">{copy("浅色", "Light")}</option>
                <option value="dark">{copy("深色", "Dark")}</option>
              </select>
            </label>
            <label>
              <span>
                <b>{copy("永久删除时取消远程收藏", "Remove remote favorite on permanent delete")}</b>
                <small>{copy("从废纸篓永久删除前，先取消所属的可写知乎收藏；失败的条目会保留在废纸篓。", "Before permanent deletion, remove writable Zhihu memberships. Items with remote failures stay in Trash.")}</small>
              </span>
              <input
                type="checkbox"
                checked={preferences.remoteCleanupOnDelete === true}
                onChange={(event) => savePreferences({ remoteCleanupOnDelete: event.target.checked })}
              />
            </label>
          </section>
        </>
      )}
      {section === "data" && (
        <>
          <header><small>{copy("数据", "Data")}</small><h1>{copy("备份与恢复", "Backup & restore")}</h1><p>{copy("数据库和内容寻址媒体会一起保存；登录 Cookie 和缓存不会进入备份。", "The database and content-addressed media are saved together. Login cookies and caches are excluded.")}</p></header>
          <section className="settings-card backup-card">
            <div><b>{copy("创建完整备份", "Create a complete backup")}</b><p>{copy("保存正文、层级、标签、标注、批注、阅读位置、设置和本地图片。", "Save documents, tiers, tags, annotations, reading positions, preferences, and local images.")}</p><button onClick={createBackup}>{copy("创建备份", "Create backup")}</button></div>
            <div><b>{copy("从备份恢复", "Restore from backup")}</b><p>{copy("恢复前自动保存当前数据库安全副本。现有数据库会被所选备份替换。", "A safety copy is made before the selected backup replaces the current database.")}</p><button onClick={restoreBackup}>{copy("选择备份并恢复", "Choose backup and restore")}</button></div>
          </section>
          {backupStatus && <p className="settings-result">{backupStatus}</p>}
        </>
      )}
      {section === "shortcuts" && (
        <ShortcutSettings
          preferences={preferences}
          commands={commands}
          tags={tags}
          savePreferences={savePreferences}
        />
      )}
      {section === "about" && (
        <>
          <header><small>{copy("关于", "About")}</small><h1>Reader</h1><p>{copy("本地优先的知识下载与阅读工具。", "A local-first knowledge capture and reading tool.")}</p></header>
          <section className="settings-card about-card">
            <dl>
              <div><dt>{copy("版本", "Version")}</dt><dd>{appInfo?.version ?? "…"}</dd></div>
              <div><dt>{copy("分发模式", "Distribution")}</dt><dd>{appInfo?.packaged ? copy("已打包应用", "Packaged app") : copy("开发模式", "Development mode")}</dd></div>
            </dl>
            <button onClick={checkUpdates}>{copy("检查更新", "Check for updates")}</button>
            {updateStatus && <p className="settings-result">{updateStatus}</p>}
          </section>
        </>
      )}
    </div>
  );
}

function ShortcutSettings({
  preferences,
  commands,
  tags,
  savePreferences,
}: {
  preferences: ReaderPreferences;
  commands: AppCommand[];
  tags: ReaderTag[];
  savePreferences(patch: Partial<ReaderPreferences>): void;
}) {
  const [query, setQuery] = useState("");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const configurable = commands.filter(
    (command): command is AppCommand & {
      defaultBinding: string;
      contexts: NonNullable<AppCommand["contexts"]>;
    } => Boolean(command.defaultBinding && command.contexts),
  );
  const visible = configurable.filter((command) =>
    `${command.title} ${command.category} ${command.shortcut ?? ""}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const recording = configurable.find((command) => command.id === recordingId);
  const conflict = recording
    ? shortcutConflict(
        configurable,
        preferences.shortcutBindings ?? {},
        recording.id,
        draft,
      )
    : null;

  function updateBindings(commandId: string, binding?: string) {
    const next = { ...(preferences.shortcutBindings ?? {}) };
    if (binding === undefined) delete next[commandId];
    else next[commandId] = binding;
    savePreferences({ shortcutBindings: next });
  }

  function contextLabel(contexts: NonNullable<AppCommand["contexts"]>) {
    return contexts
      .map((context) =>
        ({
          global: "全局",
          library: "列表",
          reader: "阅读器",
          settings: "设置",
          annotations: "标注",
        })[context],
      )
      .join(" / ");
  }

  return (
    <>
      <header>
        <small>SHORTCUTS</small>
        <h1>快捷键中心</h1>
        <p>点击快捷键开始录制；最多支持两段按键序列。</p>
      </header>
      <section className="settings-card shortcut-options">
        <label>
          <span>
            <b>启用单字符快捷键</b>
            <small>关闭后，输入字母和数字不会触发命令；组合键和方向键仍可用。</small>
          </span>
          <input
            type="checkbox"
            checked={preferences.characterShortcutsEnabled !== false}
            onChange={(event) => savePreferences({ characterShortcutsEnabled: event.target.checked })}
          />
        </label>
        <div className="quick-tag-slots">
          <b>快捷标签 X 1–9</b>
          <small>先按 X，再按数字，把当前或多选内容贴上指定标签。</small>
          <div>
            {Array.from({ length: 9 }, (_, index) => {
              const slot = String(index + 1);
              return (
                <label key={slot}>
                  <kbd>X {slot}</kbd>
                  <select
                    value={preferences.quickTagSlots?.[slot] ?? ""}
                    onChange={(event) => savePreferences({
                      quickTagSlots: {
                        ...(preferences.quickTagSlots ?? {}),
                        [slot]: event.target.value,
                      },
                    })}
                  >
                    <option value="">未绑定</option>
                    {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      </section>
      <section className="settings-card shortcut-center">
        <div className="shortcut-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索命令或快捷键"
          />
          <button onClick={() => savePreferences({ shortcutBindings: {} })}>全部恢复默认</button>
        </div>
        <div className="shortcut-list">
          {visible.map((command) => {
            const binding = commandBinding(command, preferences.shortcutBindings);
            const overridden = Object.prototype.hasOwnProperty.call(
              preferences.shortcutBindings ?? {},
              command.id,
            );
            const isRecording = recordingId === command.id;
            return (
              <div key={command.id} className="shortcut-row">
                <span>
                  <b>{command.title}</b>
                  <small>{command.category} · {contextLabel(command.contexts)}</small>
                </span>
                {isRecording ? (
                  <div className="shortcut-recorder">
                    <button
                      autoFocus
                      className="recording"
                      onKeyDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.key === "Escape") {
                          setRecordingId(null);
                          return;
                        }
                        if (event.key === "Backspace" || event.key === "Delete") {
                          setDraft("");
                          return;
                        }
                        const stroke = shortcutStroke(event.nativeEvent);
                        if (!stroke) return;
                        setDraft((current) => current.split(" ").filter(Boolean).length >= 2
                          ? stroke
                          : [current, stroke].filter(Boolean).join(" "));
                      }}
                    >
                      {draft ? formatShortcut(draft) : "请按快捷键"}
                    </button>
                    <button
                      disabled={!draft || Boolean(conflict)}
                      onClick={() => {
                        updateBindings(command.id, draft);
                        setRecordingId(null);
                      }}
                    >保存</button>
                    <button onClick={() => setRecordingId(null)}>取消</button>
                  </div>
                ) : (
                  <div className="shortcut-binding">
                    <button onClick={() => {
                      setRecordingId(command.id);
                      setDraft("");
                    }}>
                      {binding ? formatShortcut(binding) : "未绑定"}
                    </button>
                    <button title="禁用" onClick={() => updateBindings(command.id, "")}>×</button>
                    {overridden && (
                      <button title="恢复默认" onClick={() => updateBindings(command.id)}>↺</button>
                    )}
                  </div>
                )}
                {isRecording && conflict && (
                  <small className="shortcut-conflict">与“{conflict.title}”冲突</small>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function DocumentActionsMenu({
  menu,
  items,
  reader,
  tags,
  trash,
  remoteCleanupOnDelete,
  close,
  setMode,
  setTier,
  addTag,
  removeRemote,
  moveToTrash,
  restore,
  permanentlyDelete,
  openOriginal,
}: {
  menu: DocumentMenuState;
  items: ReaderListItem[];
  reader: ReaderDocument | null;
  tags: ReaderTag[];
  trash: boolean;
  remoteCleanupOnDelete: boolean;
  close(): void;
  setMode(mode: DocumentMenuState["mode"]): void;
  setTier(tier: ReaderListItem["tier"]): void;
  addTag(name: string): void;
  removeRemote(): void;
  moveToTrash(): void;
  restore(): void;
  permanentlyDelete(forceLocal: boolean): void;
  openOriginal(url: string): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const primary = items[0] ?? reader;
  const url = menu.ids.length === 1 ? primary?.url : null;
  const remoteEligible = items.some(
    (item) =>
      item.source.split(":", 1)[0] === "zhihu" ||
      /^https:\/\/(?:www|zhuanlan)\.zhihu\.com\//.test(item.url ?? ""),
  ) || reader?.sourceMemberships.some(
    (membership) => membership.source.split(":", 1)[0] === "zhihu",
  ) === true;
  const currentTier = items.every((item) => item.tier === primary?.tier)
    ? primary?.tier
    : null;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 248));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 380));

  useEffect(() => {
    requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus(),
    );
  }, [menu.mode]);

  function run(action: () => void) {
    close();
    action();
  }

  function navigate(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index]?.focus();
  }

  return (
    <div className="document-menu-layer" onPointerDown={close}>
      <div
        className="document-actions-menu"
        role="menu"
        aria-label="文档操作"
        ref={menuRef}
        style={{ left, top }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={navigate}
      >
        <header>
          {menu.mode !== "main" && (
            <button onClick={() => setMode("main")} aria-label="返回">
              <ArrowLeft size={15} />
            </button>
          )}
          <b>
            {menu.mode === "tier"
              ? "选择层级"
              : menu.mode === "tags"
                ? "添加标签"
                : menu.ids.length > 1
                  ? `${menu.ids.length} 篇内容`
                  : "更多操作"}
          </b>
        </header>
        {menu.mode === "tier" ? (
          TIERS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="menuitem"
              className={currentTier === key ? "active" : ""}
              onClick={() => run(() => setTier(key))}
            >
              <Icon size={16} /><span>{label}</span>
              {currentTier === key && <Check size={15} />}
            </button>
          ))
        ) : menu.mode === "tags" ? (
          <>
            {tags.slice(0, 12).map((tag) => (
              <button
                key={tag.id}
                role="menuitem"
                onClick={() => run(() => addTag(tag.name))}
              >
                <Tags size={15} /><span>#{tag.name}</span>
              </button>
            ))}
            <button
              role="menuitem"
              onClick={() => {
                const name = window.prompt("输入新标签")?.trim();
                if (name) run(() => addTag(name));
              }}
            >
              <Plus size={15} /><span>新建标签…</span>
            </button>
          </>
        ) : (
          <>
            {!trash && (
              <>
                <button role="menuitem" onClick={() => setMode("tier")}>
                  <Columns3 size={16} /><span>移动到层级</span><ChevronDown size={14} />
                </button>
                <button role="menuitem" onClick={() => setMode("tags")}>
                  <Tags size={16} /><span>添加标签</span><ChevronDown size={14} />
                </button>
              </>
            )}
            {url && (
              <button role="menuitem" onClick={() => run(() => openOriginal(url))}>
                <FileText size={16} /><span>打开原文</span>
              </button>
            )}
            {remoteEligible && !trash && (
              <button role="menuitem" onClick={() => run(removeRemote)}>
                <Star size={16} /><span>取消知乎收藏</span>
              </button>
            )}
            <span className="document-menu-separator" />
            {trash ? (
              <>
                <button role="menuitem" onClick={() => run(restore)}>
                  <RotateCcw size={16} /><span>恢复</span>
                </button>
                <button className="danger" role="menuitem" onClick={() => run(() => permanentlyDelete(false))}>
                  <Trash2 size={16} />
                  <span>{remoteCleanupOnDelete ? "取消收藏并永久删除" : "永久删除"}</span>
                </button>
                {remoteCleanupOnDelete && (
                  <button role="menuitem" onClick={() => run(() => permanentlyDelete(true))}>
                    <Trash2 size={16} /><span>仅永久删除本地内容</span>
                  </button>
                )}
              </>
            ) : (
              <button className="danger" role="menuitem" onClick={() => run(moveToTrash)}>
                <Trash2 size={16} /><span>移到废纸篓</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AppWindowControls() {
  const [maximized, setMaximized] = useState(false);
  const supported =
    typeof window.desktop.minimizeAppWindow === "function" &&
    typeof window.desktop.toggleMaximizeAppWindow === "function" &&
    typeof window.desktop.closeAppWindow === "function";
  if (!supported) return null;
  return (
    <div className="window-controls" aria-label="窗口控制">
      <button
        onClick={() => void window.desktop.minimizeAppWindow()}
        aria-label="最小化"
        title="最小化"
      >
        <Minus size={16} />
      </button>
      <button
        onClick={() =>
          void window.desktop
            .toggleMaximizeAppWindow()
            .then((result) => setMaximized(result.maximized))
        }
        aria-label={maximized ? "还原窗口" : "最大化窗口"}
        title={maximized ? "还原窗口" : "最大化窗口"}
      >
        {maximized ? <Copy size={13} /> : <Square size={12} />}
      </button>
      <button
        className="close"
        onClick={() => void window.desktop.closeAppWindow()}
        aria-label="关闭"
        title="关闭"
      >
        <X size={17} />
      </button>
    </div>
  );
}

function ResizeHandle({
  onPointerDown,
}: {
  onPointerDown(event: React.PointerEvent): void;
}) {
  return (
    <div
      className="resize-handle"
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
    />
  );
}

function TocNodes({
  items,
  bodyRef,
}: {
  items: TocItem[];
  bodyRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.index}>
          <button
            onClick={() =>
              bodyRef.current
                ?.querySelectorAll("h1,h2,h3")
                [item.index]?.scrollIntoView({ behavior: "smooth" })
            }
          >
            {item.title}
          </button>
          {item.children.length > 0 && (
            <TocNodes items={item.children} bodyRef={bodyRef} />
          )}
        </li>
      ))}
    </ul>
  );
}

function DocumentCard({
  item,
  selected,
  multiSelected,
  onClick,
  openMenu,
  trash = false,
  restore,
  remove,
}: {
  item: ReaderListItem;
  selected: boolean;
  multiSelected: boolean;
  onClick(event: React.MouseEvent): void;
  openMenu(
    event: React.MouseEvent | React.KeyboardEvent,
    mode?: DocumentMenuState["mode"],
  ): void;
  trash?: boolean;
  restore?(): void;
  remove?(): void;
}) {
  return (
    <div
      className={`document-card ${selected ? "selected" : ""} ${multiSelected ? "multi-selected" : ""}`}
      onContextMenu={(event) => openMenu(event)}
    >
      <button className="document-main" onClick={onClick}>
        {multiSelected && <span className="multi-check">✓</span>}
        {item.coverUrl ? (
          <img src={item.coverUrl} alt="" />
        ) : (
          <span className="cover-placeholder">
            <FileText size={21} />
          </span>
        )}
        <span className="card-copy">
          <b>{item.title || "无标题内容"}</b>
          {item.summary && <p>{item.summary}</p>}
          <small>
            <em className={`tier ${item.tier}`}>{TIER_LABEL[item.tier]}</em>
            {item.tagNames.slice(0, 2).map((tag) => (
              <i key={tag}>#{tag}</i>
            ))}
            {item.favorite && <Star size={12} fill="currentColor" />}
            <time>{formatDate(item.fetchedAt)}</time>
          </small>
        </span>
      </button>
      {!trash && (
        <span className="document-card-actions">
          <button
            onClick={(event) => openMenu(event, "tier")}
            title="快速分类"
            aria-label="快速分类"
          >
            {(() => {
              const Icon = TIERS.find((tier) => tier.key === item.tier)?.icon ?? Inbox;
              return <Icon size={15} />;
            })()}
          </button>
          <button
            onClick={(event) => openMenu(event, "tags")}
            title="添加标签"
            aria-label="添加标签"
          >
            <Tags size={15} />
          </button>
          <button
            onClick={(event) => openMenu(event)}
            onKeyDown={(event) => {
              if (event.shiftKey && event.key === "F10")
                openMenu(event);
            }}
            title="更多操作"
            aria-label="更多操作"
          >
            <MoreHorizontal size={16} />
          </button>
        </span>
      )}
      {trash && (
        <span className="trash-actions">
          <button onClick={restore} title="恢复">
            <RotateCcw size={15} />
          </button>
          <button onClick={remove} title="永久删除">
            <Trash2 size={15} />
          </button>
        </span>
      )}
    </div>
  );
}

function DocumentTable({
  documents,
  selectedId,
  selectedIds,
  select,
  openMenu,
  editTags,
  save,
}: {
  documents: ReaderListItem[];
  selectedId: string | null;
  selectedIds: Set<string>;
  select(item: ReaderListItem, event: React.MouseEvent): void;
  openMenu(
    item: ReaderListItem,
    event: React.MouseEvent | React.KeyboardEvent,
  ): void;
  editTags(item: ReaderListItem, tags: string[]): Promise<boolean>;
  save(
    item: ReaderListItem,
    patch: { tier?: string; favorite?: boolean },
  ): void;
}) {
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [tagValue, setTagValue] = useState("");

  async function saveTags(item: ReaderListItem) {
    const tags = [
      ...new Set(
        tagValue
          .split(/[,，]/)
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    ];
    if (await editTags(item, tags)) setEditingTagsId(null);
  }

  return (
    <div className="document-table" role="table">
      <div className="document-table-head" role="row">
        <div role="columnheader">标题</div>
        <div role="columnheader">层级</div>
        <div role="columnheader">标签</div>
        <div role="columnheader">收藏</div>
        <div role="columnheader">更新时间</div>
      </div>
      <div className="document-table-body" role="rowgroup">
        {documents.map((item) => (
          <div
            key={item.id}
            role="row"
            className={`${selectedId === item.id ? "selected" : ""} ${selectedIds.has(item.id) ? "multi-selected" : ""}`}
            onClick={(event) => select(item, event)}
            onContextMenu={(event) => openMenu(item, event)}
          >
            <div role="cell">{item.title}</div>
            <div role="cell">
              <select
                value={item.tier}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => save(item, { tier: event.target.value })}
              >
                {TIERS.map((tier) => (
                  <option value={tier.key} key={tier.key}>
                    {tier.label}
                  </option>
                ))}
              </select>
            </div>
            <div
              className="document-tags-cell"
              role={editingTagsId === item.id ? undefined : "button"}
              tabIndex={editingTagsId === item.id ? undefined : 0}
              aria-label={`编辑 ${item.title || "无标题内容"} 的标签`}
              onClick={(event) => {
                event.stopPropagation();
                if (editingTagsId === item.id) return;
                setTagValue(item.tagNames.join(", "));
                setEditingTagsId(item.id);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || editingTagsId === item.id) return;
                event.stopPropagation();
                setTagValue(item.tagNames.join(", "));
                setEditingTagsId(item.id);
              }}
            >
              {editingTagsId === item.id ? (
                <div className="document-tags-editor">
                  <input
                    autoFocus
                    value={tagValue}
                    placeholder="逗号分隔标签"
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setTagValue(event.target.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") void saveTags(item);
                      if (event.key === "Escape") setEditingTagsId(null);
                    }}
                  />
                  <button
                    aria-label="保存标签"
                    onClick={(event) => {
                      event.stopPropagation();
                      void saveTags(item);
                    }}
                  >
                    <Check size={14} />
                  </button>
                </div>
              ) : item.tagNames.length ? (
                item.tagNames.map((tag) => <span key={tag}>#{tag}</span>)
              ) : (
                <span className="empty">+ 添加标签</span>
              )}
            </div>
            <div role="cell">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  save(item, { favorite: !item.favorite });
                }}
              >
                <Star
                  size={15}
                  fill={item.favorite ? "currentColor" : "none"}
                />
              </button>
            </div>
            <div role="cell">{formatDate(item.fetchedAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReaderPane({
  reader,
  expanded = false,
  paneRef,
  bodyRef,
  onScroll,
  onSelection,
  onHighlightClick,
  onNoteClick,
  onCollapse,
  tocHidden,
  onToggleToc,
  preferences,
  allTags,
  savePreferences,
  saveState,
  addTag,
  removeTag,
  toolbarOpen,
  setToolbarOpen,
  openActions,
}: {
  reader: ReaderDocument | null;
  expanded?: boolean;
  paneRef: React.RefObject<HTMLElement | null>;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  onScroll(): void;
  onSelection(value: SelectionAnchor | null): void;
  onHighlightClick(ids: string[], value: SelectionAnchor): void;
  onNoteClick(id: string, value: SelectionAnchor): void;
  onCollapse(): void;
  tocHidden: boolean;
  onToggleToc(): void;
  preferences: ReaderPreferences;
  allTags: ReaderTag[];
  savePreferences(patch: Partial<ReaderPreferences>): void;
  saveState(input: { tier?: string; favorite?: boolean }): void;
  addTag(name: string): Promise<boolean>;
  removeTag(tagId: string): void;
  toolbarOpen: "type" | "tier" | "tags" | null;
  setToolbarOpen(open: "type" | "tier" | "tags" | null): void;
  openActions(event: React.MouseEvent): void;
}) {
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const [toolbarLocked, setToolbarLocked] = useState(false);
  const lastScrollTop = useRef(0);
  const scrollFrame = useRef<number | null>(null);
  useEffect(() => {
    if (reader && paneRef.current) {
      paneRef.current.scrollTop = reader.scrollTop;
      lastScrollTop.current = reader.scrollTop;
      setToolbarHidden(reader.scrollTop > 72);
    }
  }, [paneRef, reader?.id]);
  function handleScroll() {
    onScroll();
    if (!expanded || toolbarLocked || !paneRef.current) return;
    if (scrollFrame.current != null) cancelAnimationFrame(scrollFrame.current);
    const scrollTop = paneRef.current.scrollTop;
    scrollFrame.current = requestAnimationFrame(() => {
      setToolbarHidden(scrollTop > 72 && scrollTop > lastScrollTop.current);
      lastScrollTop.current = scrollTop;
    });
  }
  if (!reader) return <Empty text="选择一篇内容开始阅读" />;
  return (
    <article
      className={`reader-pane ${expanded ? "expanded-reader" : ""}`}
      ref={paneRef}
      onScroll={handleScroll}
      onContextMenu={openActions}
      tabIndex={0}
      aria-label="正文阅读区"
    >
      {expanded && (
        <ReaderToolbar
          reader={reader}
          hidden={toolbarHidden && !toolbarLocked}
          tocHidden={tocHidden}
          preferences={preferences}
          allTags={allTags}
          onCollapse={onCollapse}
          onToggleToc={onToggleToc}
          savePreferences={savePreferences}
          saveState={saveState}
          addTag={addTag}
          removeTag={removeTag}
          onOpenChange={setToolbarLocked}
          open={toolbarOpen}
          setOpen={setToolbarOpen}
          openActions={openActions}
        />
      )}
      <div className="reader-content">
        <h1>{reader.title || "无标题内容"}</h1>
        <div className="reader-subline">
          <span>{formatDate(reader.publishedAt, true)}</span>
          <span>{reader.estimatedMinutes} 分钟</span>
        </div>
        {reader.importError && (
          <p className="warning">
            上次同步：{reader.importError}；已有正文仍可离线阅读。
          </p>
        )}
        <ReaderBody
          reader={reader}
          bodyRef={bodyRef}
          onSelection={onSelection}
          onHighlightClick={onHighlightClick}
          onNoteClick={onNoteClick}
        />
      </div>
    </article>
  );
}

function ReaderToolbar({
  reader,
  hidden,
  tocHidden,
  preferences,
  allTags,
  onCollapse,
  onToggleToc,
  savePreferences,
  saveState,
  addTag,
  removeTag,
  onOpenChange,
  open,
  setOpen,
  openActions,
}: {
  reader: ReaderDocument;
  hidden: boolean;
  tocHidden: boolean;
  preferences: ReaderPreferences;
  allTags: ReaderTag[];
  onCollapse(): void;
  onToggleToc(): void;
  savePreferences(patch: Partial<ReaderPreferences>): void;
  saveState(input: { tier?: string; favorite?: boolean }): void;
  addTag(name: string): Promise<boolean>;
  removeTag(tagId: string): void;
  onOpenChange(open: boolean): void;
  open: "type" | "tier" | "tags" | null;
  setOpen(open: "type" | "tier" | "tags" | null): void;
  openActions(event: React.MouseEvent): void;
}) {
  const [tagName, setTagName] = useState("");
  const toolbarRef = useRef<HTMLDivElement>(null);
  const tier = TIERS.find((item) => item.key === reader.tier) ?? TIERS[0];
  const TierIcon = tier.icon;
  function changeOpen(next: typeof open) {
    setOpen(next);
    onOpenChange(Boolean(next));
  }
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof PointerEvent &&
        toolbarRef.current?.contains(event.target as Node)
      )
        return;
      changeOpen(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="reader-toolbar-slot">
      <div
        className={`reader-toolbar ${hidden ? "is-hidden" : ""}`}
        ref={toolbarRef}
      >
        <div className="reader-toolbar-group reader-toolbar-start">
          {tocHidden && (
            <>
              <button data-tooltip="返回列表" aria-label="返回列表" onClick={onCollapse}>
                <ArrowLeft size={17} />
              </button>
              <button data-tooltip="显示目录" aria-label="显示目录" onClick={onToggleToc}>
                <PanelLeftOpen size={17} />
              </button>
              <span className="toolbar-divider" />
            </>
          )}
          <button
            className={open === "type" ? "active" : ""}
            data-tooltip="排版设置"
            aria-label="排版设置"
            onClick={() => changeOpen(open === "type" ? null : "type")}
          >
            <b>Aa</b>
          </button>
        </div>
        <div className="reader-toolbar-group reader-toolbar-end">
          <button
            className={`tier-button ${tier.key} ${open === "tier" ? "active" : ""}`}
            data-tooltip="快速分类"
            aria-label={`当前分类：${tier.label}`}
            onClick={() => changeOpen(open === "tier" ? null : "tier")}
          >
            <TierIcon size={15} />
            <span>{tier.label}</span>
            <ChevronDown size={13} />
          </button>
          <button
            className={open === "tags" ? "active" : ""}
            data-tooltip="编辑标签"
            aria-label="编辑标签"
            onClick={() => changeOpen(open === "tags" ? null : "tags")}
          >
            <Tags size={16} />
            {reader.tags.length > 0 && <i>{reader.tags.length}</i>}
          </button>
          <button
            data-tooltip="更多操作"
            aria-label="更多操作"
            onClick={openActions}
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
        {open && (
          <div className={`reader-toolbar-popover ${open}`}>
            {open === "type" && (
              <Preferences value={preferences} save={savePreferences} compact />
            )}
            {open === "tier" && (
              <div className="tier-menu">
                {TIERS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    className={reader.tier === key ? "active" : ""}
                    onClick={() => {
                      saveState({ tier: key });
                      changeOpen(null);
                    }}
                  >
                    <Icon size={16} />
                    <span>{label}</span>
                    {reader.tier === key && <Check size={15} />}
                  </button>
                ))}
              </div>
            )}
            {open === "tags" && (
              <div className="toolbar-tags">
                <div className="toolbar-tag-list">
                  {reader.tags.map((tag) => (
                    <span key={tag.id}>
                      #{tag.name}
                      <button
                        aria-label={`移除标签 ${tag.name}`}
                        onClick={() => removeTag(tag.id)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {!reader.tags.length && <small>尚未添加标签</small>}
                </div>
                <input
                  autoFocus
                  value={tagName}
                  placeholder="搜索或创建标签"
                  onChange={(event) => setTagName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !tagName.trim()) return;
                    void addTag(tagName).then((ok) => ok && setTagName(""));
                  }}
                />
                <div className="tag-suggestions">
                  {allTags
                    .filter(
                      (tag) =>
                        !reader.tags.some((current) => current.id === tag.id) &&
                        tag.name
                          .toLowerCase()
                          .includes(tagName.trim().toLowerCase()),
                    )
                    .slice(0, 8)
                    .map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => void addTag(tag.name)}
                      >
                        <Tags size={13} /> {tag.name}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Properties({
  reader,
  tagDraft,
  setTagDraft,
  addTag,
  removeTag,
  saveState,
  sync,
  trash,
  restore,
  removeRemote,
  remoteRemovalState,
  tagInputRef,
}: {
  reader: ReaderDocument | null;
  tagDraft: string;
  setTagDraft(value: string): void;
  addTag(): void;
  removeTag(tagId: string): void;
  saveState(input: { tier?: string; favorite?: boolean }): void;
  sync(): void;
  trash(): void;
  restore?: () => void;
  removeRemote(): void;
  remoteRemovalState: RemoteRemovalState;
  tagInputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  if (!reader) return <Empty text="选择文档后查看属性" />;
  return (
    <div className="properties">
      <h2>{reader.title || "无标题内容"}</h2>
      <Property label="层级">
        <select
          value={reader.tier}
          onChange={(event) => saveState({ tier: event.target.value })}
        >
          {TIERS.map((tier) => (
            <option value={tier.key} key={tier.key}>
              {tier.label}
            </option>
          ))}
        </select>
      </Property>
      <Property label="标签">
        <div className="tag-editor">
          {reader.tags.map((tag) => (
            <span key={tag.id}>
              #{tag.name}
              <button onClick={() => removeTag(tag.id)}>×</button>
            </span>
          ))}
          <input
            ref={tagInputRef}
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addTag()}
            placeholder="添加标签"
          />
        </div>
      </Property>
      <Property label="收藏">
        <button
          className="favorite-toggle"
          onClick={() => saveState({ favorite: !reader.favorite })}
        >
          <Star size={16} fill={reader.favorite ? "currentColor" : "none"} />
          {reader.favorite ? "已收藏" : "未收藏"}
        </button>
      </Property>
      <Property label="来源">
        <a
          href="#"
          onClick={(event) => {
            event.preventDefault();
            if (reader.url) void window.desktop.openZhihuUrl(reader.url);
          }}
        >
          {reader.url ?? "本地文件"}
        </a>
      </Property>
      <Property label="作者">{reader.author || "未知"}</Property>
      <Property label="发布时间">
        {formatDate(reader.publishedAt, true)}
      </Property>
      <Property label="保存时间">{formatDate(reader.fetchedAt, true)}</Property>
      <Property label="字数 / 阅读">
        {reader.body.replace(/<[^>]+>/g, "").length.toLocaleString()} 字 ·{" "}
        {reader.estimatedMinutes} 分钟
      </Property>
      <Property label="阅读位置">{Math.round(reader.scrollTop)} px</Property>
      {reader.versions.length > 1 && (
        <Property label="历史版本">
          <select>
            {reader.versions.map((version) => (
              <option key={version.versionId}>
                {formatDate(version.createdAt, true)}
              </option>
            ))}
          </select>
        </Property>
      )}
      <div className="property-actions">
        <button className="sync-action" onClick={sync}>
          <RotateCcw size={15} />
          单条同步
        </button>
        {(reader.source.split(":", 1)[0] === "zhihu" ||
          reader.sourceMemberships?.some(
            (membership) => membership.source.split(":", 1)[0] === "zhihu",
          ) ||
          /^https:\/\/(?:www|zhuanlan)\.zhihu\.com\//.test(reader.url ?? "")) &&
          !restore &&
          ((reader.sourceMemberships?.length ?? 0) > 0 ||
            remoteRemovalState === "success") && (
            <button
              className={`remote-action ${remoteRemovalState}`}
              onClick={removeRemote}
              disabled={
                remoteRemovalState === "loading" ||
                remoteRemovalState === "success"
              }
            >
              <Bookmark size={15} />
              {remoteRemovalState === "loading"
                ? "正在取消…"
                : remoteRemovalState === "success"
                  ? "已取消知乎收藏"
                  : remoteRemovalState === "partial"
                    ? "重试取消收藏"
                    : "取消知乎收藏"}
            </button>
          )}
        {restore && (
          <button onClick={restore}>
            <RotateCcw size={15} />
            恢复
          </button>
        )}
        <button className="danger" onClick={trash}>
          <Trash2 size={15} />
          {restore ? "永久删除" : "移到废纸篓"}
        </button>
      </div>
    </div>
  );
}

function Property({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="property">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}
function Notes({
  reader,
  bodyRef,
  refresh,
}: {
  reader: ReaderDocument | null;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  refresh(): void;
}) {
  if (!reader) return <Empty text="还没有笔记" />;
  return (
    <div className="notes-list">
      {reader.highlights.map((item) => (
        <button key={item.id} onClick={() => jumpToText(bodyRef.current, item.quote)}>
          <mark className={`reader-highlight-${item.color}`}>{item.quote}</mark>
          <small>高亮 · {formatDate(item.createdAt)}</small>
        </button>
      ))}
      {reader.notes.map((item) => (
        <div key={item.id}>
          <button onClick={() => jumpToText(bodyRef.current, item.exact)}>
            <p>{item.body}</p>
            <small>批注 · {formatDate(item.createdAt)}</small>
          </button>
          <button
            onClick={() => {
              const next = prompt("编辑批注", item.body);
              if (next?.trim())
                void readerClient.updateNote(item.id, next).then(refresh);
            }}
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      ))}
      {!reader.notes.length && !reader.highlights.length && (
        <Empty text="高亮和批注会显示在这里" />
      )}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <FileText size={26} />
      <span>{text}</span>
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close(): void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section className="modal">
        <header>
          <h2>{title}</h2>
          <button onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div>{children}</div>
      </section>
    </div>
  );
}
function SyncMini({
  sync,
  open,
}: {
  sync: ReturnType<typeof useSourceSync>;
  open(): void;
}) {
  const p = sync.progress;
  const awaitingCleanup =
    sync.job?.payload.phase === "awaiting_remote_cleanup_confirmation";
  const done = (p?.completed ?? 0) + (p?.failed ?? 0) + (p?.skipped ?? 0);
  return (
    <div className="sync-mini">
      <button className="sync-mini-main" data-sync-toggle onClick={open}>
        <span>
          <RotateCcw size={14} />
          {awaitingCleanup
            ? "待确认清理"
            : sync.job?.status === "paused"
              ? "已暂停"
              : "同步中"}
        </span>
        <progress max={p?.total || 1} value={done} />
        <small>
          {done}/{p?.total ?? 0}
        </small>
      </button>
      {!awaitingCleanup && <span>
        {sync.job?.status === "paused" ? (
          <button onClick={() => void sync.resume()} title="继续">
            <Play size={14} />
          </button>
        ) : (
          <button onClick={() => void sync.pause()} title="暂停">
            <Pause size={14} />
          </button>
        )}
        <button onClick={() => void sync.cancel()} title="取消">
          <X size={14} />
        </button>
      </span>}
    </div>
  );
}
function SyncCenter({ sync }: { sync: ReturnType<typeof useSourceSync> }) {
  const job = sync.job;
  if (!job) return <Empty text="还没有同步任务" />;
  const p = sync.progress;
  const awaitingCleanup =
    job.payload.phase === "awaiting_remote_cleanup_confirmation";
  const cleanupSources = [
    ...new Set(
      job.payload.remoteCleanup?.candidates?.map((item) => item.sourceName) ?? [],
    ),
  ];
  return (
    <div className="sync-center">
      <b>
        {job.payload.mode === "full" ? "全量同步" : "增量同步"} · {job.status}
      </b>
      <p>{job.payload.currentSource ?? "批次已完成"}</p>
      <progress
        max={p?.total || 1}
        value={(p?.completed ?? 0) + (p?.failed ?? 0) + (p?.skipped ?? 0)}
      />
      <small>
        完成 {p?.completed ?? 0} · 跳过 {p?.skipped ?? 0} · 失败{" "}
        {p?.failed ?? 0} · 剩余 {p?.remaining ?? 0}
      </small>
      <div className="sync-icon-actions">
        {job.status === "running" && (
          <button onClick={() => void sync.pause()} title="暂停">
            <Pause size={16} />
          </button>
        )}
        {job.status === "paused" && !awaitingCleanup && (
          <button onClick={() => void sync.resume()} title="继续">
            <Play size={16} />
          </button>
        )}
        {sync.active && (
          <button onClick={() => void sync.cancel()} title="取消">
            <X size={16} />
          </button>
        )}
      </div>
      {awaitingCleanup && (
        <div className="remote-cleanup-confirmation">
          <b>确认远程取消收藏</b>
          <p>
            已确认本地正文完整。将从
            {cleanupSources.length ? `“${cleanupSources.join("、")}”` : "当前账号拥有的收藏夹"}
            取消 {job.payload.remoteCleanup?.planned ?? 0} 条收藏；执行前还会再次检查账号与写权限。
          </p>
          <div>
            <button className="danger" onClick={() => void sync.resume()}>
              确认执行
            </button>
            <button onClick={() => void sync.skipRemoteCleanup()}>
              跳过清理
            </button>
          </div>
        </div>
      )}
      {sync.failures.length > 0 && (
        <ul className="sync-errors">
          {sync.failures.map((item) => (
            <li key={item.externalId}>
              <a
                href={item.url ?? "#"}
                onClick={(event) => {
                  event.preventDefault();
                  if (item.url) void window.desktop.openZhihuUrl(item.url);
                }}
              >
                {item.title ||
                  `${item.kind === "answer" ? "回答" : "文章"} ${item.externalId}`}
              </a>
              <span>{syncFailure(item)}</span>
              <button onClick={() => void sync.retry(item.externalId)}>
                重试
              </button>
            </li>
          ))}
        </ul>
      )}
      {job.payload.remoteCleanup && (
        <p>
          远程清理：计划 {job.payload.remoteCleanup.planned ?? 0}，成功{" "}
          {job.payload.remoteCleanup.completed}，失败 {job.payload.remoteCleanup.failed}
          {job.payload.remoteCleanup.skipped ? "，已跳过" : ""}
          {job.payload.remoteCleanup.blockedReason
            ? `，已阻止：${job.payload.remoteCleanup.blockedReason}`
            : ""}
        </p>
      )}
    </div>
  );
}
function Preferences({
  value,
  save,
  compact = false,
}: {
  value: ReaderPreferences;
  save(patch: Partial<ReaderPreferences>): void;
  compact?: boolean;
}) {
  const range = (
    key: keyof ReaderPreferences,
    label: string,
    min: number,
    max: number,
    step: number,
  ) => (
    <label>
      <span>
        {label}
        <b>{String(value[key])}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(value[key])}
        onChange={(event) => void save({ [key]: Number(event.target.value) })}
      />
    </label>
  );
  return (
    <div className={`preferences ${compact ? "compact" : ""}`}>
      <div className="theme-picker">
        {(
          [
            ["light", "浅色", Sun],
            ["dark", "深色", Moon],
            ["system", "跟随系统", Monitor],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            className={value.theme === key ? "active" : ""}
            onClick={() => save({ theme: key })}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </div>
      <label>
        <span>正文字体</span>
        <select
          value={value.fontFamily}
          onChange={(event) => void save({ fontFamily: event.target.value })}
        >
          <option value="wenkai">霞鹜文楷</option>
          <option value="serif">系统宋体</option>
          <option value="sans">系统黑体</option>
          {value.customFontUrl && (
            <option value="custom">
              {value.customFontName ?? "自定义字体"}
            </option>
          )}
        </select>
      </label>
      {range("fontSize", "字号", 14, 32, 1)}
      {range("lineHeight", "行高", 1.3, 2.2, 0.05)}
      {range("paragraphSpacing", "段距", 0, 1.5, 0.1)}
      {range("contentWidth", "正文宽度", 560, 1000, 20)}
      {range("pageMargin", "页边距", 16, 120, 4)}
      <label className="font-import">
        <span>
          导入字体 <small>WOFF / WOFF2 / TTF / OTF，最大 64MB</small>
        </span>
        <input
          type="file"
          accept=".woff,.woff2,.ttf,.otf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const mime = (
              {
                woff: "font/woff",
                woff2: "font/woff2",
                ttf: "font/ttf",
                otf: "font/otf",
              } as Record<string, string>
            )[file.name.split(".").pop()?.toLowerCase() ?? ""];
            void file
              .arrayBuffer()
              .then((bytes) =>
                readerClient.importReaderFont({
                  name: file.name,
                  mimeType: mime,
                  bytes: new Uint8Array(bytes),
                }),
              )
              .then((result) => result.preferences && save(result.preferences));
          }}
        />
      </label>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
