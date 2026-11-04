/**
 * 电子凭证库服务端外部接口测试工具 —— UI 逻辑
 * 对应原版 EVoucherClient.exe 主窗口：
 *   代理服务地址设置（连接 WSDL，接口列表实时解析生成）
 *   + 服务接口测试三栏（参数「…」联动选择）+ 客户端签章 + 凭证查询
 */
const $ = (s) => document.querySelector(s);

const DEFAULTS = {
  certId: "TC10163135",
  admDivCode: "500000",
  stYear: String(new Date().getFullYear()),
  vtCode: "2205",
  voucherMessage: "",
  stamp: "",
  sroOrgType: "102",
  decOrgType: "011",
  voucherNo: "",
  voucherNos: "",
  msgNo: "MSG2025000123",
  fieldName: "VOUCHER_TITLE",
  startDate: new Date().getFullYear() + "-01-01",
  endDate: new Date().getFullYear() + "-12-31",
  reason: "信息有误",
  sign: "",
};

// 参与联动的键（统一小写）：值变化后相关参数的可选项需要按新上下文刷新
const LINK_KEYS = new Set([
  "certid", "admdivcode", "styear", "vtcode", "vt_code",
  "voucherno", "vouchnos", "vouchernos", "voucher_no",
  "orgtype", "srcorgtype", "decorgtype", "stampnos",
]);
const isLinkKey = (k) => LINK_KEYS.has(String(k || "").toLowerCase());

// 某参数变化后需要清空的下游参数（等待按新上下文重新联动取值）
const DOWNSTREAM = {
  certid: ["voucherno", "vouchernos", "vouchermessage", "vouchers", "stamp", "stampnos"],
  admdivcode: ["voucherno", "vouchernos", "vouchermessage", "vouchers", "stamp", "stampnos"],
  styear: ["voucherno", "vouchernos", "vouchermessage", "vouchers", "stamp", "stampnos"],
  vtcode: ["voucherno", "vouchernos", "vouchermessage", "vouchers", "stamp", "stampnos"],
  vt_code: ["voucherno", "vouchernos", "vouchermessage", "vouchers", "stamp", "stampnos"],
  voucherno: ["vouchermessage", "vouchers", "stamp"],
  vouchernos: ["vouchermessage", "vouchers", "stamp"],
  orgtype: ["stamp"],
  srcorgtype: ["stamp"],
  decorgtype: ["stamp"],
};

const state = {
  methods: [],
  current: null,
  connected: false,
  vouchers: [],
  pdfDoc: null,
};

function setStatus(t) { $("#st-msg").textContent = t; }

/* ================= 页签切换 ================= */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".tab-body").forEach((b) =>
      b.classList.toggle("active", b.id === "tab-" + tab.dataset.tab));
    if (tab.dataset.tab === "voucherquery") loadVouchers();
  });
});

function switchTab(name) {
  document.querySelector(`.tab[data-tab="${name}"]`).click();
}

/* ================= 连接管理（接口列表连接后实时产生） ================= */
function renderMethodList(methods) {
  state.methods = methods || [];
  const ul = $("#method-list");
  ul.innerHTML = "";
  if (!state.methods.length) {
    const li = document.createElement("li");
    li.className = "empty-hint";
    li.textContent = "（连接服务后此处列出接口）";
    li.style.color = "#999";
    ul.appendChild(li);
    return;
  }
  for (const m of state.methods) {
    const li = document.createElement("li");
    // fromWsdl === false：服务端 WSDL 未提供、由本地注册表补充的接口
    li.textContent = m.fromWsdl === false ? m.name + " *" : m.name;
    li.title = m.desc || "";
    if (m.fromWsdl === false) li.classList.add("local-only");
    li.addEventListener("click", () => selectMethod(m.name));
    ul.appendChild(li);
  }
}

