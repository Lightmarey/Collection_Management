import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DOMPurify from 'dompurify';
import './renderer.css';

const FILTERS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'unread', label: '未读' },
  { key: 'reading', label: '阅读中' },
  { key: 'processed', label: '已处理' },
  { key: 'archived', label: '已归档' },
  { key: 'favorites', label: '收藏夹' },
  { key: 'level:short', label: '短期消费' },
  { key: 'level:medium', label: '中期实践' },
  { key: 'level:long', label: '长期内化' },
] as const;

const STATUS_LABELS: Record<string, string> = {
  unread: '未读',
  reading: '阅读中',
  processed: '已处理',
  archived: '已归档',
};

const LEVEL_LABELS: Record<string, string> = {
  short: '短期消费',
  medium: '中期实践',
  long: '长期内化',
};

function formatDate(value: string | null | undefined) {
  if (!value) return '时间未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

function errorLabel(error: string | undefined) {
  return {
    database_unavailable: '本地数据库不可用，请检查磁盘权限后重启。',
    database_repair_required: '本地数据库无法打开。应用已保留启动备份，请关闭应用后使用 knowledge.sqlite.startup.bak 修复或恢复数据。',
    database_read_failed: '读取本地数据失败。',
    document_not_found: '文档已不存在或已被删除。',
    ANCHOR_NOT_FOUND: '引文已不在当前正文中，请重新选择正文位置。',
    ANNOTATION_NOT_FOUND: '标注已不存在。',
    VALIDATION_ERROR: '标注内容不能为空。',
    corrupt: '正文数据损坏，无法安全显示。',
  }[error ?? ''] ?? '本地阅读数据暂时不可用。';
}

function syncFailureLabel(error: string | null | undefined) {
  return {
    login_expired: '登录已失效，请重新登录知乎。',
    rate_limited: '请求过于频繁，请稍后再试。',
    captcha: '该条内容触发了知乎安全验证响应（不一定会弹出窗口），已跳过；稍后可重试。',
    paid_or_no_permission: '该条内容无权限或属于付费内容，无法通过重试导入。',
    structure_changed: '知乎返回结构发生变化，已停止同步。',
    http_error: '网络请求失败，请检查网络后重试。',
    stopped: '同步已停止。',
  }[error ?? ''] ?? '同步失败，请重试。';
}

function syncStatusLabel(status: string) {
  return ({ queued: '排队中', running: '进行中', paused: '已暂停', completed: '已完成', stopped: '已停止', cancelled: '已取消', failed: '失败' }[status] ?? status);
}

function safeReaderHtml(body: string) {
  return DOMPurify.sanitize(body, {
    FORBID_TAGS: ['base', 'embed', 'form', 'iframe', 'input', 'link', 'meta', 'object', 'script', 'style', 'svg', 'template'],
    FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload'],
  });
}

type SelectionAnchor = { exact: string; prefix: string; suffix: string; start: number; end: number };

function selectedTextAnchor(root: HTMLElement): SelectionAnchor | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const startRange = document.createRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);
  const start = startRange.toString().length;
  const exact = range.toString();
  const end = start + exact.length;
  if (!exact.trim()) return null;
  const content = root.textContent ?? '';
  return { exact, start, end, prefix: content.slice(Math.max(0, start - 32), start), suffix: content.slice(end, end + 32) };
}

