const P = (p, b) => fetch("http://localhost:8721" + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const clean = (m) => String(m).replace(/^HTTP \d+：soapenv:Server\.userExceptionassp\.evoucher\.common\.util\.EVoucherException: /, "").replace(/UF10-16-28-110\s*$/, "").trim();
const H = '<?xml version="1.0" encoding="GBK"?>';
const NO = "ZFPZ001088", POS = "cz_5214_qz_01", SN = "634800bb00000033";
const mk = (attr) => `${H}<Stamps><Stamp VoucherNo="${NO}" ${attr}="${POS}" SN="${SN}"/></Stamps>`;
const cands = {
  "No": mk("No"),
  "SignNo": mk("SignNo"),
  "Position": mk("Position"),
  "Pos": mk("Pos"),
  "Name": mk("Name"),
  "StampPosition": mk("StampPosition"),
  "StampName": mk("StampName"),
  "Id": mk("Id"),
};
(async () => {
  const CTX = { certid: "TC10163135", admDivCode: "500000", stYear: "2026", vtCode: "5214", voucherNo: NO };
  const vm = await P("/api/ws/options", { key: "voucherMessage", params: CTX, method: "signStampByNosAndSend" });
  for (const [name, stamp] of Object.entries(cands)) {
    const call = await P("/api/ws/call", {
      method: "signStampByNosAndSend",
      params: { ...CTX, voucherMessage: vm.payload, stamp, srcOrgType: "102", decOrgType: "011" },
    });
    console.log(`属性 ${name} ->`, call.ok ? "★OK " + String(JSON.stringify(call.result)).slice(0, 220) : clean(call.message).slice(0, 150));
  }
})();
