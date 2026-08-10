import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './renderer.css';

function App() {
  const [status, setStatus] = useState('连接中…');
  const [collectionUrl, setCollectionUrl] = useState('https://www.zhihu.com/collection/REDACTED_COLLECTION_ID');
  const [documentUrl, setDocumentUrl] = useState('https://www.zhihu.com/');
  const [capturing, setCapturing] = useState(false);
  const [importing, setImporting] = useState(false);

  function showImportResult(result: { ok: boolean; status: string; versionCreated?: boolean; error?: string }) {
    setStatus(result.ok ? `导入完成：${result.versionCreated ? '已写入新版本' : '内容未变化，已幂等复用'}` : `导入未完成：${result.status}${result.error ? `（${result.error}）` : ''}`);
  }

  useEffect(() => {
    void window.desktop.ping().then(({ ok, database }) => {
      setStatus(!ok ? 'IPC 不可用' : database.ok ? `本地 IPC 已连接，数据库 schema v${database.schemaVersion}` : database.error ?? '数据库不可用');
      if (new URLSearchParams(window.location.search).has('smoke')) void window.desktop.smokeReady();
    }).catch(() => setStatus('IPC 连接失败'));
  }, []);

  return (
    <main>
      <h1>Knowledge Management</h1>
      <p>{(capturing || importing) && <span className="progress" aria-label="处理中" />} {status}</p>
      <h2>导入正文</h2>
      <label>
        知乎 URL
        <input value={documentUrl} onChange={(event) => setDocumentUrl(event.target.value)} />
      </label>
      <button type="button" disabled={importing} onClick={() => {
        setImporting(true);
        setStatus('正在通过隔离 session 读取用户主动提供的 URL…');
        void window.desktop.importDocumentUrl(documentUrl).then(showImportResult).catch(() => setStatus('URL 导入失败')).finally(() => setImporting(false));
      }}>
        导入 URL 正文
      </button>
      <label>
        Markdown / HTML 文件
        <input type="file" accept=".md,.markdown,.html,.htm,text/markdown,text/html" disabled={importing} onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const kind = /\.html?$/i.test(file.name) ? 'html' : 'markdown';
          setImporting(true);
          setStatus('正在清洗并保存文件正文…');
          void file.text().then((content) => window.desktop.importDocumentFile({ name: file.name, kind, content })).then(showImportResult).catch(() => setStatus('文件导入失败')).finally(() => {
            setImporting(false);
            event.target.value = '';
          });
        }} />
      </label>
      <button type="button" onClick={() => void window.desktop.loginZhihu().then(() => setStatus('已打开登录窗口；登录完成后可关闭窗口，session 会在本机长期保留'))}>
        登录知乎
      </button>
      <button type="button" onClick={() => void window.desktop.zhihuSessionSummary().then(({ cookieCount }) => setStatus(`隔离 session 已保存 ${cookieCount} 个 Cookie（仅显示数量）`))}>
        检查隔离 session
      </button>
      <label>
        收藏夹 URL
        <input value={collectionUrl} onChange={(event) => setCollectionUrl(event.target.value)} />
      </label>
      <button type="button" disabled={capturing} onClick={() => {
        setCapturing(true);
        setStatus('正在按 API 分页低频读取，最多 20 条…');
        void window.desktop.captureZhihuCollection(collectionUrl)
          .then((result) => setStatus(result.ok
            ? `读取完成：${result.itemCount} 条脱敏样本，${result.pageCount} 页${result.truncated ? '（已达到 20 条上限）' : ''}`
            : `读取停止：${result.failureType ?? '未知失败'}，已保留 ${result.itemCount} 条脱敏样本`))
          .catch((error) => setStatus(error instanceof Error ? error.message : '读取失败'))
          .finally(() => setCapturing(false));
      }}>
        读取 20 条脱敏样本
      </button>
      {capturing && <button type="button" onClick={() => void window.desktop.stopZhihuCapture().then(() => setStatus('已请求停止，将在当前请求完成后停止'))}>
        停止读取
      </button>}
      <small>使用隔离 persist:zhihu-m0 session 在后台读取；不会打开知乎窗口，也不会向 UI 暴露 Cookie、Token 或原始 ipcRenderer。</small>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
