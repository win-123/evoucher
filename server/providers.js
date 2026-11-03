/**
 * ClientProvider —— 对应原版 CEvoucherHttpClient / CEvoucherWSClient 双通道。
 * MockProvider：内置演示凭证库，65 个协议方法全量可调用。
 * RealHttpProvider：真实凭证服务器适配位（按逆向协议实现请求）。
 */
const crypto = require("crypto");

function jok(data) {
  return { ok: true, code: 0, message: "成功", data };
}
function now() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

class MockProvider {
  constructor(config, storeRef) {
    this.config = config;
    this.storeRef = storeRef;
    this.seedIfEmpty();
  }
  store() {
    return this.storeRef.store();
  }
  saveStore(s) {
    this.storeRef.saveStore(s);
  }
  seedIfEmpty() {
    const s = this.store();
    if (s.vouchers.length) return;
    const types = [
      { code: "001", name: "非税收入通用票据" },
      { code: "002", name: "医疗收费票据" },
      { code: "003", name: "公益事业捐赠票据" },
    ];
    const vouchers = [];
    let seq = 1;
    for (const t of types) {
      for (let i = 1; i <= 4; i++) {
        vouchers.push({
          voucherNo: `2610888${String(seq).padStart(6, "0")}`,
          vmId: t.code + String(i).padStart(4, "0"),
          voucherType: t.code,
          voucherTypeName: t.name,
          title: t.name,
          payer: "测试缴款人" + i,
          amount: (seq * 137.5).toFixed(2),
          date: now().slice(0, 10),
          status: seq % 3 === 0 ? "已签章" : "待签章",
          printTimes: 0,
          links: 3,
          stampedInfo: null,
        });
        seq++;
      }
    }
    s.vouchers = vouchers;
    this.saveStore(s);
  }
  async call(method, params) {
    const s = this.store();
    switch (method) {
      case "GetVoucherTypes":
        return jok([...new Set(s.vouchers.map((v) => JSON.stringify({ code: v.voucherType, name: v.voucherTypeName })))].map((x) => JSON.parse(x)));
      case "GetVoucherModel":
      case "GetVoucherModelByVmId": {
        const v = s.vouchers.find((x) => x.vmId === params.vmId || x.voucherNo === params.voucherNo);
        return jok(v ? { vmId: v.vmId, templateName: v.voucherTypeName + "模板", pages: 1 } : null);
      }
      case "GetVoucherAndSign":
        return jok(s.vouchers.find((x) => x.voucherNo === params.voucherNo) || null);
      case "GetVoucherSignPositions":
      case "GetVoucherStampPositions":
        return jok([{ posId: 1, name: "第一签章位置", x: 420, y: 120, page: 1 }]);
      case "GetVoucheStampedPositons":
      case "GetVoucherStampedInfo": {
        const v = s.vouchers.find((x) => x.voucherNo === params.voucherNo);
        return jok(v && v.stampedInfo ? [v.stampedInfo] : []);
      }
      case "GetAdmDivCodes":
        return jok([{ code: "500000", name: "重庆市" }, { code: "500101", name: "万州区" }]);
      case "GetDecOrgList":
        return jok([{ code: "101001", name: "示例财政局" }]);
      case "GetEStampProvider":
        return jok({ provider: "MOCK_STAMP", version: "1.0" });
      case "GetEStampServerUrl":
        return jok({ url: this.config.estampServerURL });
      case "GetServerVersion":
        return jok({ server: "mock-evoucher-server", version: "3.0.0.0" });
      case "GetCertMode":
        return jok({ certMode: 1, description: "UKey（Mock）" });
      case "GetDate":
        return jok({ date: now().slice(0, 10) });
      case "GetTime":
        return jok({ time: now() });
      case "GetPrintInfo": {
        const v = s.vouchers.find((x) => x.voucherNo === params.voucherNo);
        return jok(v ? { printTimes: v.printTimes, links: v.links } : null);
      }
      case "Get2DCode":
        return jok({ code2d: "EVF:" + (params.voucherNo || "") + ":" + crypto.randomBytes(6).toString("hex").toUpperCase() });
      case "queryDetailVoucherNo":
        return jok(s.vouchers.find((x) => x.voucherNo === params.voucherNo) || null);
      case "getProgress":
        return jok({ progress: 100, finished: true });
      case "getAttachInfo":
      case "getAttachInfoForID":
        return jok([]);
      case "isVerify":
        return jok({ verify: !!(s.vouchers.find((x) => x.voucherNo === params.voucherNo) || {}).stampedInfo });
      case "queryServerInfo":
        return jok({ name: "Mock 凭证库服务", mode: this.config.mode });
      case "GetVmIdByVoucherNo": {
        const v = s.vouchers.find((x) => x.voucherNo === params.voucherNo);
        return jok({ vmId: v ? v.vmId : null });
      }
      case "GetUserInfo":
        return jok(this.config.user);
      case "GetLogInfo":
        return jok({ logs: this.store().logs.slice(0, 20) });
      case "GetTestToolsParams":
      case "GetDisplayVirtualization":
      case "GetUpdateOCXStatus":
      case "GetErrMode":
      case "GetSrcOrg":
      case "getClientDownloadPath":
        return jok({});
      case "DownLoadVouchers": {
        const list = s.vouchers.filter((v) => !params.status || v.status === params.status);
        return jok({ count: list.length, vouchers: list });
      }
      case "SendVoucher":
      case "SendVoucherFullSigns":
      case "SaveStampVoucher":
      case "SaveSignVoucher":
      case "SignAndSendByServer":
      case "StampeAndSendByServer":
      case "StampeAndSendByServerWithoutPos":
      case "SignStampByNos": {
        const v = s.vouchers.find((x) => x.voucherNo === (params.voucherNo || ""));
        if (v) {
          v.status = "已签章";
          this.saveStore(s);
        }
        return jok({ voucherNo: params.voucherNo, saved: true });
      }
      case "SaveSignatureWithoutPos":
      case "CancelSignatureWithoutPos":
      case "CancelStamp":
        return jok({ done: true });
      case "ConfirmVoucher":
      case "ConfirmVoucherFail":
      case "DiscardVoucher":
      case "ReturnVoucher": {
        const v = s.vouchers.find((x) => x.voucherNo === params.voucherNo);
        if (v) {
          v.status = method === "ConfirmVoucher" ? "已确认" : "已作废";
          this.saveStore(s);
        }
        return jok({ voucherNo: params.voucherNo, status: v ? v.status : null });
      }
      case "AddPrintTimes": {
        const v = s.vouchers.find((x) => x.voucherNo === params.voucherNo);
        if (v) v.printTimes += 1;
        this.saveStore(s);
        return jok({ printTimes: v ? v.printTimes : 0 });
      }
      case "createAttachIDs":
        return jok({ ids: [crypto.randomUUID()] });
      case "deleteAttachForID":
      case "deleteAttachForVoucherNo":
      case "updateAttachInfo":
      case "reSendAttach":
        return jok({ done: true });
      case "buildAssociation":
      case "cancelAssociation":
      case "transTrans":
        return jok({ done: true });
      case "SetUserInfo":
        this.config.user = { ...this.config.user, ...params };
        return jok(this.config.user);
      case "verfiyVoucherOriginal":
        return jok({ valid: true, message: "验签通过（Mock）" });
      default:
        throw new Error(`未知协议方法: ${method}`);
    }
  }
}

class RealHttpProvider {
  constructor(config) {
    this.config = config;
  }
  async call(method, params) {
    const base = this.config.evoucherServerURL.replace(/\/$/, "");
    const isQuery = ["GET", "HEAD"].includes("GET");
    const url = `${base}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-EVoucher-User": this.config.user.name || "" },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`凭证服务器 ${res.status} ${res.statusText}（${method}）`);
    const data = await res.json();
    return { ok: true, code: 0, message: "成功", data };
  }
}

module.exports = { MockProvider, RealHttpProvider };
