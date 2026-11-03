# EVoucherClient.exe 逆向证据报告（基于 rea + Ghidra + 静态解析）

> 分析对象：`/Users/ztl/Desktop/EVoucher`（CTJSoft 财政电子凭证库客户端 v3.0.0.0，Win32 PE32/MFC100）
> 工具：rea 6.7.0（inspect-pe-resources / analyze）、Ghidra 11.4.2/12.1.4（headless）、objdump、自研 PE 解析器

## 1. 组件架构（证据：导入表 + 导出表 + 目录结构）

```
EVoucherClient.exe (MFC 容器, 398KB)
 ├─ 导入 EVoucherDLL.dll: eLog(info/error/setLevel), CCharCode::GbkToUtf8
 ├─ 导入 LIBEAY32/SSLEAY32 (OpenSSL), WS2_32 (网络), MFC100
 ├─ iStylePDF.ocx + library/istylepdfengine.dll + plugins/*  ← PDF 渲染/签名引擎（插件制）
 │    plugins: AcroForm, Annots, Attachment, CreatePDF, DigitalSignature,
 │             DocumentAssembly, Handwritting, Statistics, WebOpen
 ├─ EVoucherDLL.dll (1.4MB, 1076 个导出符号) ← 业务核心（下详）
 ├─ JEStamp.dll (2.6MB) + JEStampRes.dll ← 电子印章
 └─ UKey 驱动: CSS_UK_API*.dll, SmartKeyAPI.dll, UkeyCssApi.dll,
    SigOperAPI.dll, HTCSPApi.dll, sign_stamp_opt_geer(格尔)/sign_stamp_opt_jn
```

## 2. 业务类模型（证据：EVoucherDLL.dll 导出符号表，MSVC 修饰名）

| 类 | 方法数 | 职责（由方法名还原） |
|---|---|---|
| `CEvoucherHttpClient` | 65 | 凭证服务器 HTTP 客户端（完整协议，见 §3） |
| `CEvoucherWSClient` | 62 | 同一协议的 WebSocket 实现（`GetModefromH` 决定走哪条通道） |
| `CEvoucher` | 31 | 凭证实体：parseVoucher/parseSignXml/parseStampInfo/parsePrintInfo、SignStamp、VerifySignature/VerifyStamp、Generate2DCode（二维码） |
| `CEvouchersList` | 22 | 凭证集合：InitVouchers、SignStamp、VerifyStamp、AddStampedVoucher |
| `CEvoucherAndModel(List)` | 9 | 凭证+模板关联 |
| `CModel(sList/Map)` | - | 凭证模板 |
| `CSignStamp(Info)` | - | 签章结果（位置/时间/证书CN/序列号/有效性） |
| `CStampClientTool`, `sign_stamp_opt_geer/jn` | - | 印章客户端工具 / 格尔、济南 UKey 驱动 |
| `CPdfDoc`, `CPdfSignAPI` | - | PDF 文档操作与签名 |
| `CAttach`, `CEAttachList` | 16 | 附件：id/名/类型/大小/hash/进度/tmpPath |
| `CConfigure` | 20 | 配置：EVoucherServerURL、EstampServerURL、AttachHTTPServerURL、UpdateServerURL、ModefromH、IsPopUpErrMsg |
| `CHttpClient` | 5 | DownloadFile/UploadFile(带进度对话框) |
| `COperationLog`, `CLogInfo`, `eLog` | - | 操作日志 |
| `EVFObj`/`OEVFObj`, `JResult`, `Message_st` | - | 主对象与结果封装 |

## 3. 服务器协议方法全集（CEvoucherHttpClient，逆向还原）

```
下载:  DownLoadVouchers, GetVoucherAndSign, GetVoucherModel(ByVmId), GetVoucherTypes,
       GetVoucherSignPositions, GetVoucherStampPositions, GetVoucheStampedPositons,
       GetVoucherStampedInfo, queryDetailVoucherNo, getProgress
回传:  SendVoucher, SendVoucherFullSigns, SaveStampVoucher, SaveSignVoucher,
       SaveSignatureWithoutPos, CancelSignatureWithoutPos, CancelStamp,
       SignAndSendByServer, StampeAndSendByServer(WithoutPos), SignStampByNos
生命周期: ConfirmVoucher, ConfirmVoucherFail, DiscardVoucher, ReturnVoucher, AddPrintTimes
附件:  createAttachIDs, getAttachInfo(ForID), deleteAttachFor(No/ID), updateAttachInfo,
       reSendAttach, getAttachInfo
基础:  SetUserInfo/userName/userPwd, GetAdmDivCodes(行政区划), GetDecOrgList,
       GetEStampProvider, GetEStampServerUrl, GetServerVersion, GetCertMode,
       GetDate/GetTime, buildAssociation, cancelAssociation, transTrans,
       GetDisplayVirtualization, GetTestToolsParams, GetUpdateOCXStatus, Get2DCode,
       verfiyVoucherOriginal(验签原文), isVerify
```

## 4. UI 文案证据（GBK 字符串挖掘，示例）

- 界面：电子凭证库、凭证类型、凭证编号、明细凭证号、凭证日志、操作日志、签章/签名位置、签章人证书信息、签章证书CN/序列号、电子印章ID、上一联/下一联/上一页/下一页、自适应、打印当前
- 消息：连接凭证服务器失败、凭证库服务地址未设置、凭证报文不合法、无此凭证联、当前凭证为第一条/最后一条凭证、正在上传/下载、开始上传/下载、打印已取消、不支持后台批量打印、服务器签章失败！、章里证书与ukey证书不匹配，签章失败、调用格尔客户端接口签章失败，错误码[%d]
- iStylePDF 语言包（languages/istylepdf_cn.xml）：文件/编辑/视图/工具/帮助 菜单全量文案

## 5. 配置与运行时

- `configcon.xml`：Windows 计划任务，登录时启动 `configcon.vbs`（`C:\Program Files (x86)\CTJSoft\EVoucher\`）
- `sig_config.xml`/`istylepdf_config.xml`：PDF 签名与显示配置
- `engines/`：OpenSSL 引擎（4758cca/aep/atalla/chil/gost…，硬件加密机）
- `ca.pem/ca.key/rsaroot.cer`：根证书

## 6. 结论：重建边界

可直接复刻（跨平台）：凭证列表/加载/浏览（PDF）、联次切换、打印、模板管理、
服务器协议客户端（HTTP/WS）、附件、操作日志、配置管理。

需适配层隔离（原版为 Win32 专有）：UKey 签章（格尔/济南驱动）、PDF 数字签名
（iStylePDF 专有）、计划任务自启。Web/桌面形态下以 Provider 接口暴露，
默认提供 Mock 实现，可在有驱动的机器上接原生实现。
