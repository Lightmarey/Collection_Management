# 收藏夹管理

一个本地优先的桌面收藏夹管理与阅读应用。它把不同来源的收藏内容统一保存到本地，提供增量同步、离线阅读、全文搜索、标签、知识层级、高亮、批注和数据备份。

## 主要功能

- 多来源收藏内容导入，以及增量、全量和单条同步
- SQLite 本地存储、全文搜索和内容版本记录
- 图片、SVG 与公式离线保存和渲染
- 列表、表格和沉浸式阅读视图
- 标签、收藏、短期/中期/长期分类与归档
- 高亮、批注、标注总览和稳健文本定位
- 安装版与便携版，以及本地数据备份和恢复

## 开发

```text
npm ci
npm start
```

检查与打包：

```text
npm run typecheck
npm test
npm run test:smoke
npm run make
```

架构与安全边界见 [docs/architecture.md](docs/architecture.md) 和 [docs/electron-security-checklist.md](docs/electron-security-checklist.md)。

## 许可证

本项目采用 [GNU Affero General Public License v3.0](LICENSE)，SPDX 标识为 `AGPL-3.0-only`。
