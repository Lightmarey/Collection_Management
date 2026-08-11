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
    database_read_failed: '读取本地数据失败。',
    document_not_found: '文档已不存在或已被删除。',
    corrupt: '正文数据损坏，无法安全显示。',
  }[error ?? ''] ?? '本地阅读数据暂时不可用。';
}

function safeReaderHtml(body: string) {
  return DOMPurify.sanitize(body, {
    FORBID_TAGS: ['base', 'embed', 'form', 'iframe', 'input', 'link', 'meta', 'object', 'script', 'style', 'svg', 'template'],
    FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload'],
  });
}

function App() {
  const [filter, setFilter] = useState('inbox');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'title' | 'duration' | 'status'>('updated');
  const [documents, setDocuments] = useState<ReaderListItem[]>([]);
  const [tags, setTags] = useState<ReaderTag[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reader, setReader] = useState<ReaderDocument | null>(null);
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
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedDocument = useMemo(() => documents.find((document) => document.id === selectedId) ?? null, [documents, selectedId]);
  const filterLabel = FILTERS.find((item) => item.key === filter)?.label ?? 'Inbox';

  const loadList = useCallback(async (preferredId?: string | null) => {
    setListLoading(true);
    const result = await window.desktop.readerBootstrap({ filter, query, sort, limit: 120 });
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
    let active = true;
    void window.desktop.ping().then(({ ok, database }) => {
      if (!active) return;
      setStatus(!ok ? 'IPC 不可用' : database.ok ? `本地数据库 schema v${database.schemaVersion}` : errorLabel('database_unavailable'));
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
    void window.desktop.getReaderDocument(selectedId).then((result) => {
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
              <label>收藏夹 URL<input value={collectionUrl} onChange={(event) => setCollectionUrl(event.target.value)} /></label>
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
            <div className="article-header"><div className="article-source"><span className="source-icon">{reader.source.slice(0, 1).toUpperCase()}</span><span>{reader.source} · {formatDate(reader.fetchedAt)}</span></div><div className="article-actions"><button type="button" className={reader.favorite ? 'icon-button favorite' : 'icon-button'} onClick={() => saveState({ favorite: !reader.favorite })} aria-label={reader.favorite ? '取消收藏' : '收藏'}>{reader.favorite ? '★' : '☆'}</button><select className="state-button" value={reader.status} onChange={(event) => saveState({ status: event.target.value })} aria-label="阅读状态"><option value="unread">未读</option><option value="reading">阅读中</option><option value="processed">已处理</option><option value="archived">已归档</option></select><select className="state-button" value={reader.knowledgeLevel} onChange={(event) => saveState({ knowledgeLevel: event.target.value })} aria-label="知识层级"><option value="">未分层</option><option value="short">短期消费</option><option value="medium">中期实践</option><option value="long">长期内化</option></select></div></div>
            <h2 className="article-title">{reader.title || '无标题内容'}</h2>
            <div className="article-meta"><span>{reader.author || '作者未知'}</span><span>{reader.estimatedMinutes} 分钟阅读</span><span className={`state-pill ${reader.status}`}>{STATUS_LABELS[reader.status]}</span>{reader.knowledgeLevel && <span className="level-pill">{LEVEL_LABELS[reader.knowledgeLevel]}</span>}</div>
            {reader.importError && <div className="sync-warning">同步记录：{reader.importError}。已保存的正文仍可离线阅读。</div>}
            {reader.bodyState !== 'ok' ? <div className="empty-state body-empty"><span className="empty-icon">{reader.bodyState === 'corrupt' ? '!' : '∅'}</span><strong>{reader.bodyState === 'corrupt' ? '正文损坏' : '正文为空'}</strong><span>该条内容没有可安全显示的离线正文。</span></div> : <div className="article-body" dangerouslySetInnerHTML={{ __html: safeReaderHtml(reader.body) }} />}
            {(reader.tags.length > 0 || reader.highlights.length > 0 || reader.notes.length > 0 || reader.processingResults.length > 0) && <div className="article-extras">
              {reader.tags.length > 0 && <section><h3>标签</h3><div className="tag-list">{reader.tags.map((tag) => <span key={tag.id}># {tag.name}</span>)}</div></section>}
              {reader.highlights.length > 0 && <section><h3>标注</h3>{reader.highlights.map((highlight) => <blockquote key={highlight.id}>{highlight.quote}</blockquote>)}</section>}
              {reader.notes.length > 0 && <section><h3>批注</h3>{reader.notes.map((note) => <p key={note.id}>{note.body}</p>)}</section>}
              {reader.processingResults.length > 0 && <section><h3>处理结果</h3>{reader.processingResults.slice(0, 3).map((result) => <div className="processing-result" key={result.id}><b>{result.kind}</b><span>{result.status}</span><p>{typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload)}</p></div>)}</section>}
            </div>}
          </> : <div className="empty-state article-empty"><span className="empty-icon">✦</span><strong>选择一篇内容开始阅读</strong><span>正文、标注和阅读进度都保存在本机。</span></div>}
        </article>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