async function connect() {
  const url = $("#wsdl-url").value.trim();
  if (!url) return;
  setStatus("正在连接 " + url + " …");
  const el = $("#conn-status");
  el.textContent = "连接中…";
  el.className = "conn-status";
  try {
    const r = await fetch("/api/ws/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).then((x) => x.json());
    state.connected = !!r.ok;
    el.textContent = (r.message || (r.ok ? "已连接" : "连接失败")) +
      (r.methods ? `，共 ${r.methods.length} 个接口` : "");
    el.className = "conn-status " + (r.ok ? "ok" : "err");
    $("#st-conn").textContent = "连接：" + (r.ok ? url : "未连接");
    // 接口列表 = 连接后实时解析产生
    renderMethodList(r.methods || []);
    if (r.methods && r.methods.length) {
      const first = r.methods.some((m) => m.name === "signStampByNosAndSend")
        ? "signStampByNosAndSend" : r.methods[0].name;
      selectMethod(first);
    }
    setStatus(r.ok ? "已连接，接口列表已刷新" : "连接失败");
  } catch (e) {
    el.textContent = "连接失败：" + e;
    el.className = "conn-status err";
    setStatus("连接失败");
  }
}

async function disconnect() {
  await fetch("/api/ws/disconnect", { method: "POST" });
  state.connected = false;
  const el = $("#conn-status");
  el.textContent = "已断开连接";
  el.className = "conn-status err";
  $("#st-conn").textContent = "连接：未连接";
  renderMethodList([]);
  state.current = null;
  $("#fn-name").textContent = "-";
  $("#fn-desc").textContent = "";
  $("#param-grid").innerHTML = "";
  setStatus("已断开");
}

$("#btn-connect").addEventListener("click", connect);
$("#btn-disconnect").addEventListener("click", disconnect);
$("#chk-auto").addEventListener("change", (e) => {
  if (e.target.checked) connect();
  else disconnect();
});

/* ================= 接口选择与参数渲染 ================= */
function selectMethod(name) {
  const m = state.methods.find((x) => x.name === name);
  if (!m) return;
  state.current = m;
  document.querySelectorAll("#method-list li").forEach((li) =>
    li.classList.toggle("sel", li.textContent === name));
  $("#fn-name").textContent = m.name;
  $("#fn-desc").textContent = m.desc ? "— " + m.desc : "";
  renderParams(m);
}

function collectParams() {
  const params = {};
  document.querySelectorAll("#param-grid [data-key]").forEach((el) => {
    params[el.dataset.key] = el.value;
  });
  return params;
}

function renderParams(m) {
  const grid = $("#param-grid");
  grid.innerHTML = "";
  (m.params || []).forEach((p, i) => {
    const div = document.createElement("div");
    div.className = "param-field";
    const label = document.createElement("label");
    label.innerHTML = `P${i + 1}[<span class="pk">${p.key}</span>|${p.label}]:`;
    div.appendChild(label);

    const ctrl = document.createElement("div");
    ctrl.className = "param-ctrl";
    const field = document.createElement(p.multiline ? "textarea" : "input");
    field.dataset.key = p.key;
    // 默认值按大小写不敏感匹配（真实 WSDL 键名如 certID 与本地 certId 不同）
    const dkey = Object.keys(DEFAULTS).find((k) => k.toLowerCase() === String(p.key).toLowerCase());
    field.value = dkey !== undefined ? DEFAULTS[dkey] : "";
    ctrl.appendChild(field);

    // 联动：上下文参数变化后提示可刷新关联选项
    field.addEventListener("change", () => {
      if (isLinkKey(p.key)) setStatus(`${p.key} 已变更，关联参数（如凭证编号、报文）可点「…」按新上下文刷新`);
    });

    const dots = document.createElement("button");
    dots.className = "dots";
    dots.type = "button";
    dots.textContent = "…";
    dots.title = "查看参数值或生成复杂报文（联动选择）";
    dots.addEventListener("click", (ev) => onDotsClick(ev, p.key, field, dots));
    ctrl.appendChild(dots);
    div.appendChild(ctrl);
    grid.appendChild(div);
  });
}

/* ================= 「…」联动选择 ================= */
function closeMenu(ev) {
  // 点击弹层内部（含筛选输入框）不关闭
  if (ev && ev.target instanceof Element && ev.target.closest(".opt-menu")) return;
  document.querySelectorAll(".opt-menu").forEach((n) => n.remove());
  document.removeEventListener("click", closeMenu, true);
}

/** 选项少时直接铺列表；超过 threshold 时加标题 + 关键字筛选（如 100+ 凭证类型） */
function showMenu(anchor, options, onPick, meta) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "opt-menu";
  const many = options.length > 12;

  if (many) {
    const head = document.createElement("div");
    head.className = "opt-head";
    head.textContent = `共 ${options.length} 项` + (meta ? " · " + meta : "");
    head.title = head.textContent;
    menu.appendChild(head);

    const box = document.createElement("input");
    box.className = "opt-search";
    box.type = "search";
    box.placeholder = "输入编号或名称筛选…";
    menu.appendChild(box);

    const list = document.createElement("div");
    list.className = "opt-list";
    menu.appendChild(list);

    const fill = (kw) => {
      list.innerHTML = "";
      const k = kw.trim().toLowerCase();
      const arr = k
        ? options.filter((o) => (o.label + " " + o.value).toLowerCase().includes(k))
        : options;
      if (!arr.length) {
        const e = document.createElement("div");
        e.className = "opt-empty";
        e.textContent = "无匹配项";
        list.appendChild(e);
        return;
      }
      for (const o of arr) {
        const item = document.createElement("div");
        item.className = "opt-item" + (o.disabled ? " disabled" : "");
        item.textContent = o.label;
        item.title = o.label;
        if (!o.disabled) item.addEventListener("click", () => { onPick(o); closeMenu(); });
        list.appendChild(item);
      }
    };
    box.addEventListener("input", () => fill(box.value));
    fill("");
    setTimeout(() => box.focus(), 0);
  } else {
    for (const o of options) {
      const item = document.createElement("div");
      item.className = "opt-item" + (o.disabled ? " disabled" : "");
      item.textContent = o.label;
      item.title = o.label;
      if (!o.disabled) {
        item.addEventListener("click", () => {
          onPick(o);
          closeMenu();
        });
      }
      menu.appendChild(item);
    }
  }

  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(r.left, window.innerWidth - 380) + "px";
  menu.style.top = r.bottom + 2 + "px";
  menu.style.maxHeight = Math.min(many ? 340 : 280, window.innerHeight - r.bottom - 10) + "px";
  setTimeout(() => document.addEventListener("click", closeMenu, true), 0);
}

