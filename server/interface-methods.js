/**
 * 电子凭证库服务端外部接口 —— 方法注册表
 *
 * 方法名与参数定义来自对原版「电子凭证库服务端外部接口测试工具」
 * (EVoucherClient.exe / EVoucherDLL.dll) 的逆向分析，对齐 realware
 * AsopFinanceService WebService 的外部接口规范。
 *
 * 参数签名约定（与截图一致）：
 *   P1[certId|证书ID]  —— 键名|中文说明
 * 所有方法默认带 certId（证书ID）与 admDivCode（区划）。
 */

// 复用相同参数组，便于维护
const P_CERT = { key: "certId", label: "证书ID" };
const P_DIV = { key: "admDivCode", label: "区划" };
const P_YEAR = { key: "stYear", label: "年度" };
const P_VT = { key: "vtCode", label: "凭证类型" };
const P_MSG = { key: "voucherMessage", label: "凭证原文", multiline: true };
const P_STAMP = { key: "stamp", label: "签章信息", multiline: true };
const P_SRO = { key: "sroOrgType", label: "发送机构类型" };
const P_DEC = { key: "decOrgType", label: "接收机构类型" };
const P_NO = { key: "voucherNo", label: "凭证编号" };

/** 参数组快捷拼接 */
function params(...ps) {
  return [P_CERT, P_DIV, P_YEAR, ...ps];
}

/**
 * 接口清单（顺序与原版工具列表一致，字母序）
 * mock(result) 返回该接口的模拟应答；未定义时走通用应答。
 */
