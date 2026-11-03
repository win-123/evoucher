# EVoucher X —— 电子凭证库客户端（跨平台重建版）

基于对原版 Win32 客户端（CTJSoft EVoucherClient v3.0.0.0）的逆向证据重建，
同一套代码支持 **三种运行形态**：

| 形态 | 命令 | 产物 |
|---|---|---|
| 🌐 Web（浏览器直接打开） | `npm install && npm run web` | http://localhost:8721 |
| 🪟 Windows exe | `npm run dist:win` | `release/EVoucherX-Setup-x.y.z.exe`（NSIS 安装包 + 便携版） |
| 🍎 macOS dmg | `npm run dist:mac` | `release/EVoucherX-x.y.z-arm64.dmg` |

## 功能（对照逆向报告 docs/reverse-engineering-report.md）

- 凭证列表 / 搜索 / 加载（原 `CEvouchersList::InitVouchers`、`GetVoucherAndSign`）
- PDF 预览、翻页、缩放（原 iStylePDF.ocx → pdf.js）
- 联次切换（上一联/下一联，原「无此凭证联」逻辑）
- 打印与打印次数回传（`AddPrintTimes`）
- 盖章 / 验签（`SignStampByNos`、`verfiyVoucherOriginal`；Mock 实现，原生 UKey 预留 Provider 接口）
- 上传回传 / 确认 / 作废 / 退回（`SaveStampVoucher`、`ConfirmVoucher`、`DiscardVoucher`、`ReturnVoucher`）
- 附件管理协议方法、行政区划/单位字典、二维码（`Get2DCode`）
- 服务配置（服务地址 / HTTP·WS·Mock 三模式，对应 `CConfigure`）
- 操作日志（对应 `COperationLog`）

## 结构

```
app/       前端（纯 ES Modules + pdf.js，无构建链）
server/    本地服务（express；Providers = Mock / RealHTTP / 预留 WS）
electron/  桌面壳（Electron 主进程）
docs/      逆向证据报告 + 设计方案
```

## 服务协议

`GET/POST /api/evoucher/<方法名>` —— 方法名与原版
`CEvoucherHttpClient` 的 65 个协议方法一一对应（见报告 §3），
例如 `POST /api/evoucher/DownLoadVouchers`。

## 桌面打包注意

- Electron 依赖较大（约 200MB），首次 `npm install` 全量安装后再执行 dist。
- Windows 出包需在 Windows 或 CI（GitHub Actions windows-latest）上运行。
- 签章/UKey 属硬件能力，桌面包内为 Mock；接入真实驱动时实现
  `server/providers.js` 中的 SignStampProvider 即可。
