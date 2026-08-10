import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './renderer.css';

function App() {
  const [status, setStatus] = useState('连接中…');

  useEffect(() => {
    void window.desktop.ping().then(({ ok }) => {
      setStatus(ok ? '本地 IPC 已连接' : 'IPC 不可用');
      if (new URLSearchParams(window.location.search).has('smoke')) void window.desktop.smokeReady();
    }).catch(() => setStatus('IPC 连接失败'));
  }, []);

  return (
    <main>
      <h1>Knowledge Management</h1>
      <p>{status}</p>
      <button type="button" onClick={() => void window.desktop.openZhihu()}>
        打开隔离知乎窗口
      </button>
      <small>远程窗口使用独立 persist:zhihu-m0 session；不会向 UI 暴露 Cookie、Token 或原始 ipcRenderer。</small>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