const METHODS = [
  { name: "getVoucherFieldValue", desc: "获取凭证字段值",
    params: params(P_VT, P_NO, { key: "fieldName", label: "字段名" }),
    mock: (p) => ({ voucherNo: p.voucherNo, fieldName: p.fieldName || "voucherTitle", fieldValue: "非税收入通用票据" }) },

  { name: "importVoucher", desc: "导入凭证",
    params: params(P_VT, P_MSG),
    mock: (p) => ({ voucherNo: genVoucherNo(p), ok: true, message: "凭证导入成功" }) },

  { name: "queryMsgStatementByVoucherNo", desc: "按凭证编号查询消息对账单",
    params: params(P_VT, P_NO),
    mock: (p) => ({ voucherNo: p.voucherNo, msgNo: "MSG" + year(p) + "000123", status: "已对账" }) },

  { name: "queryMsgStatementVouchers", desc: "查询对账单凭证明细",
    params: params(P_VT, { key: "msgNo", label: "对账单编号" }),
    mock: () => ({ msgNo: "MSG2025000123", vouchers: [{ voucherNo: "2610888000001", amount: "137.50" }] }) },

  { name: "querySignVoucherStatus", desc: "查询凭证签名状态",
    params: params(P_VT, P_NO),
    mock: (p) => ({ voucherNo: p.voucherNo, signStatus: "已签名", signCount: 1 }) },

  { name: "querySignPositionWithNos", desc: "按编号查询签名位置",
    params: params(P_YEAR, { key: "voucherNos", label: "凭证编号列表", multiline: true }),
    mock: (p) => ({ positions: [{ voucherNo: (p.voucherNos || "").split(/[,;\s]/)[0] || "2610888000001", signPosition: 1 }] }) },

  { name: "queryStampPosition", desc: "查询签章位置",
    params: params(P_VT, P_NO),
    mock: (p) => ({ voucherNo: p.voucherNo, stampPositions: [{ position: 1, page: 1, x: 420, y: 60 }] }) },

  { name: "queryVoucherPrintCount", desc: "查询凭证打印次数",
    params: params(P_VT, P_NO),
    mock: (p) => ({ voucherNo: p.voucherNo, printCount: 2 }) },

  { name: "queryVoucherNoByTime", desc: "按时间查询凭证编号",
    params: params(P_VT, { key: "startDate", label: "开始日期" }, { key: "endDate", label: "结束日期" }),
    mock: () => ({ voucherNos: ["2610888000001", "2610888000002"] }) },

  { name: "queryVoucherSignStampPositions", desc: "查询凭证签章位置",
    params: params(P_VT, P_NO),
    mock: (p) => ({ voucherNo: p.voucherNo, signPositions: [1], stampPositions: [1] }) },

  { name: "queryVoucherStatusByServer", desc: "向服务端查询凭证状态",
    params: params(P_VT, P_NO),
    mock: (p) => ({ voucherNo: p.voucherNo, status: "已签章" }) },

  { name: "queryVoucherType", desc: "查询凭证类型",
    params: [P_CERT, P_DIV],
    mock: () => ({ voucherTypes: [{ vtCode: "2205", vtName: "非税收入通用票据" }, { vtCode: "2101", vtName: "财政电子票据" }] }) },

  { name: "readVoucher", desc: "读取凭证",
    params: params(P_VT, P_NO),
    mock: (p) => ({ voucherNo: p.voucherNo, voucherMessage: mockVoucherXml(p), sign: "MOCKSIGNBASE64..." }) },

  { name: "readVoucherAgain", desc: "重新读取凭证",
    params: params(P_VT, P_NO),
    mock: (p) => ({ voucherNo: p.voucherNo, voucherMessage: mockVoucherXml(p), reRead: true }) },

  { name: "readVoucherByNo", desc: "按编号读取凭证",
    params: params(P_VT, P_NO),
    mock: (p) => ({ voucherNo: p.voucherNo, voucherMessage: mockVoucherXml(p) }) },

  { name: "requestData", desc: "请求数据",
    params: params(),
    mock: () => ({ serverTime: new Date().toISOString(), certMode: "SERVER" }) },

  { name: "returnVoucher", desc: "退回凭证",
    params: params(P_VT, P_NO, { key: "reason", label: "退回原因" }),
    mock: (p) => ({ voucherNo: p.voucherNo, ok: true, message: "凭证已退回：" + (p.reason || "信息有误") }) },

  { name: "saveAndSendVoucher", desc: "保存并发送凭证",
    params: params(P_VT, P_MSG, P_SRO, P_DEC),
    mock: (p) => genSendResult("saveAndSendVoucher", p) },

  { name: "saveSignVoucher", desc: "保存签名凭证",
    params: params(P_VT, P_MSG, { key: "sign", label: "签名信息", multiline: true }),
    mock: (p) => ({ voucherNo: genVoucherNo(p), ok: true, message: "签名凭证保存成功" }) },

  { name: "saveStampVoucher", desc: "保存签章凭证",
    params: params(P_VT, P_MSG, P_STAMP),
    mock: (p) => ({ voucherNo: genVoucherNo(p), ok: true, message: "签章凭证保存成功" }) },

  { name: "sendData", desc: "发送数据",
    params: params(P_VT, P_MSG),
    mock: (p) => genSendResult("sendData", p) },

  { name: "sendData2", desc: "发送数据（通道2）",
    params: params(P_VT, P_MSG),
    mock: (p) => genSendResult("sendData2", p) },

  { name: "sendVoucher", desc: "发送凭证",
    params: params(P_VT, P_MSG, P_SRO, P_DEC),
    mock: (p) => genSendResult("sendVoucher", p) },

  { name: "sendVoucherFullSigns", desc: "发送全签名凭证",
    params: params(P_VT, P_MSG, P_SRO, P_DEC),
    mock: (p) => genSendResult("sendVoucherFullSigns", p) },

  { name: "signByNos", desc: "按编号签名",
    params: params(P_VT, P_MSG, P_SRO, P_DEC),
    mock: (p) => genSendResult("signByNos", p) },

  { name: "signByNosAndSend", desc: "按编号签名并发送",
    params: params(P_VT, P_MSG, P_SRO, P_DEC),
    mock: (p) => genSendResult("signByNosAndSend", p) },

  { name: "signStampByNos", desc: "按编号写入开发指定位置服务器签章的凭证",
    params: params(P_VT, P_MSG, P_STAMP, P_SRO, P_DEC),
    mock: (p) => genSendResult("signStampByNos", p) },

  { name: "signStampByNosAndSend", desc: "写入开发指定位置服务器签章的凭证",
    params: params(P_VT, P_MSG, P_STAMP, P_SRO, P_DEC),
    mock: (p) => genSendResult("signStampByNosAndSend", p) },

  { name: "startMsgStatement", desc: "发起消息对账",
    params: params(P_VT),
    mock: (p) => ({ msgNo: "MSG" + year(p) + "000124", ok: true, message: "对账单已生成" }) },

  { name: "writeVoucher", desc: "写入凭证",
    params: params(P_VT, P_MSG),
    mock: (p) => ({ voucherNo: genVoucherNo(p), ok: true, message: "凭证写入成功" }) },
];

