/**
 * 参数联动解析器
 *
 * 职责：给定「当前点的是哪个参数」+「当前全部参数值」，算出该参数的可选值。
 *
 * 两条取数通道：
 *   1) 真实 SOAP 接口（服务端有字典/数据的）—— queryVoucherType / queryVoucherNosByTime /
 *      getSnInfo / getStampInfo / queryStampPosition / readVoucher / readVoucherByNo
 *   2) 内置字典（服务端未提供字典的参数，如区划、机构类型、年度）—— param-dict.js
 *
 * 联动链：证书ID → 区划 → 年度 → 凭证类型 → 凭证编号 → 凭证原文/签章信息 → 机构类型
 * 任一环节变化，下游参数都应重新点「…」取值。
 */
const iconv = require("iconv-lite");
const {
  ADM_DIVS, CERTS, ORG_TYPES, BACK_STATUS, DATA_TYPES, REASONS, STATUSES, FIELDS, STAMP_NOS,
} = require("./param-dict");
const { genVoucherNo } = require("./interface-methods");

const NOW = () => new Date();

/**
 * 测试环境印章序列号兜底值。
 * 说明：签章报文的 SN 必须与印章库里的真实印章一致，而服务端没有任何接口能「按未盖章位置查印章 SN」
 * （getSnInfo 只查已盖章位置）。当一张凭证一个章都没盖过时，只能退回这个实测值；
 * 换环境后请以「已盖章凭证的 getSnInfo」结果为准，或手工改报文里的 SN。
 * 实测来源：10.16.28.110 测试环境，印章 CN=eseal1024.7。
 */
const TEST_STAMP_SN = "634800bb00000033";

/** 大小写不敏感取值（真实 WSDL 的 certid / certID / admdivcode 混写） */
function pick(p, names) {
  const src = p || {};
  for (const n of names) {
    const k = Object.keys(src).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k !== undefined && String(src[k]).trim() !== "") return String(src[k]).trim();
  }
  return "";
}

function isBase64Type(type) {
  return /base64/i.test(String(type || ""));
}

/** 报文按参数声明的类型编码（base64Binary → GBK 字节的 base64） */
function payloadValue(xml, type) {
  if (isBase64Type(type)) return { payload: iconv.encode(String(xml), "gbk").toString("base64"), encoding: "base64(GBK)" };
  return { payload: xml, encoding: "text" };
}

/** 年度：当年 + 前后各若干年 */
function yearOptions() {
  const y = NOW().getFullYear();
  return [y + 1, y, y - 1, y - 2, y - 3].map((v) => ({ value: String(v), label: `${v} 年度` }));
}

/** 日期归一：yyyy-MM-dd / yyyyMMdd / yyyy-MM-dd HH:mm:ss → yyyyMMddHHmmss */
function toCompact(v, fallback) {
  const s = String(v || "").trim();
  const d = s.replace(/[^\d]/g, "");
  if (d.length >= 14) return d.slice(0, 14);
  if (d.length === 8) return d + "000000";
  return fallback;
}

function dateOptions() {
  const y = NOW().getFullYear();
  const p = (n) => String(n).padStart(2, "0");
  const mk = (compact, human) => ({ value: compact, label: `${compact}（${human}）` });
  return [
    mk(`${y}0101000000`, `${y}-01-01 00:00:00 本年初`),
    mk(`${y}1231235959`, `${y}-12-31 23:59:59 本年末`),
    mk(`${y}${p(NOW().getMonth() + 1)}01000000`, "本月 1 日 00:00:00"),
    mk(`${y}${p(NOW().getMonth() + 1)}${p(NOW().getDate())}000000`, "今日 00:00:00"),
    mk(`${y - 1}0101000000`, `${y - 1}-01-01 00:00:00`),
    mk(`${y - 1}1231235959`, `${y - 1}-12-31 23:59:59`),
  ];
}

