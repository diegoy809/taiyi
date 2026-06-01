// Vercel Serverless Function —— 服务器到服务器取量子随机，无跨域问题。
// 浏览器只调用同源的 /api/quantum，永远不会被 CORS 拦截。
// 依次尝试多个量子源；ANU 需要在 Vercel 环境变量里配置 ANU_API_KEY（可选）。

async function fromLfdr() {
  const r = await fetch("https://lfdr.de/qrng_api/qrng?length=48&format=HEX");
  if (!r.ok) throw new Error("lfdr " + r.status);
  const d = await r.json();
  let hex = d.qrn || d.qrng || d.data || "";
  if (Array.isArray(hex)) hex = hex.join("");
  hex = String(hex).replace(/[^0-9a-fA-F]/g, "");
  if (hex.length < 16) throw new Error("lfdr short");
  return { hex, provider: "lfdr.de 光量子 QRNG" };
}

async function fromANU() {
  const key = process.env.ANU_API_KEY;
  if (!key) throw new Error("no ANU key");
  // ANU Quantum Numbers：每个元素 8 字节(hex16)，取 6 个 = 96 个十六进制字符
  const r = await fetch("https://api.quantumnumbers.anu.edu.au?length=6&type=hex16&size=8", {
    headers: { "x-api-key": key },
  });
  if (!r.ok) throw new Error("anu " + r.status);
  const d = await r.json();
  if (!d.success || !Array.isArray(d.data)) throw new Error("anu bad");
  const hex = d.data.join("").replace(/[^0-9a-fA-F]/g, "");
  if (hex.length < 16) throw new Error("anu short");
  return { hex, provider: "ANU 量子真随机" };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  // 优先 ANU（若配了 key），否则用免 key 的 lfdr.de
  const sources = [fromANU, fromLfdr];
  for (const src of sources) {
    try {
      const out = await src();
      return res.status(200).json({ ok: true, ...out });
    } catch (e) {
      // 试下一个源
    }
  }
  return res.status(502).json({ ok: false, error: "all quantum sources failed" });
}