// ---------------- 工具函数 ----------------

function year(p) {
  return p.stYear || String(new Date().getFullYear());
}

let _seq = 1000001;
function genVoucherNo(p) {
  if (p && p.voucherNo) return p.voucherNo;
  return "26108880" + String(_seq++);
}

/** 凭证原文报文样例（GBK 编码语义，Web 端以 UTF-8 呈现） */
function mockVoucherXml(p) {
  const no = (p && p.voucherNo) || genVoucherNo(p);
  return [
    '<?xml version="1.0" encoding="GBK"?>',
    "<VOUCHER>",
    "  <VOUCHER_NO>" + no + "</VOUCHER_NO>",
    "  <VT_CODE>" + ((p && p.vtCode) || "2205") + "</VT_CODE>",
    "  <ADM_DIV_CODE>" + ((p && p.admDivCode) || "500000") + "</ADM_DIV_CODE>",
    "  <ST_YEAR>" + year(p) + "</ST_YEAR>",
    "  <VOUCHER_TITLE>非税收入通用票据</VOUCHER_TITLE>",
    "  <PAYER>测试缴款人1</PAYER>",
    "  <TOTAL_AMOUNT>137.50</TOTAL_AMOUNT>",
    "</VOUCHER>",
  ].join("\n");
}

/**
 * 发送/签章族接口的模拟应答 —— 形如原版工具：
 * {"<凭证编号>":"<uuid>"}
 */
function genSendResult(method, p) {
  const no = genVoucherNo(p);
  const uuid = pseudoUuid();
  const r = { ok: true, method, result: { [no]: uuid } };
  return r;
}

function pseudoUuid() {
  const h = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += "-";
    else s += h[Math.floor(Math.random() * 16)];
  }
  return s;
}

/** 按名称取方法定义 */
function getMethod(name) {
  return METHODS.find((m) => m.name === name) || null;
}

/** 未知接口（真实 WSDL 解析出的方法）的通用参数模板 */
const GENERIC_PARAMS = [P_CERT, P_DIV, P_YEAR, P_VT, P_NO];

/**
 * 参数中文说明字典（对齐原版工具「P1[certId|证书ID]」的显示格式）。
 * 键名统一小写；真实 WSDL 中的拼写差异（certID/certid、srcOrgType/sroOrgType、
 * vtCode/vt_code、voucherNo/voucher_no/VoucherNo）一并归一。
 */
const PARAM_LABELS = {
  certid: "证书ID",
  admdivcode: "区划",
  styear: "年度",
  vtcode: "凭证类型",
  vt_code: "凭证类型",
  voucherno: "凭证编号",
  voucher_no: "凭证编号",
  vouchernos: "凭证编号列表",
  vouchermessage: "凭证原文",
  voucherdata: "凭证数据",
  voucherdate: "凭证日期",
  voucher: "凭证",
  vouchers: "凭证列表",
  vouchercount: "凭证张数",
  stamp: "签章信息",
  stampnos: "印章编号",
  stamp_no: "印章编号",
  sign: "签名信息",
  signedvoucher: "已签名凭证",
  srcorgtype: "发送机构类型",
  sroorgtype: "发送机构类型",
  decorgtype: "接收机构类型",
  orgtype: "机构类型",
  backstatus: "退回状态",
  startdate: "开始日期",
  enddate: "结束日期",
  starttime: "开始时间",
  endtime: "结束时间",
  checkdate: "对账日期",
  datatype: "数据类型",
  fieldname: "字段名",
  msgno: "对账单编号",
  pageno: "页号",
  message: "消息内容",
  twodcodexml: "二维码报文",
  reason: "退回原因",
  status: "状态",
  datas: "数据",
};

// ---------------- 参数联动选项（「…」按钮的下拉数据源） ----------------
const SRO_OPTIONS = [
  { value: "102", label: "102 - 财政部门" },
  { value: "103", label: "103 - 主管部门" },
  { value: "201", label: "201 - 代理银行" },
  { value: "011", label: "011 - 用票单位" },
];

