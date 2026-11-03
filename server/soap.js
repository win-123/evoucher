/**
 * SOAP(RPC/encoded, Axis 风格)调用器
 * —— 对接 realware AsspFinanceService：
 *    targetNamespace = http://financeService.assp
 *    应答为 multiRef Map（Apache XML SOAP 序列化）
 */

/** XML 转义（参数值可能含 <?xml...> 报文） */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 反解码服务端返回中的实体与标签 */
function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
function stripTags(s) {
  return decodeEntities(String(s ?? "").replace(/<[^>]*>/g, "")).trim();
}

/**
 * 构造 RPC/encoded 请求信封
 * @param parts [{key,name,type}] 顺序取自 WSDL message parts
 * @param values {key:value} 来自 UI 参数框
 */

let _iconv = null;
function gbkB64(text) {
  if (!_iconv) _iconv = require("iconv-lite");
  return _iconv.encode(String(text), "gbk").toString("base64");
}

/** base64Binary 容错：填了 XML 明文（粘贴了解码后的报文）自动转 base64(GBK) */
function normalizeBase64(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const compact = s.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(compact)) return compact; // 已是合法 base64
  return gbkB64(s); // 含 <、中文等任何非法字符 → 视为明文报文，编码后发送
}

function buildEnvelope(namespace, op, parts, values) {
  const children = (parts || [])
    .map((p) => {
      const name = p.name || p.key;
      const v = values[p.name || p.key] ?? values[p.key] ?? "";
      const type = p.type || "soapenc:string";
      if (/ArrayOf/i.test(type)) {
        const arr = String(v).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
        const items = arr.map((a) => `<item xsi:type="soapenc:string">${esc(a)}</item>`).join("");
        return `<${name} soapenc:arrayType="soapenc:string[${arr.length}]" xsi:type="soapenc:Array">${items}</${name}>`;
      }
      if (/\bint\b|integer/i.test(type)) {
        return `<${name} xsi:type="xsd:int">${esc(String(Number(v) || 0))}</${name}>`;
      }
      // base64Binary：必须是 base64 文本 + base64Binary 类型，否则 Axis 会按数组反序列化报
      // "Found character data inside an array element"
      // 用户粘贴了解码后的 XML 明文时自动转 base64(GBK)，避免服务端 EVS201
      if (/base64/i.test(type)) {
        return `<${name} xsi:type="xsd:base64Binary">${esc(normalizeBase64(v))}</${name}>`;
      }
      return `<${name} xsi:type="soapenc:string">${esc(v)}</${name}>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"` +
    ` xmlns:ser="${namespace}"` +
    ` xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/"` +
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
    ` xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<soapenv:Header/><soapenv:Body><ser:${op}>${children}</ser:${op}></soapenv:Body></soapenv:Envelope>`
  );
}

/**
 * 解析 Axis multiRef 应答。
 * 返回 {ok, result} 或 {ok:false, message}
 */
function parseSoapResponse(xml, op) {
  // 1) SOAP Fault
  const fault = xml.match(/<(?:\w+:)?faultstring[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/i);
  if (fault) {
    return { ok: false, message: "服务端返回 Fault：" + decodeEntities(stripTags(fault[1])) };
  }
  // 2) multiRef Map（href 引用）
  const href = xml.match(new RegExp(`<(?:\\w+:)?${op}Return[^>]*href="#(id\\d+)"`, "i"));
  if (href) {
    const mref = xml.match(
      new RegExp(`<multiRef[^>]*id="${href[1]}"[^>]*>([\\s\\S]*?)</multiRef>`, "i")
    );
    if (mref) {
      const items = [...mref[1].matchAll(/<item>([\s\S]*?)<\/item>/g)]
        .map((it) => {
          const k = it[1].match(/<key[^>]*>([\s\S]*?)<\/key>/i);
          const v = it[1].match(/<value[^>]*>([\s\S]*?)<\/value>/i);
          return [stripTags(k && k[1]), stripTags(v && v[1])];
        })
        .filter(([k]) => k);
      if (items.length) return { ok: true, result: Object.fromEntries(items) };
      const inner = stripTags(mref[1]);
      if (inner) return { ok: true, result: inner };
    }
  }
  // 3) Axis 数组：arrayType 声明在外层元素，内部重复「同名元素」或 <item>
  //    注意外层与内层元素同名（<xxxReturn arrayType=...><xxxReturn>值</xxxReturn>...），
  //    不能用惰性外层匹配，否则只能取到第一项
  const arrM = xml.match(new RegExp(`<(?:\\w+:)?${op}Return\\b[^>]*\\barrayType="[^"]*\\[(\\d+)\\]"[^>]*>`, "i"));
  if (arrM) {
    const body = xml.slice(arrM.index + arrM[0].length);
    const tagName = `${op}Return`.toLowerCase();
    const items = [];
    for (const m of body.matchAll(/<(?:([\w.-]+):)?([\w.-]+)\b[^>]*>([\s\S]*?)<\/(?:\1:)?\2>/g)) {
      const name = m[2].toLowerCase();
      if (name === "item" || name === tagName) items.push(decodeEntities(stripTags(m[3])));
    }
    return { ok: true, result: items, kind: "array" };
  }

  // 4) 标量 / nil / 空元素
  const retM = xml.match(
    new RegExp(`<(?:\\w+:)?${op}Return\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${op}Return>)`, "i")
  );
  if (retM) {
    const attrs = retM[1] || "";
    const inner = retM[2] || "";
    if (/xsi:nil="true"/i.test(attrs)) return { ok: true, result: null, kind: "nil" };
    // Axis 数组：arrayType="soapenc:string[N]"
    // 注意元素名不一定是 <item>，本服务复用 <xxxReturn> 作为数组项（queryVoucherNosByTime）
    if (/arrayType=/i.test(attrs)) {
      const items = [...inner.matchAll(/<(?:([\w.-]+):)?([\w.-]+)\b[^>]*>([\s\S]*?)<\/(?:\1:)?\2>/g)]
        .map((m) => decodeEntities(stripTags(m[3])))
        .filter((v) => v !== "");
      return { ok: true, result: items, kind: "array" };
    }
    const items2 = [...inner.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)].map((it) => decodeEntities(stripTags(it[1])));
    if (items2.length) return { ok: true, result: items2, kind: "array" };
    const text = decodeEntities(inner).trim();
    if (text) return { ok: true, result: text, kind: "text" };
    // 元素存在但内容为空（如 <readVoucherReturn xsi:type="soapenc:base64Binary"></readVoucherReturn>）
    return { ok: true, result: "", kind: "empty" };
  }
  // 4) 其他结构：整包返回便于排查
  return { ok: true, result: xml.length > 4000 ? xml.slice(0, 4000) + "…" : xml };
}

/** 发送 SOAP 请求 */
async function soapCall(endpoint, namespace, op, parts, values, timeoutMs = 20000) {
  const envelope = buildEnvelope(namespace, op, parts, values);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": 'text/xml;charset=UTF-8',
      SOAPAction: '""',
    },
    body: envelope,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, message: `HTTP ${res.status}：${stripTags(text).slice(0, 300)}` };
  }
  const parsed = parseSoapResponse(text, op);
  return parsed;
}

module.exports = { buildEnvelope, parseSoapResponse, soapCall, esc };
