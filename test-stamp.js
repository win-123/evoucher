/** 验证 stamp 参数联动：真实服务 → 全部位置 / 已盖章 / 未盖章 / 印章SN / <Stamps> 报文 */
const BASE = "http://localhost:8721";
const P = (p, b) =>
  fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());

const WSDL = "http://10.16.28.110:7775/realware/services/AsspFinanceService?wsdl";
const CTX = {
  certid: "TC10163135",
  admDivCode: "500000",
  stYear: "2026",
  vtCode: "5214",
  voucherNo: "ZFPZ001088",
};

(async () => {
  const c = await P("/api/ws/connect", { url: WSDL });
  console.log("连接:", c.ok, c.source, (c.message || "").slice(0, 90));

  for (const [key, ctx] of [
    ["stamp", CTX],
    ["stamp", { ...CTX, voucherNo: "" }],
    ["stamp", { ...CTX, stamp: '<?xml version="1.0" encoding="GBK"?><Stamps><Stamp VoucherNo="ZFPZ001088" No="cz_5214_qz_04" SN=""/></Stamps>' }],
    ["stampnos", CTX],
  ]) {
    const r = await P("/api/ws/options", { key, params: ctx, method: "signStampByNosAndSend" });
    console.log("\n=== key=" + key, "voucherNo=" + (ctx.voucherNo || "(空)"), "stamp=" + (ctx.stamp ? "已填报文(取其中No)" : "-"));
    console.log("source :", r.source);
    console.log("note   :", r.note);
    if (r.payload !== undefined) {
      console.log("encoding:", r.encoding);
      console.log("payload :\n" + r.payload);
    }
    if (r.options) console.log("options:", r.options.length, JSON.stringify(r.options.slice(0, 4)));
  }
})();