const FIELD_OPTIONS = [
  { value: "VOUCHER_TITLE", label: "VOUCHER_TITLE - 凭证标题" },
  { value: "PAYER", label: "PAYER - 缴款人" },
  { value: "TOTAL_AMOUNT", label: "TOTAL_AMOUNT - 合计金额" },
];

/**
 * 取某参数的可选值（联动：以当前其它参数为上下文）。
 * 返回 {options:[{value,label}]} 或 {payload:"报文"}（复杂报文直接生成）。
 * 键名统一按小写比较（真实 WSDL 的键名大小写与本地注册表不一致，如 certID vs certId）。
 */
function getOptions(key, p, vouchers) {
  const vs = Array.isArray(vouchers) ? vouchers : [];
  switch (String(key).toLowerCase()) {
    case "certid":
      return { options: [{ value: "TC10163135", label: "TC10163135 - 默认测试证书" }] };
    case "admdivcode":
      return {
        options: [
          { value: "500000", label: "500000 - 重庆市" },
          { value: "110000", label: "110000 - 北京市" },
          { value: "310000", label: "310000 - 上海市" },
          { value: "440000", label: "440000 - 广东省" },
        ],
      };
    case "styear":
      return {
        options: [2023, 2024, 2025, 2026].map((y) => ({ value: String(y), label: String(y) + " 年度" })),
      };
    case "vtcode":
      return {
        options: [
          { value: "2205", label: "2205 - 非税收入通用票据" },
          { value: "2101", label: "2101 - 财政电子票据" },
          { value: "2301", label: "2301 - 公益捐赠票据" },
        ],
      };
    case "voucherno":
    case "vouchernos": {
      // 联动：按当前选择的年度/类型过滤凭证库
      const year = String(p.stYear || "").trim();
      const vt = String(p.vtCode || "").trim();
      let list = vs;
      if (year) list = list.filter((v) => String(v.date || "").startsWith(year));
      if (vt) list = list.filter((v) => !v.vtCode || v.vtCode === vt);
      if (!list.length) list = vs;
      const opts = list.slice(0, 50).map((v) => ({
        value: v.voucherNo,
        label: `${v.voucherNo} - ${v.voucherTypeName || ""} ¥${v.amount} ${v.status || ""}`,
      }));
      return { options: opts.length ? opts : [{ value: "2610888000001", label: "2610888000001 - 非税收入通用票据" }] };
    }
    case "msgno":
      return { options: [{ value: "MSG2025000123", label: "MSG2025000123" }, { value: "MSG2025000124", label: "MSG2025000124" }] };
    case "fieldname":
      return { options: FIELD_OPTIONS };
    case "sroorgtype":
    case "srcorgtype":
    case "orgtype":
    case "decorgtype":
      return { options: SRO_OPTIONS };
    case "reason":
      return { options: [{ value: "信息有误", label: "信息有误" }, { value: "重复入账", label: "重复入账" }, { value: "其他", label: "其他" }] };
    // ---- 复杂报文：按其它参数联动生成 ----
    case "vouchermessage":
      return { payload: mockVoucherXml({ ...p, voucherNo: p.voucherNo || genVoucherNo(p) }) };
    case "stamp":
      return {
        payload: [
          '<?xml version="1.0" encoding="GBK"?>',
          "<STAMP_INFO>",
          "  <STAMP_NO>STAMP0001</STAMP_NO>",
          "  <STAMP_POS>1</STAMP_POS>",
          "  <VOUCHER_NO>" + (p.voucherNo || genVoucherNo(p)) + "</VOUCHER_NO>",
          "  <STAMP_KEY>MOCKSTAMPKEY</STAMP_KEY>",
          "</STAMP_INFO>",
        ].join("\n"),
      };
    case "sign":
      return { payload: "MIIbBgkqhkiG9w0BBQ" + Buffer.from(String(p.voucherNo || "")).toString("base64") };
    default:
      return { options: [] };
  }
}

module.exports = { METHODS, getMethod, mockVoucherXml, genVoucherNo, getOptions, GENERIC_PARAMS, PARAM_LABELS };
