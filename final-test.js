const { soapCall } = require("./server/soap");
const iconv = require("iconv-lite");
const P = (p, b) => fetch("http://localhost:8721" + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const EP = "http://10.16.28.110:7775/realware/services/AsspFinanceService", NS = "http://financeService.assp";
const S = (k) => ({ key: k, name: k, type: "soapenc:string" }), I = (k) => ({ key: k, name: k, type: "xsd:int" });
const A = (k) => ({ key: k, name: k, type: "impl:ArrayOf_soapenc_string" });
const clean = (m) => String(m).replace(/^HTTP \d+：soapenv:Server\.userExceptionassp\.evoucher\.common\.util\.EVoucherException: /, "").replace(/UF10-16-28-110\s*$/, "").trim();
const NO = "ZFPZ001088", POS = "cz_5214_qz_03";
const C = { certID: "TC10163135", admDivCode: "500000", stYear: "2026", vtCode: "5214" };

(async () => {
  // 1) 取该位置印章 SN
  const sn = await soapCall(EP, NS, "getSnInfo",
    [S("certID"), S("admDivCode"), I("stYear"), S("vtCode"), A("voucherNos"), A("stampNos")],
    { ...C, voucherNos: NO, stampNos: POS }, 20000);
  let snVal = "";
  if (sn.ok) {
    const xml = iconv.decode(Buffer.from(String(sn.result), "base64"), "gbk");
    snVal = (xml.match(/<SN>([^<]+)<\/SN>/) || [])[1] || "";
    console.log("位置", POS, "印章SN =", snVal);
  } else {
    console.log("取SN失败:", clean(sn.message).slice(0, 150), "→ 回退用 qz_01 的 SN");
    snVal = "634800bb00000033";
  }

  // 2) 构造正确格式的签章报文
  const stamp = `<?xml version="1.0" encoding="GBK"?>\r\n<Stamps>\r\n   <Stamp VoucherNo="${NO}" No="${POS}" SN="${snVal}"/>\r\n</Stamps>`;

  // 3) 取凭证原文
  const vm = await P("/api/ws/options", { key: "voucherMessage", params: { certid: C.certID, admDivCode: C.admDivCode, stYear: C.stYear, vtCode: C.vtCode, voucherNo: NO }, method: "signStampByNosAndSend" });
  console.log("凭证原文长度:", (vm.payload || "").length);

  // 4) 真实调用
  const call = await P("/api/ws/call", {
    method: "signStampByNosAndSend",
    params: { certid: C.certID, admDivCode: C.admDivCode, stYear: C.stYear, vtCode: C.vtCode, voucherMessage: vm.payload, stamp, srcOrgType: "102", decOrgType: "011" },
  });
  console.log("\n===== signStampByNosAndSend 结果 ok=" + call.ok + " =====");
  console.log(String(call.result ?? clean(call.message)).replace(/\s+/g, " ").slice(0, 500));

  // 5) 复核：该位置是否已盖章
  const chk = await soapCall(EP, NS, "queryVoucherSignStampPositions",
    [S("certID"), S("admDivCode"), I("stYear"), S("vtCode"), S("voucherNo")],
    { ...C, voucherNo: NO }, 20000);
  console.log("\n===== 复核已盖章位置 =====");
  console.log(chk.ok ? JSON.stringify(chk.result) : clean(chk.message).slice(0, 150));
})();
