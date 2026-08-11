import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './renderer.css';

function App() {
  const [status, setStatus] = useState('连接中…');
  const [collectionUrl, setCollectionUrl] = useState('https://www.zhihu.com/collection/REDACTED_COLLECTION_ID');
  const [documentUrl, setDocumentUrl] = useState('https://www.zhihu.com/');
  const [capturing, setCapturing] = useState(false);
  const [importing, setImporting] = useState(false);
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
        收藏夹 / 专栏 / 赞同活动 URL
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
      <h2>知乎来源增量同步</h2>
      <small>支持收藏夹（/collection/）、公开专栏（zhuanlan.zhihu.com/专栏名）和赞同活动（/people/用户名/activities）。</small>
      <button type="button" disabled={Boolean(syncActive)} onClick={() => {
        void window.desktop.startZhihuSync(collectionUrl).then((result) => {
          if (result.job) {
            setSyncJob(result.job);
            setStatus('同步已开始：串行读取并保存正文');
          } else setStatus(`同步未开始：${result.error ?? '未知错误'}`);
        });
      }}>
        开始增量同步
      </button>
      {syncJob && <>
        <p>
          同步状态：{syncJob.status}；已完成 {syncProgress?.completed ?? 0}/{syncProgress?.total ?? 0}，失败 {syncProgress?.failed ?? 0}，剩余 {syncProgress?.remaining ?? 0}；请求 {syncJob.payload.accessLog?.length ?? 0} 次
        </p>
        {syncJob.status === 'running' && <button type="button" onClick={() => void window.desktop.pauseZhihuSync(syncJob.id).then((result) => result.job && setSyncJob(result.job))}>暂停</button>}
        {syncJob.status === 'paused' && <button type="button" onClick={() => void window.desktop.resumeZhihuSync(syncJob.id).then((result) => result.job && setSyncJob(result.job))}>继续</button>}
        {syncActive && <button type="button" onClick={() => void window.desktop.cancelZhihuSync(syncJob.id).then((result) => result.job && setSyncJob(result.job))}>取消同步</button>}
        {syncFailures.length > 0 && <ul aria-label="同步失败列表">
          {syncFailures.map((item) => <li key={item.externalId}>
            {item.externalId}：{item.failureType ?? 'unknown'}
            <button type="button" onClick={() => void window.desktop.retryZhihuSyncItem({ jobId: syncJob.id, externalId: item.externalId }).then((result) => result.job && setSyncJob(result.job))}>重试</button>
          </li>)}
        </ul>}
      </>}
      <small>使用隔离 persist:zhihu-m0 session 在后台读取；不会打开知乎窗口，也不会向 UI 暴露 Cookie、Token 或原始 ipcRenderer。</small>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
