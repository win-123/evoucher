# EVoucherX 设计方案（exe / dmg / web 三形态）

## 目标

将逆向还原的「电子凭证库客户端」（原 Win32 MFC 程序）重建为：

1. **Web 应用**：`npm run web` 后浏览器直接打开 `http://localhost:8721`
2. **Windows exe**：electron-builder → NSIS 安装包 / 便携 exe
3. **macOS dmg**：electron-builder → dmg

## 架构

```
┌─────────────────────────────────────────────┐
│  UI（app/ 纯 ES Modules + pdf.js）           │
│  菜单栏/工具栏/凭证列表/PDF 预览/签章信息面板   │
└──────────────┬──────────────────────────────┘
               │ HTTP JSON (/api/*)  ← web 与桌面共用同一服务
┌──────────────┴──────────────────────────────┐
│  本地服务（server/ Node.js）                  │
│  · EvoucherService：凭证/模板/附件/日志       │
│  · ClientProvider：HTTP 客户端 | WS 客户端 |  │
│    Mock（对应原版 GetModefromH 三模式）        │
│  · SignStampProvider：mock | 原生 UKey 适配位  │
│    （对应 sign_stamp_opt_geer / _jn）         │
└─────────────────────────────────────────────┘
桌面形态：electron/ 主进程 = 启动同一 server + BrowserWindow
```

## 运行方式

| 形态 | 命令 | 说明 |
|---|---|---|
| Web | `npm run web` | 浏览器打开 http://localhost:8721 |
| 桌面(开发) | `npm start` | Electron 窗口加载同一服务 |
| Windows 包 | `npm run dist:win` | 产出 NSIS exe + 便携 exe |
| macOS 包 | `npm run dist:mac` | 产出 dmg |

## 与原版的映射（逆向证据 → 重建实现）

| 原版 | 重建 |
|---|---|
| EVoucherClient.exe（MFC 主窗口） | UI 壳（浏览器页 / Electron 窗口） |
| iStylePDF.ocx PDF 视图 | pdf.js 渲染 |
| EVoucherDLL.dll CEvoucherHttpClient(65 方法) | server/adapters/evoucher-client.js |
| CConfigure（服务地址/模式） | 设置页 + server/config.json |
| sign_stamp_opt_geer/_jn | SignStampProvider 接口 + Mock |
| eLog/COperationLog | server 日志 + 操作日志 API |

## 方法集实现状态

Mock Provider 先实现协议骨架全量（65 个方法全部有名有响应结构），
真实 HTTP Provider 逐步对接真实凭证服务器（字段来自报文解析逻辑）。