/* ================= 凭证原文编辑器（弹窗） ================= */
// 这些参数是「凭证原文」类报文（WSDL 里多为 base64Binary），「…」改为打开编辑器而不是候选列表
const VOUCHER_KEYS = new Set(["vouchermessage", "vouchers", "voucherdata", "signedvoucher", "voucher"]);

const vm = {
  field: null, // 当前正在编辑的参数输入框
  key: "",
  busy: false,
};

const vmEl = () => $("#vm-mask");

function vmInfo(text, kind) {
  const el = $("#vm-info");
  el.textContent = text;
  el.className = "modal-info" + (kind ? " " + kind : "");
}

async function vmPost(body) {
  return fetch("/api/ws/voucher-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params: collectParams(), ...body }),
  }).then((x) => x.json());
}

/** 光标放到空的 <Voucher></Voucher> 中间，方便用户直接粘报文 */
function focusVoucherSlot() {
  const ta = $("#vm-text");
  const idx = ta.value.search(/<Voucher>\s*<\/Voucher>/i);
  if (idx < 0) return;
  const at = ta.value.indexOf("<Voucher>", idx) + "<Voucher>".length;
  ta.focus();
  ta.setSelectionRange(at, at);
  // 滚动到该位置
  const before = ta.value.slice(0, at).split("\n").length;
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
  ta.scrollTop = Math.max(0, (before - 6) * lh);
}

async function openVoucherEditor(field, key) {
  vm.field = field;
  vm.key = key;
  const mask = vmEl();
  mask.hidden = false;
  const ta = $("#vm-text");

  const cur = String(field.value || "").trim();
  setStatus(`正在准备 ${key} 编辑器…`);
  vmInfo("正在生成报文头…");

  if (cur) {
    // 已有值：解码成明文再编辑（避免在 base64 上改）
    const d = await vmPost({ action: "decode", text: cur });
    if (d.ok && d.text) {
      ta.value = d.text;
      vmInfo(`已载入当前参数值并解码为明文（整包 ${cur.length} 字符 → 明文 ${d.text.length} 字符），可直接修改 <Voucher> 内容`, "ok");
      ta.focus();
      return;
    }
  }

  const r = await vmPost({ action: "template" });
  ta.value = r.ok ? r.text : "";
  vmInfo(r.note || "报文头已生成", r.ok ? "" : "err");
  if (r.ok) focusVoucherSlot();
  setStatus(`${key}：编辑器已打开，报文头按当前参数生成，填入凭证报文后点「填入报文」`);
}

function closeVoucherEditor() {
  vmEl().hidden = true;
  vm.field = null;
  vm.key = "";
}

