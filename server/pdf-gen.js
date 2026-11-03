/**
 * EVoucher X - 凭证 PDF 预览生成器
 * 复刻原版 "凭证模板 + 报文数据 → PDF"（CPdfDoc）的最小实现：
 * 用内置模板把凭证数据排成 A4 联次页。
 */
function esc(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function makeSampleVoucherPdf(v) {
  const lines = [];
  const H = 792; // A4 612x792pt
  let y = H - 80;
  const P = (t, x, size, font) => {
    lines.push(`BT /${font || "F2"} ${size || 12} Tf ${x} ${y} Td (${esc(t)}) Tj ET`);
    y -= (size || 12) + 10;
  };
  // 纯 ASCII 之外的内容用 WinAnsi 不安全 —— 演示用拼音/ASCII 标注，
  // 实际模板由凭证服务器下发（GetVoucherModel）。
  P("E-Voucher (Electronic Voucher Library)", 60, 16);
  P("Type: " + (v.voucherTypeName || "") + "  [" + v.voucherType + "]", 60, 12);
  P("Voucher No: " + v.voucherNo, 60, 12);
  P("Date: " + v.date, 60, 12);
  P("Payer: " + v.payer, 60, 12);
  P("Amount: CNY " + v.amount, 60, 14);
  P("Status: " + v.status + "   PrintTimes: " + v.printTimes, 60, 12);
  y -= 10;
  P("Links: " + v.links + "   VM-ID: " + v.vmId, 60, 10, "F1");
  if (v.stampedInfo) {
    y -= 6;
    P("STAMP: " + v.stampedInfo.position + "  CN=" + v.stampedInfo.certCN, 60, 10, "F1");
    P("Signed at " + v.stampedInfo.time + "  SN=" + v.stampedInfo.certSN, 60, 10, "F1");
  }
  const content = lines.join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    out += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out;
}

module.exports = { makeSampleVoucherPdf };
