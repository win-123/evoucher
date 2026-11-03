/**
 * EVoucher X - 本地服务
 * 形态1：node server/main.js --open  → 浏览器直接访问 http://localhost:8721
 * 形态2：electron/main.js 内部 require 本模块（桌面形态复用同一服务）
 *
 * 协议方法集来自逆向报告 docs/reverse-engineering-report.md §3
 * (CEvoucherHttpClient 65 方法 → ClientProvider 骨架全量)
 */
const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { makeSampleVoucherPdf } = require("./pdf-gen");
const { MockProvider, RealHttpProvider } = require("./providers");
const { METHODS, getMethod, getOptions, GENERIC_PARAMS, PARAM_LABELS } = require("./interface-methods");
const { resolveOptions } = require("./link-options");
const { soapCall } = require("./soap");

const PORT = process.env.EVOUCHER_PORT || 8721;
const DATA_DIR = path.join(__dirname, "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const STORE_FILE = path.join(DATA_DIR, "store.json");

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(
        {
          // 对应 CConfigure：GetEVoucherServerURL / GetEstampServerURL /
          // GetAttachHTTPServerURL / GetUpdateServerURL / GetModefromH
          evoucherServerURL: "http://127.0.0.1:9001/evoucher",
          estampServerURL: "http://127.0.0.1:9002/estamp",
          attachHTTPServerURL: "http://127.0.0.1:9003/attach",
          updateServerURL: "http://127.0.0.1:9004/update",
          mode: "mock", // mock | http | ws
          user: { name: "15500100111", pwd: "", orgCode: "101001" },
        },
        null,
        2
      )
    );
  }
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ vouchers: [], logs: [] }, null, 2));
  }
}
function readJson(f) {
  return JSON.parse(fs.readFileSync(f, "utf-8"));
}
function writeJson(f, v) {
  fs.writeFileSync(f, JSON.stringify(v, null, 2));
}