$("#vm-close").addEventListener("click", closeVoucherEditor);
$("#vm-cancel").addEventListener("click", closeVoucherEditor);
vmEl().addEventListener("click", (e) => {
  if (e.target === vmEl()) closeVoucherEditor();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !vmEl().hidden) closeVoucherEditor();
});

$("#vm-reset").addEventListener("click", async () => {
  const r = await vmPost({ action: "template" });
  if (!r.ok) return vmInfo(r.message || "生成模板失败", "err");
  $("#vm-text").value = r.text;
  vmInfo(r.note || "报文头已重置", "ok");
  focusVoucherSlot();
});

$("#vm-load-server").addEventListener("click", async () => {
  const btn = $("#vm-load-server");
  btn.disabled = true;
  vmInfo("正在从服务端读取凭证原文…");
  const r = await vmPost({ action: "server" });
  btn.disabled = false;
  if (!r.ok) return vmInfo(r.message || "取原文失败", "err");
  $("#vm-text").value = r.text || "";
  vmInfo(r.note || "已取服务端原文", r.source === "readVoucherByNo" ? "ok" : "");
});

// 解析并校验：只编码不填参数，把两层长度/提取到的编号报给用户
$("#vm-format").addEventListener("click", async () => {
  const r = await vmPost({ action: "encode", text: $("#vm-text").value });
  if (!r.ok) return vmInfo("校验失败：" + (r.message || "未知错误"), "err");
  vmInfo(
    `校验通过：内层明文 ${r.innerPlainLength} 字符 → base64 ${r.innerB64Length} 字符` +
      `${r.innerAlreadyEncoded ? "（已是 base64，未二次编码）" : "（已按 GBK 编码）"}；` +
      `整包 ${r.mofLength} 字符 → base64 ${r.payloadLength} 字符。` +
      `解析到 VoucherNo=${r.voucherNo || "(空)"} VtCode=${r.vtCode || "(空)"}。点「填入报文」即写入参数。`,
    "ok"
  );
});

$("#vm-apply").addEventListener("click", async () => {
  if (!vm.field) return;
  const btn = $("#vm-apply");
  btn.disabled = true;
  const r = await vmPost({ action: "encode", text: $("#vm-text").value });
  btn.disabled = false;
  if (!r.ok) return vmInfo("填入失败：" + (r.message || "未知错误"), "err");

  vm.field.value = r.payload;
  const key = vm.key;
  closeVoucherEditor();
  setStatus(
    `已填入 ${key}：内层 base64 ${r.innerB64Length} 字符，整包 base64 ${r.payloadLength} 字符` +
      `（VoucherNo=${r.voucherNo || "-"} / VtCode=${r.vtCode || "-"}）`
  );
  // 凭证原文变了 → 下游签章报文的编号/类型可能失效，提示重新联动
  if (r.voucherNo) setStatus(`${$("#st-msg").textContent}；签章信息如需同步请点它的「…」重新生成`);
});

async function onDotsClick(ev, key, field) {
  ev.stopPropagation();
  // 凭证原文类参数：打开专用编辑器，而不是候选下拉
  if (VOUCHER_KEYS.has(String(key).toLowerCase())) {
    await openVoucherEditor(field, key);
    return;
  }
  const params = collectParams(); // 联动上下文 = 当前所有参数值
  setStatus(`正在解析 ${key} 的可选值…`);
  const r = await fetch("/api/ws/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, params, method: state.current ? state.current.name : "" }),
  }).then((x) => x.json());
  if (r.ok === false) {
    setStatus(`解析 ${key} 失败：${r.message || "未知错误"}`);
    return;
  }

  if (r.payload !== undefined) {
    // 复杂报文：按当前上下文（凭证编号/类型/年度等）联动生成
    field.value = r.payload;
    const enc = r.encoding === "text" ? "" : `（${r.encoding}）`;
    setStatus(`${r.note || "已按当前参数联动生成 " + key + " 报文"}${enc}`);
    return;
  }
  const opts = r.options || [];
  if (!opts.length) {
    // 无候选值时也弹出说明，避免用户以为按钮失效
    const hint = r.note || `参数 ${key} 无候选值，请手工输入`;
    showMenu(field.closest(".param-ctrl").querySelector(".dots") || ev.target,
      [{ value: "", label: hint, disabled: true }], () => {}, "无可选值");
    setStatus(hint);
    return;
  }
  if (opts.length === 1) {
    field.value = opts[0].value;
    setStatus(`${r.note ? r.note + "；" : ""}已填入 ${key} = ${opts[0].value}`);
    return;
  }
  const srcTag = r.source && r.source !== "内置字典" ? r.source : "";
  const meta = srcTag ? `来源 ${srcTag}` : "内置字典";
  if (r.note) setStatus(r.note);
  showMenu(field.closest(".param-ctrl").querySelector(".dots") || ev.target, opts, (o) => {
    field.value = o.value;
    if (isLinkKey(key)) {
      // 联动：上下文变化后清空依赖它的下游参数，等待重新选择
      const downstream = DOWNSTREAM[key.toLowerCase()] || [];
      for (const dk of downstream) {
        const el = [...document.querySelectorAll("#param-grid [data-key]")]
          .find((x) => x.dataset.key.toLowerCase() === dk);
        if (el) el.value = "";
      }
      setStatus(`${r.note ? r.note + "；" : ""}已选择 ${key} = ${o.value}，关联参数请点「…」重新联动选择`);
    } else {
      setStatus(`${r.note ? r.note + "；" : ""}已选择 ${key} = ${o.value}`);
    }
  });
}

