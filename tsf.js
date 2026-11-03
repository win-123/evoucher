const iconv = require("iconv-lite");
const P = (p, b) => fetch("http://localhost:8721" + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const clean = (m) => String(m).replace(/^HTTP \d+：soapenv:Server\.userExceptionassp\.evoucher\.common\.util\.EVoucherException: /, "").replace(/UF10-16-28-110\s*$/, "").trim();
const NO = "ZFPZ001088", POS = "cz_5214_qz_01", SN = "634800bb00000033";
const certsXml = '<?xml version="1.0" encoding="GBK"?>\r\n<Certs>\r\n   <CertsCount>1</CertsCount>\r\n   <Cert VoucherNo="' + NO + '" StampNo="' + POS + '">\r\n      <SN>' + SN + '</SN>\r\n   </Cert>\r\n</Certs>';
const variants = {
  "Certs 明文XML": certsXml,
  "Certs base64": iconv.encode(certsXml, "gbk").toString("base64"),
  "位置,SN": `${POS},${SN}`,
  "仅SN": SN,
  "位置=SN;": `${POS}=${SN};`,
};
(async () => {
  const CTX = { certid: "TC10163135", admDivCode: "500000", stYear: "2026", vtCode: "5214", voucherNo: NO };
  const vm = await P("/api/ws/options", { key: "voucherMessage", params: CTX, method: "signStampByNosAndSend" });
  console.log("凭证原文长度:", (vm.payload || "").length);
  for (const [name, stampVal] of Object.entries(variants)) {
    const call = await P("/api/ws/call", {
      method: "signStampByNosAndSend",
      params: { ...CTX, voucherMessage: vm.payload, stamp: stampVal, srcOrgType: "102", decOrgType: "011" },
    });
    console.log(`[${name}] ->`, call.ok ? "★OK " + String(JSON.stringify(call.result)).slice(0, 200) : clean(call.message).slice(0, 170));
  }
})();