function createApp() {
  ensureData();
  const app = express();
  app.use(express.json({ limit: "50mb" }));

  const config = () => readJson(CONFIG_FILE);
  const store = () => readJson(STORE_FILE);
  const saveStore = (s) => writeJson(STORE_FILE, s);

  function provider() {
    const c = config();
    if (c.mode === "http") return new RealHttpProvider(c);
    return new MockProvider(c, { store, saveStore });
  }

  // ---------- 静态 UI ----------
  app.use(express.static(path.join(__dirname, "..", "app")));
  app.use("/pdfjs", express.static(path.join(__dirname, "..", "node_modules", "pdfjs-dist", "build")));

  // ---------- 配置（对应 CConfigure） ----------
  app.get("/api/config", (req, res) => res.json(config()));
  app.put("/api/config", (req, res) => {
    const c = { ...config(), ...req.body };
    writeJson(CONFIG_FILE, c);
    res.json(c);
  });

  // ---------- 业务协议骨架（Mock/Real 双实现） ----------
  // GET /api/evoucher/:method —— 查询类；POST /api/evoucher/:method —— 动作类
  const queryMethods = [
    "GetVoucherTypes", "GetVoucherModel", "GetVoucherModelByVmId",
    "GetVoucherAndSign", "GetVoucherSignPositions", "GetVoucherStampPositions",
    "GetVoucheStampedPositons", "GetVoucherStampedInfo", "GetAdmDivCodes",
    "GetDecOrgList", "GetEStampProvider", "GetEStampServerUrl", "GetServerVersion",
    "GetCertMode", "GetDate", "GetTime", "GetPrintInfo", "Get2DCode",
    "queryDetailVoucherNo", "getProgress", "getAttachInfo", "getAttachInfoForID",
    "isVerify", "queryServerInfo", "GetVmIdByVoucherNo", "GetUserInfo",
    "GetLogInfo", "GetTestToolsParams", "GetDisplayVirtualization",
    "GetUpdateOCXStatus", "GetErrMode", "GetSrcOrg", "GetClientHeaderUser",
    "getClientDownloadPath",
  ];
  const actionMethods = [
    "DownLoadVouchers", "SendVoucher", "SendVoucherFullSigns", "SaveStampVoucher",
    "SaveSignVoucher", "SaveSignatureWithoutPos", "CancelSignatureWithoutPos",
    "CancelStamp", "SignAndSendByServer", "StampeAndSendByServer",
    "StampeAndSendByServerWithoutPos", "SignStampByNos", "ConfirmVoucher",
    "ConfirmVoucherFail", "DiscardVoucher", "ReturnVoucher", "AddPrintTimes",
    "createAttachIDs", "deleteAttachForID", "deleteAttachForVoucherNo",
    "updateAttachInfo", "reSendAttach", "buildAssociation", "cancelAssociation",
    "transTrans", "SetUserInfo", "verfiyVoucherOriginal",
  ];

  for (const m of queryMethods) {
    app.get(`/api/evoucher/${m}`, async (req, res) => {
      try {
        const r = await provider().call(m, req.query);
        res.json(r);
      } catch (e) {
        res.status(502).json({ ok: false, code: "PROVIDER_ERROR", message: String(e.message || e) });
      }
    });
  }
  for (const m of actionMethods) {
    app.post(`/api/evoucher/${m}`, async (req, res) => {
      try {
        const r = await provider().call(m, req.body || {});
        res.json(r);
      } catch (e) {
        res.status(502).json({ ok: false, code: "PROVIDER_ERROR", message: String(e.message || e) });
      }
    });
  }

  // ---------- 外部接口测试工具（对应原版主界面：WSDL 连接 + 接口调用） ----------
  const wsState = { connected: false, url: "", endpoint: "", namespace: "", source: "mock", methods: [], localOnly: [] };

  /**
   * 实时解析 WSDL：目标命名空间、每个 operation 的 message parts。
   * 失败时返回 {names:null, note}（由调用方回退 Mock 注册表）。
   */
  async function parseWsdl(url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        return { ok: false, note: `服务器可达，但 WSDL 地址返回 HTTP ${res.status}（服务未部署或路径不对）` };
      }
      const text = await res.text();
      const ns = (text.match(/targetNamespace="([^"]+)"/) || [])[1] || "";
      const opNames = [...text.matchAll(/<(?:\w+:)?operation[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
      const names = [...new Set(opNames)];
      if (!names.length) {
        return { ok: false, note: "地址可访问，但内容不是有效的 WSDL（未找到 operation 定义）" };
      }
      // Axis 约定：<message name="<op>Request"> 内含 <part name type>
      const partsByOp = {};
      for (const op of names) {
        const mm =
          text.match(new RegExp(`<wsdl:message name="${op}(?:Request)?">([\\s\\S]*?)</wsdl:message>`)) ||
          text.match(new RegExp(`<message name="${op}(?:Request)?">([\\s\\S]*?)</message>`));
        if (mm) {
          const parts = [...mm[1].matchAll(/<\w+:part\s+name="([^"]+)"[^>]*type="([^"]+)"/g)].map((m) => ({
            key: m[1],
            name: m[1],
            type: m[2],
          }));
          if (parts.length) partsByOp[op] = parts;
        }
      }
      return { ok: true, names, namespace: ns, partsByOp };
    } catch (e) {
      const reason = e.name === "TimeoutError" ? "连接超时" : `网络不可达（${e.cause?.code || e.message}）`;
      return { ok: false, note: reason };
    }
  }

  /** 真实 WSDL 模式：参数定义 = message parts；描述沿用本地注册表（如有） */
  function methodDefsWsdl(names, partsByOp) {
    const shortType = (t) => String(t || "").replace(/^.*:/, "");
    return names.map((name) => {
      const reg = getMethod(name);
      const parts = partsByOp[name];
      const params = (parts || []).map((p) => ({
        key: p.key,
        name: p.name,
        // 中文说明优先（对齐原版「P1[certId|证书ID]」），无字典时回退 WSDL 类型
        label: PARAM_LABELS[String(p.key).toLowerCase()] || shortType(p.type),
        type: p.type,
        multiline: /ArrayOf|Map/i.test(p.type),
      }));
      if (params.length) {
        return { name, desc: reg ? reg.desc : "SOAP 接口（参数定义来自 WSDL）", params, known: !!reg, fromWsdl: true };
      }
      // WSDL 未提供的本地接口：参数沿用注册表，明确标注
      return {
        name,
        desc: (reg ? reg.desc : "本地定义接口") + "（当前服务端 WSDL 未提供，调用可能返回 Fault）",
        params: (reg ? reg.params : GENERIC_PARAMS).map((p) => ({ ...p, name: p.key })),
        known: !!reg,
        fromWsdl: false,
      };
    });
  }

  /** 接口名排序（忽略大小写，字母序） */
  function sortByName(list) {
    return list.slice().sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));
  }

  function methodDefs(names) {
    return names.map((name) => {
      const def = getMethod(name);
      if (def) return { name, desc: def.desc, params: def.params, known: true };
      return { name, desc: "（WSDL 解析接口，参数为通用模板）", params: GENERIC_PARAMS.map((p) => ({ ...p, name: p.key })), known: false };
    });
  }

  app.get("/api/ws/methods", (req, res) => {
    res.json({ ok: true, connected: wsState.connected, source: wsState.source, methods: wsState.methods });
  });

  app.post("/api/ws/connect", async (req, res) => {
    const url = (req.body && req.body.url) || "";
    if (!url) return res.status(400).json({ ok: false, message: "地址栏为空" });
    // 优先实时解析 WSDL；解析不到时回退内置 Mock 注册表，并说明原因
    const parsed = await parseWsdl(url);
    if (parsed.ok) {
      wsState.source = "wsdl";
      wsState.namespace = parsed.namespace;
      wsState.endpoint = url.replace(/\?wsdl.*$/i, "").replace(/\?WSDL.*$/, "");
      // 本地方法名来自逆向原版工具，与真实 WSDL 可能有单复数/后缀差异
      // （如 queryVoucherNoByTime vs queryVoucherNosByTime），需模糊去重，否则列表出现"重复"接口
      const variantsOf = (n) => {
        const b = normName(n);
        const set = new Set([b]);
        for (const suf of ["s", "nos", "no"]) if (b.endsWith(suf)) set.add(b.slice(0, -suf.length));
        set.add(b.replace(/nos/g, "no")); // 词中差异：voucherNosByTime ↔ voucherNoByTime
        set.add(b.replace(/nos/g, ""));
        return set;
      };
      const wsdlVarSet = new Set();
      for (const n of parsed.names) for (const v of variantsOf(n)) wsdlVarSet.add(v);
      const isWsdlDup = (name) => {
        const a = normName(name);
        if (wsdlVarSet.has(a)) return true;
        for (const v of variantsOf(name)) if (wsdlVarSet.has(v)) return true;
        for (const w of parsed.names) {
          const b = normName(w);
          // 长公共前缀（≥20 字符）视为同一接口的猜测名（如 querySignPositionWithNos / …WithName）
          const m = Math.min(a.length, b.length);
          if (m >= 20) {
            let i = 0;
            while (i < m && a[i] === b[i]) i++;
            if (i >= 20) return true;
          }
        }
        return false;
      };
      const extra = METHODS.map((m) => m.name).filter((n) => !isWsdlDup(n));
      const all = sortByName([...parsed.names, ...extra]);
      wsState.localOnly = extra;
      wsState.methods = methodDefsWsdl(all, parsed.partsByOp);
    } else {
      wsState.source = "mock";
      wsState.endpoint = "";
      wsState.namespace = "";
      wsState.localOnly = [];
      wsState.methods = methodDefs(sortByName(METHODS.map((m) => m.name)));
    }
    wsState.connected = true;
    wsState.url = url;
    linkCache.clear(); // 服务端/命名空间变化，联动缓存作废
    res.json({
      ok: true,
      source: wsState.source,
      note: parsed.ok ? null : parsed.note,
      message: parsed.ok
        ? `已连接 ${url}：WSDL 实时解析 ${parsed.names.length} 个接口` +
          (wsState.localOnly.length ? ` + 本地补充 ${wsState.localOnly.length} 个（服务端未提供）` : "") +
          `，共 ${wsState.methods.length} 个，已按名称排序（SOAP 真实调用模式）`
        : `WSDL 解析失败（${parsed.note}），已切换为内置 Mock 模拟接口 ${METHODS.length} 个——调用返回的是模拟数据，不会访问真实服务器`,
      methods: wsState.methods,
    });
  });

  app.post("/api/ws/disconnect", (req, res) => {
    wsState.connected = false;
    wsState.url = "";
    wsState.endpoint = "";
    wsState.methods = []; // 断开后接口列表清空（连接后实时产生）
    linkCache.clear();
    res.json({ ok: true, message: "已断开连接" });
  });

  // ---- 联动取数通道：真实 SOAP 实时调用（同一请求 3 分钟内复用） ----
  const linkCache = new Map();
  const LINK_TTL = 3 * 60 * 1000;

  /** 参数名归一（去分隔符、小写）：vt_code / vtCode → vtcode */
  const normName = (s) => String(s || "").toLowerCase().replace(/[_\-\s]/g, "");

  /** 语义别名：不同接口对同一含义的命名不同（voucherNo / voucherNos） */
  const VALUE_ALIAS = {
    voucherno: ["vouchernos"],
    vouchernos: ["voucherno"],
    stampnos: ["stampno", "stampnos"],
    orgtype: ["srcorgtype", "decorgtype", "sroorgtype"],
  };

  /** 把 {vtcode:...} 这类语义值映射到该接口 WSDL 的真实 part 名 */
  function valuesForParts(parts, values) {
    const lower = {};
    for (const [k, v] of Object.entries(values || {})) lower[normName(k)] = v;
    const out = {};
    for (const pt of parts) {
      const nm = pt.name || pt.key;
      const n = normName(nm);
      let v = lower[n];
      if (v === undefined) {
        for (const alt of VALUE_ALIAS[n] || []) {
          if (lower[alt] !== undefined) { v = lower[alt]; break; }
        }
      }
      out[nm] = v === undefined ? "" : v;
    }
    return out;
  }

  /**
   * 供联动解析器使用的统一调用入口（未连接真实服务时返回失败，由解析器回退内置字典）
   */
  async function soapForLink(op, values, timeoutMs) {
    if (wsState.source !== "wsdl" || !wsState.endpoint) return { ok: false, message: "未连接真实服务" };
    const def = wsState.methods.find((m) => m.name === op);
    if (!def || !def.params || !def.params.length) return { ok: false, message: `服务端未提供 ${op} 接口` };
    const parts = def.params.map((p) => ({ key: p.key, name: p.name || p.key, type: p.type }));
    const vals = valuesForParts(parts, values);
    const ck = op + "|" + JSON.stringify(vals);
    const hit = linkCache.get(ck);
    if (hit && Date.now() - hit.t < LINK_TTL) return { ...hit.val, cached: true };
    let r;
    try {
      r = await soapCall(wsState.endpoint, wsState.namespace, op, parts, vals, timeoutMs || 15000);
    } catch (e) {
      r = { ok: false, message: String(e.message || e) };
    }
    if (r.ok) linkCache.set(ck, { t: Date.now(), val: r });
    return r;
  }

  // 参数「…」联动选项：以当前其它参数为上下文（真实接口优先，内置字典兜底）
  app.post("/api/ws/options", async (req, res) => {
    const { key, params, method } = req.body || {};
    if (!key) return res.status(400).json({ ok: false, message: "缺少参数键名" });
    const p = params || {};
    // 该参数在 WSDL 中的类型（决定报文是否要 base64 编码）
    const mdef = wsState.methods.find((m) => m.name === method) || null;
    const pdef = mdef && (mdef.params || []).find((x) => normName(x.key) === normName(key));
    const type = (pdef && pdef.type) || "";
    const localVouchers = store().vouchers || [];

    try {
      const r = await resolveOptions({
        key,
        params: p,
        type,
        localVouchers,
        // raw：直连其它 SOAP 服务（如印章服务 asspEStampService），联动取印章库时用
        api:
          wsState.source === "wsdl" && wsState.endpoint
            ? { soap: soapForLink, raw: (ep, ns, op, parts, values, t) => soapCall(ep, ns, op, parts, values, t) }
            : null,
      });
      const out = { ok: true, key, ...r };
      if (r.options) out.total = r.options.length;
      res.json(out);
    } catch (e) {
      res.json({ ok: false, key, message: String(e.message || e) });
    }
  });

  app.post("/api/ws/call", async (req, res) => {
    const { method, params } = req.body || {};
    const def = wsState.methods.find((m) => m.name === method) || getMethod(method);
    if (!def) return res.status(404).json({ ok: false, message: `未知接口方法: ${method}` });
    if (!wsState.connected) {
      return res.json({ ok: false, message: "尚未连接服务，请先在「代理服务地址设置」中点击「连接」" });
    }
    try {
      if (wsState.source === "wsdl" && wsState.endpoint) {
        // —— 真实 SOAP 调用 ——
        const parts = (def.params || []).map((p) => ({ key: p.key, name: p.name || p.key, type: p.type }));
        const r = await soapCall(wsState.endpoint, wsState.namespace, method, parts, params || {});
        if (!r.ok) return res.json({ ok: false, method, message: r.message });
        return res.json({ ok: true, method, source: "soap", result: r.result });
      }
      // —— Mock 模拟调用 ——
      let result;
      if (config().mode === "http") {
        result = await provider().call(method, params || {});
      } else {
        result = def.mock ? def.mock(params || {}) : { ok: true, params };
      }
      // 应答格式对齐原版工具：成功调用函数[ xxx ]，返回结果为>>> {...}
      res.json({ ok: true, method, result });
    } catch (e) {
      res.json({ ok: false, method, message: String(e.message || e) });
    }
  });

  // ---------- 本地凭证库（UI 主数据） ----------
  app.get("/api/vouchers", (req, res) => {
    const s = store();
    res.json({ ok: true, vouchers: s.vouchers });
  });

  app.get("/api/vouchers/:no/pdf", (req, res) => {
    const s = store();
    const v = s.vouchers.find((x) => x.voucherNo === req.params.no);
    if (!v) return res.status(404).json({ ok: false, message: "无此凭证联" });
    const pdf = makeSampleVoucherPdf(v);
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(pdf, "binary"));
  });

  app.post("/api/logs", (req, res) => {
    const s = store();
    s.logs.unshift({
      time: new Date().toISOString(),
      action: req.body.action || "",
      detail: req.body.detail || "",
      user: req.body.user || config().user.name,
    });
    s.logs = s.logs.slice(0, 500);
    saveStore(s);
    res.json({ ok: true });
  });
  app.get("/api/logs", (req, res) => {
    res.json({ ok: true, logs: store().logs });
  });

  // ---------- 签章（SignStampProvider：mock / 原生适配位） ----------
  app.post("/api/sign/stamp", async (req, res) => {
    const c = config();
    if (c.mode === "mock") {
      const s = store();
      const v = s.vouchers.find((x) => x.voucherNo === req.body.voucherNo);
      if (!v) return res.status(404).json({ ok: false, message: "凭证数据不存在" });
      v.stampedInfo = {
        position: req.body.position || "第一签章位置",
        time: new Date().toISOString(),
        certCN: "Mock测试证书",
        certSN: "00" + Date.now(),
        valid: true,
        user: c.user.name,
      };
      saveStore(s);
      return res.json({ ok: true, signStampInfo: v.stampedInfo });
    }
    res.status(501).json({ ok: false, message: "原生 UKey 签章驱动需在本机安装后启用（对应原版 sign_stamp_opt_geer/_jn）" });
  });
  app.post("/api/sign/verify", async (req, res) => {
    const s = store();
    const v = s.vouchers.find((x) => x.voucherNo === req.body.voucherNo);
    if (!v) return res.status(404).json({ ok: false, message: "凭证数据不存在" });
    res.json({ ok: true, verify: v.stampedInfo ? { valid: true, info: v.stampedInfo } : { valid: false, message: "该凭证尚未签章" } });
  });

  return app;
}

function startServer(opts = {}) {
  const app = createApp();
  const server = http.createServer(app);
  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`[EVoucherX] 服务已启动: ${url}`);
    if (opts.onReady) opts.onReady(url);
    if (opts.open) {
      const { spawn } = require("child_process");
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      spawn(cmd, process.platform === "win32" ? ["", url] : [url], { detached: true, shell: process.platform === "win32" }).unref();
    }
  });
  return server;
}

if (require.main === module) {
  startServer({ open: process.argv.includes("--open") });
}
module.exports = { createApp, startServer, PORT };