$("#btn-clear-params").addEventListener("click", () => {
  if (state.current) renderParams(state.current);
  setStatus("输入参数已清空还原");
});

/* ================= 调用函数 ================= */
$("#btn-invoke").addEventListener("click", async () => {
  if (!state.current) return;
  const params = collectParams();
  setStatus(`正在调用 ${state.current.name} …`);
  const r = await fetch("/api/ws/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: state.current.name, params }),
  }).then((x) => x.json());

  const out = $("#result-view");
  out.classList.toggle("err", !r.ok);
  if (r.ok) {
    out.textContent =
      `成功调用函数[ ${r.method} ]，返回结果为>>> ` +
      JSON.stringify(r.result, null, 2);
    setStatus(`调用成功：${r.method}`);
  } else {
    out.textContent = `调用函数[ ${r.method || state.current.name} ] 失败：${r.message || "未知错误"}`;
    setStatus("调用失败");
  }
});

/* ================= 客户端签章页签（Mock） ================= */
function csResult(text, ok = true) {
  const el = $("#cs-result");
  el.classList.toggle("err", !ok);
  el.textContent = text;
}
$("#cs-sign").addEventListener("click", () => {
  csResult('客户端签名完成。\n签名值: "MIIbBgkqhkiG9w0BBQ..."（Mock）\n算法: SM2WithSM3 / SHA256withRSA');
});
$("#cs-verify").addEventListener("click", () => {
  csResult("验证签名结果：签名有效（Mock）。\n证书: CN=Mock测试证书\n签名时间: " + new Date().toLocaleString());
});
$("#cs-stamp").addEventListener("click", () => {
  csResult('客户端签章完成。\n签章信息: <?xml version="1.0"?>\n<STAMP_INFO><STAMP_NO>STAMP0001</STAMP_NO><RESULT>OK</RESULT></STAMP_INFO>');
});

/* ================= 凭证查询页签 ================= */
async function loadVouchers() {
  const r = await fetch("/api/vouchers").then((x) => x.json());
  state.vouchers = r.vouchers || [];
  const ul = $("#vq-list");
  ul.innerHTML = "";
  for (const v of state.vouchers) {
    const li = document.createElement("li");
    li.textContent = `${v.voucherNo}  ${v.voucherTypeName}  ¥${v.amount}  ${v.status}`;
    li.addEventListener("click", () => showVoucherPdf(v, li));
    ul.appendChild(li);
  }
}

async function showVoucherPdf(v, li) {
  document.querySelectorAll("#vq-list li").forEach((x) => x.classList.toggle("sel", x === li));
  $("#vq-empty")?.remove();
  const url = `/api/vouchers/${encodeURIComponent(v.voucherNo)}/pdf`;
  const data = await fetch(url).then((x) => x.arrayBuffer());
  const pdfjs = await import("/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  state.pdfDoc = await pdfjs.getDocument({ data }).promise;
  renderPage(1);
}

async function renderPage(n) {
  if (!state.pdfDoc) return;
  const page = await state.pdfDoc.getPage(n);
  const canvas = $("#pdf-canvas");
  const scale = 1.4;
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
}

$("#vq-refresh").addEventListener("click", loadVouchers);

/* ================= 初始化：未连接，接口列表为空 ================= */
renderMethodList([]);
connect(); // 自动连接勾选默认开启