/** 简易 XML 文本提取 */
function tagText(xml, tag) {
  const m = String(xml || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

/** 解服务端 base64(GBK) 报文 */
function decodeB64Text(v) {
  const s = String(v || "").trim();
  if (!s || /^[<{]/.test(s)) return s;
  try {
    return iconv.decode(Buffer.from(s, "base64"), "gbk");
  } catch (e) {
    return s;
  }
}

/**
 * 判断解出来的内容是不是「业务报文」。
 * 服务端在无数据时可能返回整包 SOAP 信封，必须当空处理，不能当凭证原文填入。
 */
function isBusinessXml(text) {
  const t = String(text || "").trim();
  if (!t || !/^</.test(t)) return false;
  if (/soapenv:Envelope|<soap:Envelope|<\w+:Envelope/i.test(t.slice(0, 600))) return false;
  if (/Response\b/i.test(t.slice(0, 600))) return false;
  return /<[A-Za-z][\w.:-]*\s*>/.test(t.slice(0, 600)) || /<[A-Za-z][\w.:-]*\/>/.test(t.slice(0, 600));
}

/** getSnInfo 返回的证书/印章序列号列表 */
function parseCertsXml(v) {
  return parseCerts(v).map((c) => ({ value: c.sn, label: `${c.sn} - ${c.dn || "服务端证书/印章"}` }));
}

/**
 * getSnInfo 应答详细解析。
 * 真实结构（实测）：base64(GBK) →
 *   <Certs><CertsCount>1</CertsCount>
 *     <Cert VoucherNo="ZFPZ001088" StampNo="cz_5214_qz_03"><SN>634800bb00000033</SN><DN>CN=eseal1024.7</DN></Cert>
 *   </Certs>
 * 返回 [{voucherNo, stampNo, sn, dn}]，用于把「签章位置 → 印章序列号」对应起来。
 */
function parseCerts(v) {
  const xml = decodeB64Text(v);
  const out = [];
  for (const m of xml.matchAll(/<Cert\b([^>]*)>([\s\S]*?)<\/Cert>/gi)) {
    const attrs = m[1] || "";
    const body = m[2] || "";
    const attr = (n) => {
      const a = attrs.match(new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`, "i"));
      return a ? a[1].trim() : "";
    };
    const sn = tagText(body, "SN") || tagText(body, "Sn") || attr("SN") || tagText(body, "CertNo");
    if (!sn) continue;
    out.push({
      voucherNo: attr("VoucherNo") || tagText(body, "VoucherNo"),
      stampNo: attr("StampNo") || tagText(body, "StampNo"),
      sn,
      dn: tagText(body, "DN"),
    });
  }
  return out;
}

/** 服务端字符串数组 → options（服务端可能返回 string 逗号分隔，也可能返回数组） */
function asList(r) {
  if (Array.isArray(r)) return r.map((x) => String(x).trim()).filter(Boolean);
  if (typeof r === "string") return r.split(/[,;、\s]+/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function arrOptions(arr, hint) {
  return (arr || []).map((v) => ({
    value: String(v),
    label: hint ? `${v} - ${hint}` : String(v),
  }));
}

/** 是否是一段 base64 数据（服务端返回值本身就是 base64 时直接透传，避免二次编码） */
function isBase64Blob(v) {
  const s = String(v || "").replace(/\s/g, "");
  return s.length > 40 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

/**
 * 服务端返回值的透传规则：
 *   - 参数是 base64Binary 且服务端给的就是 base64 → 原样透传（凭证原文就是这种情况）
 *   - 否则按参数类型把明文编码
 */
function fromServer(raw, decodedText, type) {
  if (isBase64Type(type) && isBase64Blob(raw)) {
    return { payload: String(raw).replace(/\s/g, ""), encoding: "base64（服务端原文直传）" };
  }
  return payloadValue(decodedText, type);
}

const ymd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};

/**
 * 按真实报文结构生成凭证原文（兜底用）。
 * 结构取自服务端 readVoucherByNo 的真实返回（实测）：
 *   <MOF><VoucherCount>1</VoucherCount><VoucherBody AdmDivCode StYear VtCode VoucherNo>
 *     <VoucherFlag>0</VoucherFlag><Return_Reason/><Attach/><Voucher>base64(内层凭证XML)</Voucher>
 *   </VoucherBody></MOF>
 * 内层 <Voucher> 为凭证要素 XML（Id/AdmDivCode/StYear/VtCode/VouDate/VoucherNo/PayAmt...）。
 */
function buildVoucherMof({ no, vt, div, year }) {
  const inner = [
    '<?xml version="1.0" encoding="GBK"?>',
    "",
    "<Voucher>",
    `  <Id>${Date.now()}</Id>`,
    `  <AdmDivCode>${div}</AdmDivCode>`,
    `  <StYear>${year}</StYear>`,
    `  <VtCode>${vt}</VtCode>`,
    `  <VouDate>${ymd(NOW())}</VouDate>`,
    `  <VoucherNo>${no}</VoucherNo>`,
    "  <TreCode>1400000000</TreCode>",
    "  <FundTypeCode>111</FundTypeCode>",
    "  <FundTypeName>一般公共预算资金</FundTypeName>",
    "  <PayTypeCode>2</PayTypeCode>",
    "  <PayTypeName>实拨</PayTypeName>",
    "  <PayeeAcctName>测试收款人</PayeeAcctName>",
    "  <PayAcctName>测试付款人</PayAcctName>",
    "  <AgencyName>测试预算单位</AgencyName>",
    "  <PaySummaryName>测试</PaySummaryName>",
    "  <PayAmt>100.00</PayAmt>",
    "  <CurrencyCode>CNY</CurrencyCode>",
    "  <PeriodTypeCode>01</PeriodTypeCode>",
    "</Voucher>",
  ].join("\n");
  const outer = [
    '<?xml version="1.0" encoding="GBK"?>',
    "<MOF>",
    "   <VoucherCount>1</VoucherCount>",
    `   <VoucherBody VoucherNo="${no}" AdmDivCode="${div}" StYear="${year}" VtCode="${vt}">`,
    "      <VoucherFlag>0</VoucherFlag>",
    "      <SupplementFlag>0</SupplementFlag>",
    "      <Attach></Attach>",
    `      <Voucher>${iconv.encode(inner, "gbk").toString("base64")}</Voucher>`,
    "      <SignStampList></SignStampList>",
    "      <SignatureList></SignatureList>",
    "   </VoucherBody>",
    "</MOF>",
  ].join("\n");
  return outer;
}

/**
 * 签章信息报文（2026-11-03 实测通过的真实格式）：
 *   <?xml version="1.0" encoding="GBK"?>
 *   <Root>
 *      <Stamp No="cz_5214_qz_01">6eb5a8443f094403bbc947116ce7d8af</Stamp>
 *   </Root>
 *   - 根节点必须是 Root，Stamp 成对标签
 *   - No 属性 = 签章位置（queryStampPositionWithName 返回的位置名）
 *   - 元素文本 = 印章ID（印章库 CSS_Java_GetEs_LibListBySN 返回的 32 位 ID）
 *
 * 踩坑记录（均被服务端拒绝）：
 *   <Certs>/<SignStampList> 根  → EVS708 签章列表为空
 *   <Stamps><Stamp VoucherNo No SN/></Stamps> → ESS506 签章时传入印章ID或原文数据为空
 *       （SN 属性填证书序列号/印章ID/空、内嵌签章数据 → ESS514 印章id不存在，服务端不认）
 *   <Stamp StampNo="…">         → EVS707 签章位置不存在【null】（位置属性必须叫 No）
 *   整段再转 base64             → EVS201 报文解析异常（此参数是 string，服务端要明文）
 *
 * @param {Array<{no, seal}>} items 每个签章位置一条：no=位置，seal=印章ID
 */
function buildStampXml(items) {
  const escAttr = (s) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const rows = (items || []).map(
    (it) => `   <Stamp No="${escAttr(it.no)}">${escAttr(it.seal)}</Stamp>`
  );
  return ['<?xml version="1.0" encoding="GBK"?><Root>', ...rows, "</Root>"].join("\n");
}

/**
 * 从「凭证原文」报文里解析凭证编号。
 * 必要性：signStampByNosAndSend / saveStampVoucher 这类接口的 WSDL 参数里并没有 voucherNo，
 * 服务端只靠 voucherMessage 里的 <VoucherBody VoucherNo="…"> 识别是哪张凭证。
 * 因此签章位置、已盖章状态、印章 SN 都要从这里反推编号。
 */
function voucherNoFromMessage(v) {
  const t = decodeB64Text(v);
  if (!t) return "";
  const m =
    t.match(/VoucherNo\s*=\s*"([^"]+)"/i) ||
    t.match(/<VoucherNo>\s*([^<\s]+)\s*<\/VoucherNo>/i) ||
    t.match(/<VOUCHER_NO>\s*([^<\s]+)\s*<\/VOUCHER_NO>/i);
  return m ? m[1].trim() : "";
}

/** 从「凭证原文」报文里解析凭证类型（<VoucherBody VtCode="5214">），用于发现参数与原文不一致 */
function vtCodeFromMessage(v) {
  const t = decodeB64Text(v);
  if (!t) return "";
  const m = t.match(/VtCode\s*=\s*"([^"]+)"/i) || t.match(/<VtCode>\s*([^<\s]+)\s*<\/VtCode>/i);
  return m ? m[1].trim() : "";
}

/** Axis 的 Map 应答 → key 列表（区分大小写，去重排序） */
function mapKeys(r) {
  let arr = [];
  if (Array.isArray(r)) arr = r.map((x) => String(x));
  else if (r && typeof r === "object") arr = Object.keys(r);
  else arr = asList(r);
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))].sort();
}

/**
 * 汇总签章上下文：服务端定义的全部签章位置 / 该凭证已盖章位置 / 未盖章位置。
 *   全部位置  ← queryStampPositionWithName（按凭证类型返回 cz_<vtCode>_<NN>）
 *   已盖章    ← queryVoucherSignStampPositions（返回 {位置: 印章ID}，GUID 就是该位置所盖的印章ID）
 */
async function collectStampContext(api, base, vt, no) {
  const ctx = { all: [], signed: [], unsigned: [], signedSeals: {} };
  const pn = await api.soap("queryStampPositionWithName", { ...base, vtcode: vt });
  if (pn.ok) ctx.all = mapKeys(pn.result);
  if (!ctx.all.length) {
    const p2 = await api.soap("queryStampPosition", { ...base, vtcode: vt, vouchernos: no });
    if (p2.ok) ctx.all = mapKeys(p2.result);
  }
  if (no) {
    const sp = await api.soap("queryVoucherSignStampPositions", { ...base, vtcode: vt, vouchernos: no });
    if (sp.ok && sp.result && typeof sp.result === "object" && !Array.isArray(sp.result)) {
      for (const [pos, seal] of Object.entries(sp.result)) {
        const s = String(seal || "").trim();
        ctx.signed.push(pos);
        if (/^[0-9a-f]{32}$/i.test(s)) ctx.signedSeals[pos] = s; // 32 位十六进制 = 印章ID
      }
      ctx.signed.sort();
    } else if (sp.ok) {
      ctx.signed = mapKeys(sp.result);
    }
  }
  ctx.unsigned = ctx.all.filter((pos) => !ctx.signed.includes(pos));
  return ctx;
}

/**
 * 取某个签章位置对应的印章序列号。
 * getSnInfo 要求 voucherNos 与 stampNos 两个数组元素个数相等 → 单凭证对单位置。
 */
async function fetchStampSn(api, base, vt, no, pos) {
  if (!no) return "";
  const r = await api.soap("getSnInfo", { ...base, vtcode: vt, vouchernos: no, stampnos: pos });
  if (!r.ok) return "";
  const list = parseCerts(r.result);
  const hit = list.find((c) => c.stampNo && c.stampNo === pos) || list.find((c) => c.sn) || null;
  return hit ? hit.sn : "";
}

/**
 * 取印章库列表（供填 SN 时挑印章）。
 * 印章服务地址由 Assp 的 getEStampServerUrl 返回（实测 http://10.16.28.110:8080/estamp/...），
 * 是按证书序列号查：CSS_Java_GetEs_LibListBySN(cert_sn) →
 *   "印章ID,印章名称,类型码,类型名;印章ID,..."
 */
const ESTAMP_NS = "assp.WebService.handler";
const ESTAMP_FALLBACK = "http://10.16.28.110:8080/estamp/services/AsspEStampService";

async function listEstamps(api, certId, certSn) {
  const empty = { url: "", list: [] };
  if (!api || typeof api.raw !== "function" || !certSn) return empty;
  let url = ESTAMP_FALLBACK;
  const u = await api.soap("getEStampServerUrl", { certid: certId });
  if (u.ok) {
    const t = decodeB64Text(u.result);
    if (/^https?:\/\//i.test(t)) url = t;
  }
  const ep = url.replace(/\?wsdl.*$/i, "");
  const r = await api.raw(
    ep, ESTAMP_NS, "CSS_Java_GetEs_LibListBySN",
    [{ name: "cert_sn", type: "soapenc:string" }], { cert_sn: certSn }, 15000
  );
  if (!r.ok) return { url: ep, list: [] };
  const text = decodeB64Text(Array.isArray(r.result) ? r.result[0] : r.result);
  const list = text
    .split(";")
    .map((row) => row.split(",").map((x) => String(x || "").trim()))
    .filter((cols) => cols[0])
    .map((cols) => ({ id: cols[0], name: cols[1] || "", code: cols[2] || "", typeName: cols[3] || "" }));
  return { url: ep, list };
}

/**
 * @param {object} ctx
 * @param {string} ctx.key      参数键名
 * @param {object} ctx.params   当前全部参数值
 * @param {string} ctx.type     该参数在 WSDL 中的类型（判断是否 base64Binary）
 * @param {object|null} ctx.api 真实调用通道 {soap(op, values)}；未连接/非 wsdl 模式为 null
 * @param {Array} ctx.localVouchers 本地凭证库（mock 模式的凭证编号来源）
 */
async function resolveOptions(ctx) {
  const { key, params, api, localVouchers } = ctx;
  const type = ctx.type || "";
  const k = String(key).toLowerCase();
  const p = params || {};

  const cert = pick(p, ["certid"]) || "TC10163135";
  const div = pick(p, ["admdivcode"]) || "500000";
  const year = pick(p, ["styear"]) || String(NOW().getFullYear());
  const vt = pick(p, ["vtcode", "vt_code"]);
  // 「凭证原文」里带的编号/类型：该接口没有 voucherNo 参数时（signStampByNosAndSend 等）只能从这里反推
  const msgText = pick(p, ["vouchermessage", "vouchers", "voucherdata", "signedvoucher", "voucher"]);
  const noParam = pick(p, ["voucherno", "voucher_no", "vouchernos"]);
  const no = noParam || voucherNoFromMessage(msgText);
  const vtMsg = vtCodeFromMessage(msgText);
  const base = { certid: cert, admdivcode: div, styear: year };

  /** 真实调用失败/为空时的统一回退 */
  const fallback = (dict, why) => ({ options: dict.slice(), source: "内置字典", note: why });

  switch (k) {
    /* ---------- 基础上下文 ---------- */
    case "certid": {
      if (api) {
        const r = await api.soap("getSnInfo", { ...base, vtcode: vt, vouchernos: "", stampnos: "" });
        const list = r.ok ? parseCertsXml(r.result) : [];
        if (list.length) return { options: list, source: "getSnInfo", note: `服务端 getSnInfo 返回 ${list.length} 张证书` };
      }
      return fallback(CERTS, "服务端未返回证书列表（getSnInfo 为空），使用内置测试证书");
    }

    case "admdivcode":
      return {
        options: ADM_DIVS.slice(),
        source: "内置字典",
        note: `国家标准行政区划（${ADM_DIVS.length} 项）；凭证类型等数据按所选区划向服务端实时查询`,
      };

    case "styear":
      return { options: yearOptions(), source: "内置字典", note: "年度与凭证类型、凭证编号联动，切换后请重新点下游参数的「…」" };

    /* ---------- 凭证类型：服务端实时 ---------- */
    case "vtcode":
    case "vt_code": {
      if (api) {
        const r = await api.soap("queryVoucherType", base);
        if (r.ok && Array.isArray(r.result) && r.result.length === 0) {
          return fallback([], `服务端 queryVoucherType 在 证书ID ${cert} / 区划 ${div} / 年度 ${year} 下无凭证类型`);
        }
        if (r.ok && r.result && typeof r.result === "object" && !Array.isArray(r.result)) {
          const options = Object.entries(r.result)
            .map(([code, name]) => ({ value: String(code).trim(), label: `${String(code).trim()} - ${String(name).trim()}` }))
            .sort((a, b) => a.value.localeCompare(b.value));
          return {
            options,
            source: "queryVoucherType",
            note: `服务端 queryVoucherType 返回 ${options.length} 个凭证类型（证书ID ${cert} / 区划 ${div} / 年度 ${year}）`,
          };
        }
        if (!r.ok) return fallback([], `服务端查询凭证类型失败（${r.message}）`);
      }
      return fallback([], "未连接真实服务，凭证类型无法从服务端获取");
    }

    /* ---------- 凭证编号：服务端按 年度+类型+时间 实时查 ---------- */
    case "voucherno":
    case "voucher_no":
    case "vouchernos": {
      const start = toCompact(pick(p, ["starttime", "startdate"]), `${year}0101000000`);
      const end = toCompact(pick(p, ["endtime", "enddate"]), `${year}1231235959`);
      if (api) {
        const r = await api.soap("queryVoucherNosByTime", { ...base, vtcode: vt, starttime: start, endtime: end });
        const list = r.ok ? asList(r.result) : [];
        if (list.length) {
          return {
            options: arrOptions(list, "服务端凭证"),
            source: "queryVoucherNosByTime",
            note: `服务端返回 ${list.length} 个凭证编号（年度 ${year}${vt ? " / 类型 " + vt : ""}）`,
          };
        }
        const local = (localVouchers || []).filter((v) => (!vt || v.vtCode === vt) && String(v.date || "").startsWith(year));
        if (local.length) {
          return {
            options: local.slice(0, 50).map((v) => ({ value: v.voucherNo, label: `${v.voucherNo} - ${v.voucherTypeName || ""} ¥${v.amount} ${v.status || ""}` })),
            source: "本地凭证库",
            note: `服务端该条件下无凭证编号，改用本地凭证库 ${local.length} 条`,
          };
        }
        return {
          options: [],
          source: "queryVoucherNosByTime",
          note: `服务端在该条件下无凭证编号（年度 ${year}${vt ? " / 类型 " + vt : ""} / 时间 ${start}~${end}）——该测试库无业务凭证数据，可手工输入编号`,
        };
      }
      const local = (localVouchers || []).filter((v) => !vt || v.vtCode === vt);
      return local.length
        ? { options: local.slice(0, 50).map((v) => ({ value: v.voucherNo, label: `${v.voucherNo} - ${v.voucherTypeName || ""}` })), source: "本地凭证库" }
        : { options: [{ value: "2610888000001", label: "2610888000001 - 示例编号" }], source: "内置示例", note: "未连接服务，使用内置示例编号" };
    }

    /* ---------- 凭证原文：服务端按编号读，取不到则按真实 MOF 结构生成 ---------- */
    case "vouchermessage":
    case "vouchers":
    case "voucherdata":
    case "signedvoucher":
    case "voucher": {
      // 没填凭证编号时，先按当前 年度+类型 从服务端取一个真实编号，直接读它的原文
      let targetNo = no;
      if (!targetNo && api) {
        const q = await api.soap("queryVoucherNosByTime", {
          ...base, vtcode: vt, starttime: `${year}0101000000`, endtime: `${year}1231235959`,
        });
        const list = q.ok ? asList(q.result) : [];
        if (list.length) targetNo = list[0];
      }
      if (api && targetNo) {
        const r = await api.soap("readVoucherByNo", { ...base, vtcode: vt, vouchernos: targetNo });
        if (r.ok) {
          const raw = Array.isArray(r.result) ? r.result[0] : r.result;
          const text = decodeB64Text(raw);
          if (isBusinessXml(text)) {
            const pl = fromServer(raw, text, type);
            return { ...pl, source: "readVoucherByNo", note: `已取服务端凭证原文（编号 ${targetNo}）` };
          }
        }
      }
      if (api) {
        const r = await api.soap("readVoucher", { ...base, vtcode: vt, vouchercount: "1" });
        if (r.ok) {
          const raw = Array.isArray(r.result) ? r.result[0] : r.result;
          const text = decodeB64Text(raw);
          if (isBusinessXml(text)) {
            const pl = fromServer(raw, text, type);
            return { ...pl, source: "readVoucher", note: `已取服务端待读凭证原文（类型 ${vt || "默认"}）` };
          }
        }
      }
      const xml = buildVoucherMof({ no: targetNo || no || genVoucherNo({}), vt: vt || "5207", div, year });
      const pl = payloadValue(xml, type);
      return {
        ...pl,
        source: "按模板生成",
        note:
          `服务端无凭证原文可取（该编号在 ${year} 年度 / 类型 ${vt || "-"} 下不存在），` +
          `已按真实 MOF 报文结构生成模板`,
      };
    }

    /* ---------- 签章信息：<Root><Stamp No="位置">印章ID</Stamp></Root> ---------- */
    case "stamp": {
      const placeholderSeal = (STAMP_NOS[0] && STAMP_NOS[0].value) || "STAMP0001";
      if (!api) {
        const pos = vt ? `cz_${vt}_01` : "cz_0000_01";
        const xml = buildStampXml([{ no: pos, seal: placeholderSeal }]);
        return {
          ...payloadValue(xml, type),
          source: "按模板生成",
          note: "未连接真实服务，签章位置与印章ID为占位值，连接后重新取",
        };
      }

      let sc = await collectStampContext(api, base, vt, no);
      let vtUsed = vt;
      // 参数里的凭证类型与凭证原文不一致时（漏改 vtCode 最常见），按原文里的类型再查一次位置清单
      if (!sc.all.length && vtMsg && vtMsg !== vt) {
        const sc2 = await collectStampContext(api, base, vtMsg, no);
        if (sc2.all.length) {
          sc = sc2;
          vtUsed = vtMsg;
        }
      }
      const allPos = sc.all.length ? sc.all : vtUsed ? [`cz_${vtUsed}_01`] : [];
      // cz_blz 是「不盖章」占位位置，只有在没有其它位置可选时才用它
      const stampable = (list) => list.filter((pos) => !/_blz$/i.test(pos));
      const prefer = stampable(sc.unsigned).length
        ? stampable(sc.unsigned)
        : stampable(allPos).length
        ? stampable(allPos)
        : sc.unsigned.length
        ? sc.unsigned
        : allPos;

      // 已填的签章报文里若写了位置（用户改过 No="…" 再点「…」），按它来；必须是服务端真实位置
      const curXml = String(p.stamp || "");
      const curPos = [...curXml.matchAll(/No\s*=\s*"([^"]+)"/g)].map((m) => m[1].trim());
      const curSeals = [...curXml.matchAll(/<Stamp[^>]*>\s*([0-9a-f]{32})\s*<\/Stamp>/gi)].map((m) => m[1]);
      const explicit = curPos.filter((pos) => pos && (!sc.all.length || sc.all.includes(pos)));
      // 默认只盖「第一个未盖章位置」——原版客户端也是逐个位置调签章，多位置一次提交容易被单点失败拖累
      const targets = explicit.length ? explicit : prefer.slice(0, 1);

      if (!targets.length) {
        return {
          ...payloadValue(buildStampXml([]), type),
          source: "queryStampPositionWithName",
          note: `凭证 ${no || "(未选编号)"} 在类型 ${vt || "-"} 下无可用签章位置，报文为空`,
        };
      }

      /* —— 印章ID的真实来源（实测：<Stamp> 元素文本必须是印章库里的 32 位印章ID，
       *    填证书序列号 634800bb… 服务端报 ESS506/ESS514）——
       * 优先级：用户报文里已写的 > 本凭证已盖位置用过的（同一张凭证通常同一枚章）> 印章库第一枚
       */
      const lib = await listEstamps(api, cert, TEST_STAMP_SN);
      const tally = {};
      for (const seal of Object.values(sc.signedSeals || {})) tally[seal] = (tally[seal] || 0) + 1;
      const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      const defaultSeal =
        curSeals[0] || (ranked.length ? ranked[0][0] : "") || (lib.list[0] && lib.list[0].id) || placeholderSeal;

      const items = targets.map((pos) => ({ no: pos, seal: defaultSeal }));
      const xml = buildStampXml(items);
      const sealFrom =
        curSeals[0] ? "沿用你报文里已写的印章ID"
        : ranked.length ? "沿用本凭证已盖位置用过的印章"
        : lib.list.length ? "取印章库第一枚，如与业务不符请在报文里直接改"
        : "印章库取不到，暂用占位值，请手工替换为真实印章ID";

      const parts = [];
      if (vtUsed !== vt) {
        parts.push(
          `注意：参数凭证类型 ${vt || "(空)"} 与凭证原文类型 ${vtUsed} 不一致，已按原文类型取位置，调用前请把凭证类型改成 ${vtUsed}`
        );
      }
      parts.push(
        sc.all.length
          ? `服务端定义签章位置 ${sc.all.length} 个，已盖章 ${sc.signed.length} 个` +
              (sc.signed.length ? `（${sc.signed.join("、")}）` : "") +
              `，未盖章 ${sc.unsigned.length} 个` +
              (sc.unsigned.length ? `（${sc.unsigned.join("、")}）` : "")
          : `服务端未按类型返回位置清单，按类型推导位置 ${allPos.join("、")}`
      );
      if (lib.list.length) {
        parts.push(
          `印章库 ${lib.list.length} 枚：` +
            lib.list.map((s) => `${s.name}${s.typeName ? "[" + s.typeName + "]" : ""}`).join("、")
        );
      }
      if (!no) parts.push("未选凭证编号，无法核对已盖章位置与印章，请先选凭证编号再取");

      /* —— 供用户选择：签章位置 × 印章 组合（原版客户端即 DlgSelectStampId 选择式交互）——
       * 未盖章位置排前、已盖章标注、cz_blz（不盖章占位）排最后；
       * 每个候选项的值就是组装好的 <Root><Stamp No="位置">印章ID</Stamp></Root>，选中即填入 */
      const restPos = allPos.filter((x) => !prefer.includes(x));
      const posOrder = [...new Set([...explicit, ...prefer, ...restPos, ...allPos])];
      // 推荐印章排最前，第一项候选即推荐组合
      const libSeals = lib.list.map((s) => s.id);
      const sealList = defaultSeal
        ? [defaultSeal, ...libSeals.filter((id) => id !== defaultSeal)]
        : libSeals;
      const nameOf = (id) => {
        const s = lib.list.find((x) => x.id === id);
        return s ? `${s.name}${s.typeName ? "[" + s.typeName + "]" : ""}` : id;
      };
      const options = [];
      for (const pos of posOrder) {
        for (const seal of sealList) {
          options.push({
            value: buildStampXml([{ no: pos, seal }]),
            label:
              `${pos} × ${nameOf(seal)}` +
              (sc.signed.includes(pos) ? "（已盖章，重盖报 EVS507）" : "") +
              (/_blz$/i.test(pos) ? "（不盖章占位）" : ""),
          });
        }
      }
      if (options.length > 1) {
        return {
          options,
          source: "queryStampPositionWithName + 印章库",
          note: parts.join("；") + `；推荐第一项：${targets.join("、")} × ${nameOf(defaultSeal)}`,
          extra: {
            positions: sc.all,
            signed: sc.signed,
            unsigned: sc.unsigned,
            sealsByPosition: sc.signedSeals,
            estampUrl: lib.url,
            seals: lib.list,
          },
        };
      }

      return {
        ...payloadValue(xml, type),
        source: "queryVoucherSignStampPositions",
        note: parts.join("；") + `；印章ID=${defaultSeal}（${sealFrom}）`,
        extra: {
          positions: sc.all,
          signed: sc.signed,
          unsigned: sc.unsigned,
          used: targets,
          seal: defaultSeal,
          sealsByPosition: sc.signedSeals,
          estampUrl: lib.url,
          seals: lib.list,
        },
      };
    }

    case "stampnos":
    case "stamp_no": {
      // 印章编号的真实候选＝本凭证已盖章位置用过的印章 SN（getSnInfo 只认已盖章位置）
      if (api) {
        const sc = await collectStampContext(api, base, vt || vtMsg, no);
        const sns = [];
        for (const pos of sc.signed) {
          const sn = await fetchStampSn(api, base, vt || vtMsg, no, pos);
          if (sn && !sns.includes(sn)) sns.push(sn);
        }
        if (sns.length) {
          return {
            options: sns.map((sn) => ({ value: sn, label: `${sn} - 本凭证已用印章` })),
            source: "getSnInfo",
            note: `凭证 ${no} 的 ${sc.signed.length} 个已盖章位置共用 ${sns.length} 枚印章`,
          };
        }
      }
      return fallback(STAMP_NOS, "服务端未返回印章序列号（无已盖章记录），使用内置测试印章");
    }

    /* ---------- 机构类型 ---------- */
    case "srcorgtype":
    case "sroorgtype":
    case "decorgtype":
      return {
        options: ORG_TYPES.slice(),
        source: "内置字典",
        note: "机构类型取自 EVoucherDLL 逆向常量（102 财政 / 103 主管 / 201 银行 / 011 用票单位）",
      };

    case "orgtype": {
      // getStampInfo 的 orgType 决定能取到哪类机构的印章，先探一次哪些机构类型有印章
      if (api) {
        const avail = [];
        for (const o of ORG_TYPES) {
          const r = await api.soap("getStampInfo", { ...base, orgtype: o.value }, 8000).catch(() => ({ ok: false }));
          const v = r.ok ? (Array.isArray(r.result) ? r.result.length : r.result ? 1 : 0) : 0;
          if (v) avail.push(o);
        }
        if (avail.length) return { options: avail, source: "getStampInfo", note: `服务端有印章的机构类型 ${avail.length} 个` };
      }
      return { options: ORG_TYPES.slice(), source: "内置字典" };
    }

    /* ---------- 日期/时间：服务端接口要求 yyyyMMddHHmmss ---------- */
    case "starttime":
    case "endtime":
    case "startdate":
    case "enddate":
    case "checkdate":
      return {
        options: dateOptions().map((o) => ({ value: o.value, label: o.label })),
        source: "内置字典",
        note: "服务端日期参数要求 yyyyMMddHHmmss，选择后自动使用该格式",
      };

    /* ---------- 枚举类 ---------- */
    case "fieldname":
      return { options: FIELDS.slice(), source: "内置字典", note: "字段名为凭证报文真实节点（服务端要求首字母大写，如 PayAmt / AgencyName）" };
    case "backstatus":
      return { options: BACK_STATUS.slice(), source: "内置字典" };
    case "datatype":
      return { options: DATA_TYPES.slice(), source: "内置字典" };
    case "reason":
      return { options: REASONS.slice(), source: "内置字典" };
    case "status":
      return { options: STATUSES.slice(), source: "内置字典" };
    case "pageno": {
      return { options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `第 ${n} 页` })), source: "内置字典" };
    }
    case "vouchercount": {
      return { options: [1, 2, 3, 5, 10].map((n) => ({ value: String(n), label: `${n} 张` })), source: "内置字典" };
    }
    case "msgno": {
      const y = year;
      return {
        options: [
          { value: `MSG${y}000123`, label: `MSG${y}000123` },
          { value: `MSG${y}000124`, label: `MSG${y}000124` },
        ],
        source: "内置示例",
        note: "对账单编号由 startMsgStatement 生成后回填",
      };
    }
    case "errmsg":
      return {
        options: [
          { value: "凭证信息有误", label: "凭证信息有误" },
          { value: "凭证已入账", label: "凭证已入账" },
          { value: "凭证不存在", label: "凭证不存在" },
          { value: "签章校验失败", label: "签章校验失败" },
        ],
        source: "内置字典",
        note: "退回凭证时回传给调用方的错误描述",
      };

    /* ---------- 报文类 ---------- */
    case "twodcodexml": {
      const xml = [
        '<?xml version="1.0" encoding="GBK"?>',
        "<QRCODE>",
        `  <VOUCHER_NO>${no || genVoucherNo({})}</VOUCHER_NO>`,
        `  <VT_CODE>${vt || ""}</VT_CODE>`,
        `  <ADM_DIV_CODE>${div}</ADM_DIV_CODE>`,
        `  <ST_YEAR>${year}</ST_YEAR>`,
        "</QRCODE>",
      ].join("\n");
      const pl = payloadValue(xml, type);
      return { ...pl, source: "按模板生成", note: "二维码报文按当前参数生成" };
    }
    case "message":
    case "sign": {
      if (k === "sign") {
        const s = `SIGN|${cert}|${vt || ""}|${no || ""}|${year}`;
        const pl = payloadValue(s, type);
        return { ...pl, source: "按模板生成", note: "签名信息按当前参数生成（客户端签章后由 UKey 返回真实值）" };
      }
      const xml = buildVoucherMof({ no: no || genVoucherNo({}), vt: vt || "5207", div, year });
      const pl = payloadValue(xml, type);
      return { ...pl, source: "按模板生成", note: "message 为 base64Binary，已按 MOF 报文结构生成并转 base64(GBK)" };
    }

    default:
      return {
        options: [],
        source: "无",
        note: `参数 ${key} 服务端与内置字典均无候选值，请手工输入`,
      };
  }
}

module.exports = { resolveOptions, pick, decodeB64Text, parseCerts, parseCertsXml, buildStampXml, toCompact };
