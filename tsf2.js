const P = (p, b) => fetch("http://localhost:8721" + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const clean = (m) => String(m).replace(/^HTTP \d+：soapenv:Server\.userExceptionassp\.evoucher\.common\.util\.EVoucherException: /, "").replace(/UF10-16-28-110\s*$/, "").trim();
const H = '<?xml version="1.0" encoding="GBK"?>';
const NO = "ZFPZ001088", POS = "cz_5214_qz_01", SN = "634800bb00000033";
const cands = {
  A_Signatures:
    `${H}<Signatures><Sign_Path Type="Stamps" No="${POS}"><SN>${SN}</SN></Sign_Path></Signatures>`,
  B_SignStampList:
    `${H}<SignStampList><SignStamp VoucherNo="${NO}" StampNo="${POS}" SN="${SN}"/></SignStampList>`,
  C_Stamps:
    `${H}<Stamps><Stamp VoucherNo="${NO}" StampNo="${POS}" SN="${SN}"/></Stamps>`,
  D_SignStamps:
    `${H}<SignStamps><SignStamp VoucherNo="${NO}" StampNo="${POS}"><SN>${SN}</SN></SignStamp></SignStamps>`,
  E_Detail:
    `${H}<SignStampInfoDetail><VoucherNo>${NO}</VoucherNo><StampNo>${POS}</StampNo><SN>${SN}</SN></SignStampInfoDetail>`,
  F_Signature:
    `${H}<Signature VoucherNo="${NO}" StampNo="${POS}" SN="${SN}"/>`,
};
(async () => {
  const CTX = { certid: "TC10163135", admDivCode: "500000", stYear: "2026", vtCode: "5214", voucherNo: NO };
  const vm = await P("/api/ws/options", { key: "voucherMessage", params: CTX, method: "signStampByNosAndSend" });
  for (const [name, stamp] of Object.entries(cands)) {
    const call = await P("/api/ws/call", {
      method: "signStampByNosAndSend",
      params: { ...CTX, voucherMessage: vm.payload, stamp, srcOrgType: "102", decOrgType: "011" },
    });
    console.log(`[${name}] ->`, call.ok ? "★OK " + String(JSON.stringify(call.result)).slice(0, 220) : clean(call.message).slice(0, 160));
  }
})();