function App() {
  const [filter, setFilter] = useState('inbox');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'title' | 'duration' | 'status'>('updated');
  const [documents, setDocuments] = useState<ReaderListItem[]>([]);
  const [tags, setTags] = useState<ReaderTag[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reader, setReader] = useState<ReaderDocument | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionAnchor | null>(null);
  const [highlightColor, setHighlightColor] = useState('yellow');
  const [noteBody, setNoteBody] = useState('');
  const [tagName, setTagName] = useState('');
  const [readerError, setReaderError] = useState<string | undefined>();
  const [status, setStatus] = useState('正在打开本地知识库…');
  const [listLoading, setListLoading] = useState(true);
  const [readerLoading, setReaderLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [collectionUrl, setCollectionUrl] = useState('https://www.zhihu.com/collection/REDACTED_COLLECTION_ID');
  const [documentUrl, setDocumentUrl] = useState('https://www.zhihu.com/');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const readerPaneRef = useRef<HTMLElement>(null);
  const articleBodyRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedStatus = useRef<string | undefined>(undefined);
  const [syncJob, setSyncJob] = useState<Awaited<ReturnType<typeof window.desktop.startZhihuSync>>['job']>();

  useEffect(() => {
    if (!syncJob?.id) return undefined;
    const timer = window.setInterval(() => {
      void window.desktop.getZhihuSyncStatus(syncJob.id).then((result) => {
        if (result.job) setSyncJob(result.job);
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [syncJob?.id]);

  const syncActive = syncJob && ['queued', 'running', 'paused'].includes(syncJob.status);
  const syncProgress = syncJob?.payload.progress;
  const syncFailures = syncJob?.payload.items?.filter((item) => item.status === 'failed') ?? [];
  const syncCreated = syncJob?.payload.items?.filter((item) => item.status === 'completed' && item.created).length ?? 0;
  const syncUpdated = syncJob?.payload.items?.filter((item) => item.status === 'completed' && item.versionCreated && !item.created).length ?? 0;

  const selectedDocument = useMemo(() => documents.find((document) => document.id === selectedId) ?? null, [documents, selectedId]);
  const filterLabel = FILTERS.find((item) => item.key === filter)?.label ?? 'Inbox';

  const loadList = useCallback(async (preferredId?: string | null) => {
    setListLoading(true);
    const result = await window.desktop.readerBootstrap({ filter, query, sort, limit: 10000 });
    if (!result.ok) {
      setStatus(errorLabel(result.error));
      setDocuments([]);
      setTags([]);
      setListLoading(false);
      return;
    }
    const nextDocuments = result.documents ?? [];
    setDocuments(nextDocuments);
    setTags(result.tags ?? []);
    setSelectedId((current) => {
      if (current && nextDocuments.some((document) => document.id === current)) return current;
      if (preferredId && nextDocuments.some((document) => document.id === preferredId)) return preferredId;
      const restoredId = result.session?.selectedDocumentId;
      if (restoredId && nextDocuments.some((document) => document.id === restoredId)) return restoredId;
      return nextDocuments[0]?.id ?? null;
    });
    setStatus(`${nextDocuments.length} 篇本地内容 · 离线可读`);
    setListLoading(false);
  }, [filter, query, sort]);

  useEffect(() => {
    const syncStatus = syncJob?.status;
    if (!syncStatus) return;
    if (lastSyncedStatus.current === syncStatus) return;
    lastSyncedStatus.current = syncStatus;
    if (!['completed', 'stopped', 'cancelled', 'failed'].includes(syncStatus)) return;
    if (syncStatus === 'completed') setStatus(`同步完成：新增 ${syncCreated} 篇，更新 ${syncUpdated} 篇，跳过 ${syncProgress?.skipped ?? 0} 篇`);
    else setStatus(`同步${syncStatusLabel(syncStatus)}：${syncFailureLabel(syncJob?.lastError ?? syncJob?.payload.failureType)}`);
    void loadList();
  }, [loadList, syncCreated, syncJob?.lastError, syncJob?.payload.failureType, syncJob?.status, syncProgress?.skipped, syncUpdated]);

  useEffect(() => {
    let active = true;
    void window.desktop.ping().then(({ ok, database }) => {
      if (!active) return;
      setStatus(!ok ? 'IPC 不可用' : database.ok ? `本地数据库 schema v${database.schemaVersion}` : errorLabel(database.error));
      if (new URLSearchParams(window.location.search).has('smoke')) void window.desktop.smokeReady();
    }).catch(() => { if (active) setStatus('IPC 连接失败'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadList(), 120);
    return () => clearTimeout(timer);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setReader(null);
      setReaderError(undefined);
      return;
    }
    let active = true;
    setReaderLoading(true);
    setReaderError(undefined);
    void window.desktop.getReaderDocument(selectedId, selectedVersionId).then((result) => {
      if (!active) return;
      if (!result.ok || !result.document) {
        setReader(null);
        setReaderError(result.error ?? 'document_not_found');
        return;
      }
      setReader(result.document);
      void window.desktop.saveReaderSession(selectedId);
    }).catch(() => { if (active) { setReader(null); setReaderError('database_read_failed'); } }).finally(() => {
      if (active) setReaderLoading(false);
    });
    return () => { active = false; };
  }, [selectedId, selectedVersionId]);

  useEffect(() => {
    setSelectedVersionId(null);
    setSelection(null);
  }, [selectedId]);

  useEffect(() => {
    if (reader && readerPaneRef.current) readerPaneRef.current.scrollTop = reader.scrollTop;
  }, [reader]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (!documents.length) return;
      const index = selectedId ? documents.findIndex((document) => document.id === selectedId) : -1;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedId(documents[Math.min(documents.length - 1, index + 1)].id);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedId(documents[Math.max(0, index - 1)].id);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [documents, selectedId]);

  function saveState(input: { status?: string; favorite?: boolean; knowledgeLevel?: string; scrollTop?: number }) {
    if (!reader) return;
    void window.desktop.saveReadingState({ documentId: reader.id, ...input }).then((result) => {
      if (!result.ok || !result.state) {
        setStatus(errorLabel(result.error));
        return;
      }
      const nextState = result.state;
      const nextStatus = ['unread', 'reading', 'processed', 'archived'].includes(nextState.status) ? nextState.status as ReaderDocument['status'] : reader.status;
      setReader((current) => current?.id === reader.id ? { ...current, status: nextStatus, favorite: nextState.favorite, knowledgeLevel: nextState.knowledgeLevel, scrollTop: nextState.scrollTop } : current);
      setDocuments((current) => current.map((document) => document.id === reader.id ? { ...document, status: nextStatus, favorite: nextState.favorite, knowledgeLevel: nextState.knowledgeLevel } : document));
    }).catch(() => setStatus('阅读状态保存失败，正文仍可继续阅读。'));
  }

  function onReaderScroll() {
    if (!reader || !readerPaneRef.current) return;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    const scrollTop = readerPaneRef.current.scrollTop;
    scrollTimer.current = setTimeout(() => saveState({ scrollTop }), 350);
  }

  function reloadReader() {
    if (!reader) return;
    void window.desktop.getReaderDocument(reader.id, reader.versionId).then((result) => {
      if (result.ok && result.document) setReader(result.document);
      else setStatus(errorLabel(result.error));
    }).catch(() => setStatus('标注刷新失败，数据仍保存在本机。'));
  }

  function addHighlight() {
    if (!reader || !selection) return;
    void window.desktop.createHighlight({ documentId: reader.id, documentVersionId: reader.versionId, ...selection, color: highlightColor }).then((result) => {
      if (!result.ok) { setStatus(errorLabel(result.error)); return; }
      setSelection(null); reloadReader();
    }).catch(() => setStatus('高亮保存失败，正文仍可继续阅读。'));
  }

  function addNote() {
    if (!reader || !selection || !noteBody.trim()) return;
    void window.desktop.createNote({ documentId: reader.id, documentVersionId: reader.versionId, ...selection, body: noteBody.trim() }).then((result) => {
      if (!result.ok) { setStatus(errorLabel(result.error)); return; }
      setSelection(null); setNoteBody(''); reloadReader();
    }).catch(() => setStatus('批注保存失败，正文仍可继续阅读。'));
  }

  function addTag() {
    if (!reader || !tagName.trim()) return;
    void window.desktop.addDocumentTag(reader.id, tagName.trim()).then((result) => {
      if (!result.ok) { setStatus(errorLabel(result.error)); return; }
      setTagName(''); reloadReader(); void loadList(reader.id);
    }).catch(() => setStatus('标签保存失败。'));
  }

  function showImportResult(result: { ok: boolean; status: string; versionCreated?: boolean; error?: string }) {
    setStatus(result.ok ? `导入完成：${result.versionCreated ? '已写入新版本' : '内容未变化，已复用本地版本'}` : `导入未完成：${result.status}${result.error ? `（${result.error}）` : ''}`);
    void loadList();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">K</span>
          <div><h1>Knowledge Library</h1><span>本地知识阅读器</span></div>
        </div>
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者、正文、标签、批注" aria-label="搜索本地知识" />
          <kbd>⌘ K</kbd>
        </label>
        <div className="top-actions">
          <details className="import-menu">
            <summary>导入</summary>
            <div className="import-popover">
              <label>知乎 URL<input value={documentUrl} onChange={(event) => setDocumentUrl(event.target.value)} /></label>
              <button type="button" disabled={importing} onClick={() => {
                setImporting(true); setStatus('正在读取并清洗正文…');
                void window.desktop.importDocumentUrl(documentUrl).then(showImportResult).catch(() => setStatus('URL 导入失败')).finally(() => setImporting(false));
              }}>导入 URL</button>
              <label>Markdown / HTML 文件<input type="file" accept=".md,.markdown,.html,.htm,text/markdown,text/html" disabled={importing} onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const kind = /\.html?$/i.test(file.name) ? 'html' : 'markdown';
                setImporting(true); setStatus('正在清洗并保存文件正文…');
                void file.text().then((content) => window.desktop.importDocumentFile({ name: file.name, kind, content })).then(showImportResult).catch(() => setStatus('文件导入失败')).finally(() => { setImporting(false); event.target.value = ''; });
              }} /></label>
              <div className="import-actions"><button type="button" onClick={() => void window.desktop.loginZhihu().then(() => setStatus('已打开知乎登录窗口；Cookie 仅保存在本机隔离 session'))}>登录知乎</button><button type="button" disabled={capturing} onClick={() => {
                setCapturing(true); setStatus('正在低频读取收藏夹样本…');
                void window.desktop.captureZhihuCollection(collectionUrl).then((result) => setStatus(result.ok ? `读取完成：${result.itemCount} 条，${result.pageCount} 页` : `读取停止：${result.failureType ?? '未知失败'}`)).catch(() => setStatus('收藏夹读取失败')).finally(() => setCapturing(false));
              }}>读取收藏夹</button></div>
              <label>收藏夹 / 专栏 / 赞同活动 URL<input value={collectionUrl} onChange={(event) => setCollectionUrl(event.target.value)} /></label>
              <small>同步支持 /collection/、公开专栏和 /people/用户名/activities；抓取后的正文会进入本地阅读器。</small>
              <button type="button" disabled={Boolean(syncActive)} onClick={() => {
                void window.desktop.startZhihuSync(collectionUrl).then((result) => {
                  if (result.job) { setSyncJob(result.job); setStatus('同步已开始：串行读取并保存正文'); }
                  else setStatus(`同步未开始：${result.error ?? '未知错误'}`);
                });
              }}>开始增量同步</button>
              {syncJob && <div>
                <p role="status">同步状态：{syncStatusLabel(syncJob.status)}；已处理 {(syncProgress?.completed ?? 0) + (syncProgress?.skipped ?? 0)}/{syncProgress?.total ?? 0}，新增 {syncCreated}，更新 {syncUpdated}，跳过 {syncProgress?.skipped ?? 0}，失败 {syncProgress?.failed ?? 0}，剩余 {syncProgress?.remaining ?? 0}；请求 {syncJob.payload.accessLog?.length ?? 0} 次</p>
                {['stopped', 'cancelled', 'failed'].includes(syncJob.status) && <p className="sync-warning">{syncFailureLabel(syncJob.lastError ?? syncJob.payload.failureType)}</p>}
                {syncJob.status === 'running' && <button type="button" onClick={() => void window.desktop.pauseZhihuSync(syncJob.id).then((result) => result.job && setSyncJob(result.job))}>暂停</button>}
                {syncJob.status === 'paused' && <button type="button" onClick={() => void window.desktop.resumeZhihuSync(syncJob.id).then((result) => result.job && setSyncJob(result.job))}>继续</button>}
                {syncActive && <button type="button" onClick={() => void window.desktop.cancelZhihuSync(syncJob.id).then((result) => result.job && setSyncJob(result.job))}>取消同步</button>}
                {syncFailures.length > 0 && <ul aria-label="同步失败列表">{syncFailures.map((item) => <li key={item.externalId}>{item.externalId}：{item.failureType ?? 'unknown'} <button type="button" onClick={() => void window.desktop.retryZhihuSyncItem({ jobId: syncJob.id, externalId: item.externalId }).then((result) => result.job && setSyncJob(result.job))}>重试</button></li>)}</ul>}
              </div>}
            </div>
          </details>
          <span className="connection-dot" title="本地数据库连接正常" />
        </div>
      </header>

      <section className="reader-grid">
        <aside className="sidebar panel" aria-label="内容筛选">
          <div className="panel-label">LIBRARY</div>
          <nav>{FILTERS.slice(0, 6).map((item) => <button key={item.key} className={filter === item.key ? 'nav-item active' : 'nav-item'} onClick={() => setFilter(item.key)}><span>{item.label}</span>{item.key === 'inbox' && <b>{documents.length}</b>}</button>)}</nav>
          <div className="panel-label section-label">知识层级</div>
          <nav>{FILTERS.slice(6).map((item) => <button key={item.key} className={filter === item.key ? 'nav-item active' : 'nav-item'} onClick={() => setFilter(item.key)}><span className="level-dot" />{item.label}</button>)}</nav>
          <div className="panel-label section-label">标签</div>
          <nav className="tag-nav">{tags.length ? tags.map((tag) => <button key={tag.id} className={filter === `tag:${tag.id}` ? 'nav-item active' : 'nav-item'} onClick={() => setFilter(`tag:${tag.id}`)}><span># {tag.name}</span><b>{tag.documentCount}</b></button>) : <p className="muted">导入内容后，标签会显示在这里</p>}</nav>
          <div className="sidebar-foot">{status}</div>
        </aside>

        <section className="list-panel panel" aria-label="内容列表">
          <div className="list-heading"><div><span className="eyebrow">{filter === 'inbox' ? 'ALL SAVED' : 'FILTERED VIEW'}</span><h2>{filterLabel}</h2></div><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="排序"><option value="updated">最近更新</option><option value="title">标题</option><option value="duration">阅读时长</option><option value="status">阅读状态</option></select></div>
          <div className="list-summary">{listLoading ? '正在加载…' : `${documents.length} 篇内容`}<span>↑↓ 键盘导航</span></div>
          <div className="document-list">
            {listLoading ? <div className="empty-state compact"><span className="loader" />正在读取本地索引…</div> : documents.length ? documents.map((document) => <button type="button" key={document.id} className={selectedId === document.id ? 'document-card selected' : 'document-card'} onClick={() => setSelectedId(document.id)}>
              <div className="card-top"><span className={`status-dot ${document.status}`} /> <span>{STATUS_LABELS[document.status]}</span><time>{formatDate(document.fetchedAt)}</time></div>
              <h3>{document.title || '无标题内容'}</h3>
              <p>{document.author || document.source} <span>·</span> {document.estimatedMinutes} 分钟</p>
              <div className="card-bottom"><span>{document.source}</span>{document.importError ? <span className="error-text">同步错误</span> : !document.hasBody ? <span className="error-text">正文为空</span> : document.favorite ? <span aria-label="已收藏">★</span> : null}</div>
            </button>) : <div className="empty-state"><strong>{query ? '没有匹配的本地内容' : '这里还没有内容'}</strong><span>{query ? '尝试更换关键词或筛选条件。' : '使用右上角导入 Markdown、HTML 或知乎正文。'}</span></div>}
          </div>
        </section>

        <article className="article-panel panel" aria-label="正文阅读区" ref={readerPaneRef} onScroll={onReaderScroll}>
          {readerLoading ? <div className="empty-state article-empty"><span className="loader" />正在打开正文…</div> : readerError ? <div className="empty-state article-empty"><span className="empty-icon">!</span><strong>{errorLabel(readerError)}</strong><span>列表仍可继续使用，稍后可以重新选择内容。</span></div> : reader ? <>
            <div className="article-header"><div className="article-source"><span className="source-icon">{reader.source.slice(0, 1).toUpperCase()}</span><span>{reader.source} · {formatDate(reader.fetchedAt)}</span></div><div className="article-actions"><button type="button" className={reader.favorite ? 'icon-button favorite' : 'icon-button'} onClick={() => saveState({ favorite: !reader.favorite })} aria-label={reader.favorite ? '取消收藏' : '收藏'}>{reader.favorite ? '★' : '☆'}</button><select className="state-button" value={reader.status} onChange={(event) => saveState({ status: event.target.value })} aria-label="阅读状态"><option value="unread">未读</option><option value="reading">阅读中</option><option value="processed">已处理</option><option value="archived">已归档</option></select><select className="state-button" value={reader.knowledgeLevel} onChange={(event) => saveState({ knowledgeLevel: event.target.value })} aria-label="知识层级"><option value="">未分层</option><option value="short">短期消费</option><option value="medium">中期实践</option><option value="long">长期内化</option></select><select className="state-button" value={reader.versionId} onChange={(event) => setSelectedVersionId(event.target.value)} aria-label="正文版本">{reader.versions.map((version) => <option key={version.versionId} value={version.versionId}>v{version.versionNumber}{version.isCurrent ? ' 当前' : ''}</option>)}</select></div></div>
            <h2 className="article-title">{reader.title || '无标题内容'}</h2>
            <div className="article-meta"><span>{reader.author || '作者未知'}</span><span>{reader.estimatedMinutes} 分钟阅读</span><span className={`state-pill ${reader.status}`}>{STATUS_LABELS[reader.status]}</span>{reader.knowledgeLevel && <span className="level-pill">{LEVEL_LABELS[reader.knowledgeLevel]}</span>}</div>
            {reader.importError && <div className="sync-warning">同步记录：{reader.importError}。已保存的正文仍可离线阅读。</div>}
            {reader.bodyState !== 'ok' ? <div className="empty-state body-empty"><span className="empty-icon">{reader.bodyState === 'corrupt' ? '!' : '∅'}</span><strong>{reader.bodyState === 'corrupt' ? '正文损坏' : '正文为空'}</strong><span>该条内容没有可安全显示的离线正文。</span></div> : <div ref={articleBodyRef} className="article-body" onMouseUp={() => { if (articleBodyRef.current) setSelection(selectedTextAnchor(articleBodyRef.current)); }} dangerouslySetInnerHTML={{ __html: safeReaderHtml(reader.body) }} />}
            {selection && <div className="annotation-toolbar"><span>已选择 {selection.exact.length} 字</span><select value={highlightColor} onChange={(event) => setHighlightColor(event.target.value)} aria-label="高亮颜色"><option value="yellow">黄色</option><option value="blue">蓝色</option><option value="green">绿色</option><option value="pink">粉色</option></select><button type="button" onClick={addHighlight}>高亮</button><input value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="批注内容" aria-label="批注内容" /><button type="button" disabled={!noteBody.trim()} onClick={addNote}>添加批注</button><button type="button" onClick={() => setSelection(null)}>取消</button></div>}
            <div className="article-extras">
              <section><h3>标签</h3><div className="tag-list">{reader.tags.map((tag) => <span key={tag.id}># {tag.name} <button type="button" onClick={() => { const next = window.prompt('编辑标签', tag.name); if (next?.trim()) void window.desktop.renameDocumentTag(tag.id, next.trim()).then(reloadReader).then(() => void loadList(reader.id)); }} aria-label={`编辑标签 ${tag.name}`}>编辑</button><button type="button" onClick={() => { if (window.confirm(`删除标签“${tag.name}”？`)) void window.desktop.removeDocumentTag(reader.id, tag.id).then(reloadReader); }} aria-label={`删除标签 ${tag.name}`}>×</button></span>)}<input value={tagName} onChange={(event) => setTagName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addTag(); }} placeholder="添加标签" aria-label="添加标签" /><button type="button" disabled={!tagName.trim()} onClick={addTag}>添加</button></div></section>
              {reader.highlights.length > 0 && <section><h3>标注</h3>{reader.highlights.map((highlight) => <blockquote key={highlight.id} className={`highlight-${highlight.color}`}><span>{highlight.quote}</span>{highlight.status === 'needs_repair' && <small>待修复</small>}<select value={highlight.color} onChange={(event) => void window.desktop.updateHighlight(highlight.id, { color: event.target.value }).then(reloadReader)} aria-label="高亮颜色"><option value="yellow">黄</option><option value="blue">蓝</option><option value="green">绿</option><option value="pink">粉</option></select><button type="button" onClick={() => { if (window.confirm('删除这条高亮？')) void window.desktop.deleteHighlight(highlight.id).then(reloadReader); }}>删除</button></blockquote>)}</section>}
              {reader.notes.length > 0 && <section><h3>批注</h3>{reader.notes.map((note) => <p key={note.id}><span>{note.body}</span>{note.status === 'needs_repair' && <small>待修复</small>}<button type="button" onClick={() => { const next = window.prompt('编辑批注', note.body); if (next != null && next.trim()) void window.desktop.updateNote(note.id, next.trim()).then(reloadReader); }}>编辑</button><button type="button" onClick={() => { if (window.confirm('删除这条批注？')) void window.desktop.deleteNote(note.id).then(reloadReader); }}>删除</button></p>)}</section>}
              {reader.processingResults.length > 0 && <section><h3>处理结果</h3>{reader.processingResults.slice(0, 3).map((result) => <div className="processing-result" key={result.id}><b>{result.kind}</b><span>{result.status}</span><p>{typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload)}</p></div>)}</section>}
            </div>
          </> : <div className="empty-state article-empty"><span className="empty-icon">✦</span><strong>选择一篇内容开始阅读</strong><span>正文、标注和阅读进度都保存在本机。</span></div>}
        </article>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
