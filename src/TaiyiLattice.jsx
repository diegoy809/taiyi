import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { MapPin, Compass, Eye, Sparkles, Navigation2, RefreshCw, ChevronRight, Activity, CircleDot, Wind } from "lucide-react";

/* ===================================================================
   太乙 · 晶格罗盘  (Taiyi Lattice Compass)
   一个融合 格里贝格"晶格论 / 转移电位" 与《太乙金华宗旨》回光 的
   现实坐标互动探索应用 —— 类 Randonautica，纯娱乐。
   =================================================================== */

/* ---------- 几何与统计工具 ---------- */
const R_EARTH = 6371000;
const DEG = Math.PI / 180;

/* ---------- 量子熵源 ----------
   取真量子随机（光量子）作种子，展开成确定性高质量伪随机序列，
   用以生成点云——与 Randonautica 取 ANU 量子源的做法同理。
   若跨域被沙盒拦截，则透明回退到 crypto.getRandomValues。      */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromHex(hex) {
  let s = 0x9e3779b9 >>> 0;
  for (let i = 0; i + 1 < hex.length; i += 2) {
    s = (s ^ parseInt(hex.substr(i, 2), 16)) >>> 0;
    s = Math.imul(s, 0x01000193) >>> 0;
  }
  return s >>> 0;
}
async function fetchQuantum(timeoutMs = 9000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // 调用本站服务端函数，由它去服务器到服务器取量子随机（无跨域、可藏 key）
    const res = await fetch("/api/quantum", { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok) return null;
    const hex = String(data.hex || "").replace(/[^0-9a-fA-F]/g, "");
    if (hex.length < 16) return null;
    return { hex, provider: data.provider || "量子 QRNG" };
  } catch (e) {
    clearTimeout(to);
    return null;
  }
}
async function getEntropy() {
  const q = await fetchQuantum();
  if (q) {
    return {
      rng: mulberry32(seedFromHex(q.hex)),
      source: "quantum",
      label: "量子真随机 · " + q.provider,
      seed: q.hex.slice(0, 16).toUpperCase(),
    };
  }
  // 回退：浏览器密码学随机（硬件熵，非量子）
  try {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    const s = (buf[0] ^ buf[1]) >>> 0;
    return {
      rng: mulberry32(s),
      source: "crypto",
      label: "本地密码学随机 · crypto（量子源不可用，已回退）",
      seed: s.toString(16).toUpperCase().padStart(8, "0"),
    };
  } catch (e) {
    const s = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    return { rng: mulberry32(s), source: "math", label: "Math.random 回退", seed: s.toString(16) };
  }
}

function randPointInDisk(lat, lng, radiusM, rng) {
  const rnd = rng || Math.random;
  // 面积均匀分布：r = R*sqrt(u)
  const w = radiusM * Math.sqrt(rnd());
  const t = 2 * Math.PI * rnd();
  const dx = w * Math.cos(t);
  const dy = w * Math.sin(t);
  const dLat = dy / 111320;
  const dLng = dx / (111320 * Math.cos(lat * DEG));
  return { lat: lat + dLat, lng: lng + dLng, x: dx, y: dy };
}

function haversine(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * DEG;
  const dLng = (lng2 - lng1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1, lng1, lat2, lng2) {
  const y = Math.sin((lng2 - lng1) * DEG) * Math.cos(lat2 * DEG);
  const x =
    Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
    Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lng2 - lng1) * DEG);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

const COMPASS_16 = ["北","北东偏北","东北","东偏东北","东","东偏东南","东南","南偏东南","南","南偏西南","西南","西偏西南","西","西偏西北","西北","北偏西北"];
function compassName(b) { return COMPASS_16[Math.round(b / 22.5) % 16]; }

/* ---------- 晶格分析：在圆盘内做密度网格，找吸引子/空点 ---------- */
function analyzeLattice(points, radiusM, gridN, mode) {
  const cell = (2 * radiusM) / gridN;
  const cells = {}; // key -> {count, sx, sy, cx, cy}
  let inDiskCells = 0;
  // 预生成圆盘内的有效单元
  const valid = [];
  for (let i = 0; i < gridN; i++) {
    for (let j = 0; j < gridN; j++) {
      const cx = -radiusM + (i + 0.5) * cell;
      const cy = -radiusM + (j + 0.5) * cell;
      if (cx * cx + cy * cy <= radiusM * radiusM) {
        const key = i + "_" + j;
        cells[key] = { count: 0, sx: 0, sy: 0, cx, cy };
        valid.push(key);
        inDiskCells++;
      }
    }
  }
  for (const p of points) {
    const i = Math.floor((p.x + radiusM) / cell);
    const j = Math.floor((p.y + radiusM) / cell);
    const key = i + "_" + j;
    if (cells[key]) {
      cells[key].count++;
      cells[key].sx += p.x;
      cells[key].sy += p.y;
    }
  }
  const expected = points.length / inDiskCells;
  const std = Math.sqrt(expected) || 1;

  let attractor = null, voidc = null, maxC = -1, minC = Infinity;
  for (const key of valid) {
    const c = cells[key];
    if (c.count > maxC) { maxC = c.count; attractor = c; }
    if (c.count < minC) { minC = c.count; voidc = c; }
  }

  const pack = (c, sign) => {
    const n = c.count || 1;
    const cx = c.count > 0 ? c.sx / c.count : c.cx;
    const cy = c.count > 0 ? c.sy / c.count : c.cy;
    const z = (c.count - expected) / std;
    return { x: cx, y: cy, count: c.count, z, power: Math.abs(z), expected };
  };

  const att = pack(attractor, 1);
  const vd = pack(voidc, -1);

  let chosen;
  if (mode === "attractor") chosen = { ...att, kind: "attractor" };
  else if (mode === "void") chosen = { ...vd, kind: "void" };
  else chosen = att.power >= vd.power ? { ...att, kind: "attractor" } : { ...vd, kind: "void" };

  return { chosen, att, vd, cells, valid, cell, expected, inDiskCells };
}

function metersToLatLng(baseLat, baseLng, x, y) {
  const dLat = y / 111320;
  const dLng = x / (111320 * Math.cos(baseLat * DEG));
  return { lat: baseLat + dLat, lng: baseLng + dLng };
}

/* ---------- 解读语料：回光 / 晶格 / 转移电位 ---------- */
const PHASE_GOLDEN = [
  "回光守中","坎离交媾","百日筑基","金华乍吐","天心初现","元神返照","止观双运","真意凝定",
];
const READ_LIGHT = [
  "光自此处回旋而下，宜静坐片刻再启程。",
  "金华于此凝聚，所见之物即是镜中之光。",
  "天心一点已落于此，前往时切勿散乱。",
  "回光至此而止，外景皆为内照之投影。",
  "此处坎水上升、离火下降，留意水与火的意象。",
];
const READ_LATTICE_ATT = [
  "晶格在此高度凝聚——神经场已将其局部去结构化，形成一个吸引子。",
  "此点的晶格密度远高于背景，是空间被意识「折叠」出的褶皱。",
  "随机性在此坍缩成秩序，格里贝格所谓的「晶格凝结」正发生于此。",
];
const READ_LATTICE_VOID = [
  "晶格在此被稀释成空洞——一处被抽离了结构的「留白」。",
  "此为空点：晶格密度低于背景，像被意识熨平的一块场。",
  "随机性在此过度均匀，反而成了另一种异常——虚的吸引。",
];
const READ_TRANSFER = [
  "你与晶格之间的转移电位已建立，所见之物或与出发前的意念相关联。",
  "如同两颗同步的大脑，你与该坐标已处于一次非局域的相关之中。",
  "EPR 式的关联已悄然连通——留心第一眼落到的事物。",
  "转移电位仍在维持，途中遇到的「巧合」值得记录。",
];
function pick(arr, seed) { return arr[Math.abs(seed) % arr.length]; }

function buildReading(chosen, intention, sync) {
  const seed = Math.round((chosen.x + chosen.y) * 1000) + Math.round(chosen.power * 97) + intention.length;
  const phase = pick(PHASE_GOLDEN, seed);
  const lat = chosen.kind === "attractor" ? pick(READ_LATTICE_ATT, seed >> 1) : pick(READ_LATTICE_VOID, seed >> 1);
  const light = pick(READ_LIGHT, seed >> 2);
  const transfer = pick(READ_TRANSFER, seed >> 3);
  return { phase, lines: [lat, light, transfer] };
}

/* ---------- 背景星点 ---------- */
function Starfield() {
  const stars = useMemo(() =>
    Array.from({ length: 70 }, () => ({
      x: Math.random() * 100, y: Math.random() * 100,
      s: Math.random() * 1.6 + 0.3, d: Math.random() * 6,
    })), []);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {stars.map((st, i) => (
        <div key={i} style={{
          position: "absolute", left: st.x + "%", top: st.y + "%",
          width: st.s, height: st.s, borderRadius: "50%",
          background: "#E8C170", opacity: 0.5,
          animation: `twinkle 4s ${st.d}s infinite ease-in-out`,
        }} />
      ))}
    </div>
  );
}

/* =================================================================== */
export default function TaiyiLattice() {
  const [step, setStep] = useState("intro"); // intro | locate | breathe | intent | result
  const [coord, setCoord] = useState(null);  // {lat,lng}
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [geoErr, setGeoErr] = useState("");
  const [sync, setSync] = useState(0);
  const [intention, setIntention] = useState("");
  const [mode, setMode] = useState("anomaly");
  const [radius, setRadius] = useState(2000);
  const [result, setResult] = useState(null);
  const [computing, setComputing] = useState(false);

  /* ---- 定位 ---- */
  const tryGeo = useCallback(() => {
    setGeoErr("");
    if (!navigator.geolocation) { setGeoErr("此环境不支持定位，请手动输入坐标。"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoord({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStep("breathe");
      },
      () => setGeoErr("无法获取定位（可能被沙盒屏蔽）。请手动输入坐标，或用示例坐标。"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const useManual = () => {
    const la = parseFloat(manualLat), ln = parseFloat(manualLng);
    if (isNaN(la) || isNaN(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
      setGeoErr("坐标格式不对。纬度 -90~90，经度 -180~180。"); return;
    }
    setCoord({ lat: la, lng: ln }); setStep("breathe");
  };
  const useSample = () => { setCoord({ lat: 39.9163, lng: 116.3972 }); setStep("breathe"); };

  /* ---- 回光调息 ---- */
  const [scale, setScale] = useState(0.45);
  const [phaseName, setPhaseName] = useState("回光内照 · 吸");
  const breatheRef = useRef({ start: 0, cycles: 0, raf: 0 });
  useEffect(() => {
    if (step !== "breathe") return;
    const phases = [
      { name: "回光内照 · 吸", dur: 4000, from: 0.45, to: 1 },
      { name: "守中 · 息", dur: 2500, from: 1, to: 1 },
      { name: "金华下沉 · 呼", dur: 6000, from: 1, to: 0.45 },
    ];
    const total = phases.reduce((s, p) => s + p.dur, 0);
    breatheRef.current.start = performance.now();
    const loop = (now) => {
      const el = (now - breatheRef.current.start) % total;
      const cyc = Math.floor((now - breatheRef.current.start) / total);
      if (cyc !== breatheRef.current.cycles) {
        breatheRef.current.cycles = cyc;
        setSync((s) => Math.min(100, s + 25));
      }
      let acc = 0, cur = phases[0], localT = 0;
      for (const p of phases) {
        if (el < acc + p.dur) { cur = p; localT = (el - acc) / p.dur; break; }
        acc += p.dur;
      }
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * localT);
      setScale(cur.from + (cur.to - cur.from) * eased);
      setPhaseName(cur.name);
      breatheRef.current.raf = requestAnimationFrame(loop);
    };
    breatheRef.current.raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(breatheRef.current.raf);
  }, [step]);

  /* ---- 生成 ---- */
  const pointsRef = useRef([]);
  const analysisRef = useRef(null);
  const [phase2, setPhase2] = useState(""); // 加载阶段文案
  const generate = async () => {
    if (!coord) return;
    setComputing(true);
    setPhase2("正在采集量子熵…");
    const ent = await getEntropy();
    setPhase2(ent.source === "quantum" ? "量子熵已就位 · 折叠晶格…" : "熵已就位 · 折叠晶格…");
    await new Promise((r) => setTimeout(r, 650));
    const N = 9000, GRID = 36;
    const pts = [];
    for (let i = 0; i < N; i++) pts.push(randPointInDisk(coord.lat, coord.lng, radius, ent.rng));
    pointsRef.current = pts;
    const ana = analyzeLattice(pts, radius, GRID, mode);
    analysisRef.current = ana;
    const ll = metersToLatLng(coord.lat, coord.lng, ana.chosen.x, ana.chosen.y);
    const dist = haversine(coord.lat, coord.lng, ll.lat, ll.lng);
    const brg = bearing(coord.lat, coord.lng, ll.lat, ll.lng);
    const reading = buildReading(ana.chosen, intention, sync);
    setResult({
      ...ll, dist, brg, kind: ana.chosen.kind,
      power: ana.chosen.power, z: ana.chosen.z, count: ana.chosen.count,
      expected: ana.expected, reading, gx: ana.chosen.x, gy: ana.chosen.y,
      entropy: ent,
    });
    setComputing(false);
    setStep("result");
  };

  const reset = () => {
    setStep("intro"); setCoord(null); setResult(null); setSync(0);
    setIntention(""); setManualLat(""); setManualLng(""); setGeoErr("");
  };
  const goAgain = () => { setSync(0); setStep("breathe"); };

  /* ================= 样式基底 ================= */
  const bg = "radial-gradient(120% 90% at 50% 0%, #1a1530 0%, #100c1f 45%, #07050f 100%)";
  const gold = "#E8C170", goldBright = "#F5D98B", cyan = "#5FE3D0", violet = "#A77BE0";
  const serif = "'Noto Serif SC', 'Songti SC', serif";
  const cally = "'Ma Shan Zheng', 'Noto Serif SC', serif";

  return (
    <div style={{ minHeight: "100vh", background: bg, color: "#ECE6F5", fontFamily: serif, position: "relative", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&family=Ma+Shan+Zheng&family=Cinzel:wght@500;700&display=swap');
        @keyframes twinkle{0%,100%{opacity:.15}50%{opacity:.7}}
        @keyframes spinSlow{to{transform:rotate(360deg)}}
        @keyframes spinRev{to{transform:rotate(-360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
        @keyframes pulseGlow{0%,100%{filter:drop-shadow(0 0 6px rgba(232,193,112,.5))}50%{filter:drop-shadow(0 0 22px rgba(232,193,112,.9))}}
        @keyframes dash{to{stroke-dashoffset:0}}
        .fu{animation:fadeUp .7s both}
        .softbtn{transition:all .25s ease}
        .softbtn:hover{transform:translateY(-1px)}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:#3a3055;border-radius:3px}
      `}</style>
      <Starfield />

      <div style={{ position: "relative", maxWidth: 480, margin: "0 auto", padding: "26px 20px 64px" }}>

        {/* 顶题 */}
        <div className="fu" style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontFamily: cally, fontSize: 40, color: gold, letterSpacing: 4, lineHeight: 1, textShadow: "0 0 24px rgba(232,193,112,.4)" }}>太乙金華</div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: 11, letterSpacing: 6, color: cyan, marginTop: 8, opacity: .85 }}>LATTICE&nbsp;·&nbsp;COMPASS</div>
        </div>

        {/* ============ INTRO ============ */}
        {step === "intro" && (
          <div className="fu" style={{ animationDelay: ".1s" }}>
            <SyntergicMandala gold={gold} cyan={cyan} />
            <Card>
              <p style={{ fontSize: 14.5, lineHeight: 1.95, color: "#d8d0ea" }}>
                这是一台<b style={{ color: gold }}>晶格罗盘</b>。它把你脚下的现实空间看作格里贝格（Jacobo&nbsp;Grinberg）所说的
                <b style={{ color: cyan }}> 晶格场（lattice）</b>——一片承载信息的预空间结构。
              </p>
              <p style={{ fontSize: 14.5, lineHeight: 1.95, color: "#d8d0ea", marginTop: 12 }}>
                依《太乙金华宗旨》先行<b style={{ color: gold }}>回光</b>调息，借大脑与场之间的
                <b style={{ color: violet }}> 转移电位</b>设定意念；罗盘随即在你周围撒下随机点云，从中寻出晶格的
                <b style={{ color: cyan }}> 吸引子</b>或<b style={{ color: violet }}> 空点</b>，交还一个真实坐标，请你亲身前往验证。
              </p>
            </Card>
            <PrimaryBtn gold={gold} goldBright={goldBright} onClick={() => setStep("locate")}>
              开始 · 立罗盘 <ChevronRight size={18} />
            </PrimaryBtn>
            <Disclaimer />
          </div>
        )}

        {/* ============ LOCATE ============ */}
        {step === "locate" && (
          <div className="fu">
            <Card>
              <Label icon={<MapPin size={16} />} gold={gold}>确定立足之点</Label>
              <button className="softbtn" onClick={tryGeo} style={btnGhost(cyan)}>
                <Navigation2 size={16} /> 使用我的实时定位
              </button>
              {geoErr && <p style={{ color: "#E59", fontSize: 12.5, margin: "10px 2px", lineHeight: 1.6 }}>{geoErr}</p>}

              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 12px", opacity: .5, fontSize: 12 }}>
                <div style={{ flex: 1, height: 1, background: "#4a4068" }} /> 或手动 <div style={{ flex: 1, height: 1, background: "#4a4068" }} />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <input value={manualLat} onChange={(e) => setManualLat(e.target.value)} placeholder="纬度 lat" style={inp()} inputMode="decimal" />
                <input value={manualLng} onChange={(e) => setManualLng(e.target.value)} placeholder="经度 lng" style={inp()} inputMode="decimal" />
              </div>
              <button className="softbtn" onClick={useManual} style={{ ...btnGhost(gold), marginTop: 12 }}>
                <MapPin size={15} /> 以此坐标立罗盘
              </button>
              <button onClick={useSample} style={{ background: "none", border: "none", color: "#9a90b8", fontSize: 12.5, marginTop: 14, cursor: "pointer", textDecoration: "underline", fontFamily: serif }}>
                没有坐标？使用示例（北京 · 景山）
              </button>
            </Card>
          </div>
        )}

        {/* ============ BREATHE 回光 ============ */}
        {step === "breathe" && (
          <div className="fu" style={{ textAlign: "center" }}>
            <div style={{ position: "relative", width: 260, height: 260, margin: "10px auto 6px" }}>
              {/* 旋转晶格环 */}
              <svg width="260" height="260" style={{ position: "absolute", inset: 0, animation: "spinSlow 28s linear infinite" }}>
                <g fill="none" stroke={cyan} strokeOpacity="0.28">
                  {Array.from({ length: 12 }).map((_, i) => {
                    const a = (i / 12) * 2 * Math.PI;
                    return <line key={i} x1={130} y1={130} x2={130 + 122 * Math.cos(a)} y2={130 + 122 * Math.sin(a)} />;
                  })}
                  <circle cx="130" cy="130" r="122" /><circle cx="130" cy="130" r="86" strokeDasharray="3 6" />
                </g>
              </svg>
              {/* 金华呼吸球 */}
              <div style={{
                position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <div style={{
                  width: 150, height: 150, borderRadius: "50%",
                  transform: `scale(${scale})`, transition: "transform .08s linear",
                  background: `radial-gradient(circle at 50% 45%, ${goldBright}, ${gold} 45%, rgba(232,193,112,0.05) 75%)`,
                  boxShadow: `0 0 ${30 + scale * 40}px rgba(232,193,112,${0.3 + scale * 0.4})`,
                }} />
              </div>
            </div>
            <div style={{ fontFamily: cally, fontSize: 26, color: gold, letterSpacing: 3 }}>{phaseName}</div>
            <p style={{ color: "#b9b0d2", fontSize: 13, lineHeight: 1.8, margin: "10px auto 0", maxWidth: 300 }}>
              收视返听，光自双目之间回旋而下。随金华之球起伏调息，与晶格建立<b style={{ color: violet }}>转移电位</b>。
            </p>
            {/* 同步率 */}
            <div style={{ margin: "20px auto 0", maxWidth: 320 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: cyan, marginBottom: 6 }}>
                <span><Activity size={12} style={{ verticalAlign: -2 }} /> 转移电位 · 同步率</span><span>{sync}%</span>
              </div>
              <div style={{ height: 8, background: "#241d3a", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: sync + "%", background: `linear-gradient(90deg, ${violet}, ${cyan})`, transition: "width .5s ease", boxShadow: `0 0 10px ${cyan}` }} />
              </div>
            </div>
            <PrimaryBtn gold={gold} goldBright={goldBright} onClick={() => setStep("intent")} disabled={sync < 25}>
              {sync < 25 ? "至少完成一次回光…" : "光已凝定 · 设意念"} <ChevronRight size={18} />
            </PrimaryBtn>
          </div>
        )}

        {/* ============ INTENT ============ */}
        {step === "intent" && (
          <div className="fu">
            <Card>
              <Label icon={<Eye size={16} />} gold={gold}>守一 · 立意念</Label>
              <p style={{ fontSize: 13, color: "#b9b0d2", lineHeight: 1.7, marginBottom: 12 }}>
                心中默存一个问题、一种心情，或一样想遇见的事物。不写也可，让晶格自行作答。
              </p>
              <textarea value={intention} onChange={(e) => setIntention(e.target.value)} rows={2}
                placeholder="例如：我今天该留意什么？" style={{ ...inp(), width: "100%", resize: "none", fontFamily: serif }} />

              <Label icon={<CircleDot size={16} />} gold={gold} style={{ marginTop: 22 }}>取象 · 晶格形态</Label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {[
                  { k: "attractor", t: "吸引子", d: "凝聚", c: gold },
                  { k: "void", t: "空点", d: "稀释", c: violet },
                  { k: "anomaly", t: "异常", d: "随缘", c: cyan },
                ].map((o) => (
                  <button key={o.k} onClick={() => setMode(o.k)} className="softbtn" style={{
                    padding: "12px 6px", borderRadius: 12, cursor: "pointer", fontFamily: serif,
                    background: mode === o.k ? `${o.c}22` : "#1d172e",
                    border: `1px solid ${mode === o.k ? o.c : "#332a4d"}`,
                    color: mode === o.k ? o.c : "#cabfe2",
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{o.t}</div>
                    <div style={{ fontSize: 11, opacity: .7, marginTop: 2 }}>{o.d}</div>
                  </button>
                ))}
              </div>

              <Label icon={<Compass size={16} />} gold={gold} style={{ marginTop: 22 }}>步程 · 搜索半径</Label>
              <input type="range" min={500} max={8000} step={250} value={radius}
                onChange={(e) => setRadius(parseInt(e.target.value))}
                style={{ width: "100%", accentColor: gold }} />
              <div style={{ textAlign: "center", color: cyan, fontSize: 14, marginTop: 4 }}>
                {radius >= 1000 ? (radius / 1000).toFixed(radius % 1000 ? 2 : 0) + " 公里" : radius + " 米"}
              </div>
            </Card>
            <PrimaryBtn gold={gold} goldBright={goldBright} onClick={generate} disabled={computing}>
              {computing ? <><RefreshCw size={17} style={{ animation: "spinSlow 1s linear infinite" }} /> {phase2 || "折叠晶格中…"}</> : <><Sparkles size={17} /> 撒点 · 寻坐标</>}
            </PrimaryBtn>
          </div>
        )}

        {/* ============ RESULT ============ */}
        {step === "result" && result && (
          <div className="fu">
            <LatticeViz analysis={analysisRef.current} radius={radius} result={result} gold={gold} cyan={cyan} violet={violet} />

            <Card style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontFamily: cally, fontSize: 24, color: result.kind === "attractor" ? gold : violet }}>
                  {result.kind === "attractor" ? "吸引子" : "空点"}
                </span>
                <span style={{ fontFamily: "'Cinzel',serif", fontSize: 12, color: cyan }}>
                  power {result.power.toFixed(2)} · z {result.z.toFixed(2)}
                </span>
              </div>
              <div style={{ fontFamily: cally, fontSize: 17, color: gold, marginTop: 6, letterSpacing: 2 }}>
                金华 · {result.reading.phase}
              </div>

              {/* 坐标 + 罗盘 */}
              <div style={{ display: "flex", gap: 14, alignItems: "center", margin: "16px 0", padding: "14px", background: "#16112599", borderRadius: 14, border: "1px solid #2c2444" }}>
                <CompassDial brg={result.brg} gold={gold} cyan={cyan} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "monospace", fontSize: 15, color: goldBright }}>{result.lat.toFixed(6)}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 15, color: goldBright }}>{result.lng.toFixed(6)}</div>
                  <div style={{ fontSize: 13, color: cyan, marginTop: 6 }}>
                    {compassName(result.brg)} · {result.brg.toFixed(0)}°
                  </div>
                  <div style={{ fontSize: 13, color: "#cabfe2" }}>
                    距你 {result.dist >= 1000 ? (result.dist / 1000).toFixed(2) + " km" : result.dist.toFixed(0) + " m"}
                  </div>
                </div>
              </div>

              {/* 解读 */}
              <div style={{ borderLeft: `2px solid ${gold}`, paddingLeft: 12 }}>
                {result.reading.lines.map((l, i) => (
                  <p key={i} style={{ fontSize: 14, lineHeight: 1.85, color: "#ddd5ef", marginBottom: 8 }}>{l}</p>
                ))}
              </div>

              {intention.trim() && (
                <div style={{ marginTop: 12, fontSize: 12.5, color: "#9a90b8", fontStyle: "italic" }}>
                  你的意念：「{intention.trim()}」
                </div>
              )}

              {/* 熵源标注 */}
              {result.entropy && (
                <div style={{
                  marginTop: 14, display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
                  borderRadius: 11, fontSize: 12,
                  background: result.entropy.source === "quantum" ? "#5FE3D012" : "#A77BE012",
                  border: `1px solid ${result.entropy.source === "quantum" ? "#5FE3D055" : "#A77BE055"}`,
                  color: result.entropy.source === "quantum" ? "#7af0dd" : "#c3a3ea",
                }}>
                  <Sparkles size={13} />
                  <span style={{ flex: 1, lineHeight: 1.5 }}>
                    熵源：{result.entropy.label}
                    <br /><span style={{ opacity: .7, fontFamily: "monospace" }}>seed {result.entropy.seed}</span>
                  </span>
                </div>
              )}

              {/* 地图链接 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
                <MapLink href={`https://www.google.com/maps/search/?api=1&query=${result.lat},${result.lng}`} c={cyan}>Google 地图</MapLink>
                <MapLink href={`https://www.openstreetmap.org/?mlat=${result.lat}&mlon=${result.lng}#map=17/${result.lat}/${result.lng}`} c={cyan}>OpenStreetMap</MapLink>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <MapLink href={`https://maps.apple.com/?ll=${result.lat},${result.lng}&q=Lattice`} c={cyan}>Apple 地图</MapLink>
                <MapLink href={`https://uri.amap.com/marker?position=${result.lng},${result.lat}&name=晶格点`} c={cyan}>高德地图</MapLink>
              </div>
            </Card>

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button onClick={goAgain} className="softbtn" style={{ ...btnGhost(gold), flex: 1 }}>
                <Wind size={15} /> 再回光 · 重寻
              </button>
              <button onClick={reset} className="softbtn" style={{ ...btnGhost("#8a80a8"), flex: 1 }}>
                <RefreshCw size={15} /> 重新立罗盘
              </button>
            </div>
            <Disclaimer />
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================== 子组件 ===================== */
function Card({ children, style }) {
  return <div style={{
    background: "linear-gradient(160deg,#1c162e 0%,#15101f 100%)",
    border: "1px solid #2e2545", borderRadius: 18, padding: 20,
    boxShadow: "inset 0 1px 0 #ffffff0a, 0 10px 30px #00000040", ...style,
  }}>{children}</div>;
}

function Label({ children, icon, gold, style }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 7, color: gold, fontSize: 14, fontWeight: 600, marginBottom: 12, letterSpacing: 1, ...style }}>{icon}{children}</div>;
}

function PrimaryBtn({ children, onClick, gold, goldBright, disabled }) {
  return <button onClick={onClick} disabled={disabled} className="softbtn" style={{
    width: "100%", marginTop: 18, padding: "15px", borderRadius: 14, cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "'Noto Serif SC',serif", fontSize: 15.5, fontWeight: 600, letterSpacing: 2,
    color: disabled ? "#7a7090" : "#1a1208", border: "none",
    background: disabled ? "#2a2340" : `linear-gradient(135deg,${goldBright},${gold})`,
    boxShadow: disabled ? "none" : `0 6px 20px rgba(232,193,112,.3)`,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  }}>{children}</button>;
}

function btnGhost(c) {
  return {
    width: "100%", padding: "13px", borderRadius: 12, cursor: "pointer",
    background: `${c}14`, border: `1px solid ${c}66`, color: c,
    fontFamily: "'Noto Serif SC',serif", fontSize: 14.5, fontWeight: 600, letterSpacing: 1,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  };
}
function inp() {
  return {
    flex: 1, padding: "12px 14px", borderRadius: 11, background: "#120d20",
    border: "1px solid #332a4d", color: "#ECE6F5", fontSize: 14, outline: "none",
  };
}

function MapLink({ href, children, c }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="softbtn" style={{
    textAlign: "center", padding: "11px", borderRadius: 11, textDecoration: "none",
    background: `${c}12`, border: `1px solid ${c}55`, color: c, fontSize: 13.5, fontWeight: 600,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  }}><Navigation2 size={13} />{children}</a>;
}

function Disclaimer() {
  return <p style={{ fontSize: 11, color: "#6e6588", lineHeight: 1.7, marginTop: 18, textAlign: "center" }}>
    纯属娱乐与探索，相关理论尚无科学定论。前往时请注意人身安全，遵守法律，勿擅闯私人或危险区域，结伴而行，量力而止。
  </p>;
}

/* 入门页的曼陀罗（晶格 + 金华） */
function SyntergicMandala({ gold, cyan }) {
  return (
    <div style={{ width: 200, height: 200, margin: "0 auto 18px", position: "relative" }}>
      <svg viewBox="0 0 200 200" width="200" height="200" style={{ position: "absolute", animation: "spinSlow 40s linear infinite" }}>
        <g fill="none" stroke={cyan} strokeOpacity=".3">
          {Array.from({ length: 18 }).map((_, i) => {
            const a = (i / 18) * 2 * Math.PI;
            return <line key={i} x1="100" y1="100" x2={100 + 92 * Math.cos(a)} y2={100 + 92 * Math.sin(a)} />;
          })}
          <circle cx="100" cy="100" r="92" /><circle cx="100" cy="100" r="64" />
        </g>
      </svg>
      <svg viewBox="0 0 200 200" width="200" height="200" style={{ position: "absolute", animation: "spinRev 30s linear infinite" }}>
        <g fill="none" stroke={gold} strokeOpacity=".55" strokeWidth="1.2">
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i / 8) * 2 * Math.PI;
            return <ellipse key={i} cx="100" cy="100" rx="20" ry="52"
              transform={`rotate(${(a / Math.PI) * 180} 100 100)`} />;
          })}
        </g>
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: `radial-gradient(circle,${gold},transparent)`, animation: "pulseGlow 3s infinite" }} />
      </div>
    </div>
  );
}

/* 结果罗盘指针 */
function CompassDial({ brg, gold, cyan }) {
  return (
    <svg width="74" height="74" viewBox="0 0 74 74">
      <circle cx="37" cy="37" r="34" fill="#0d0a18" stroke="#33294d" />
      {[0, 90, 180, 270].map((a, i) => {
        const r = a * DEG;
        return <text key={i} x={37 + 26 * Math.sin(r)} y={37 - 26 * Math.cos(r) + 4}
          fontSize="8" fill={cyan} textAnchor="middle">{["北", "东", "南", "西"][i]}</text>;
      })}
      <g transform={`rotate(${brg} 37 37)`} style={{ transition: "transform .8s ease" }}>
        <polygon points="37,9 32,40 42,40" fill={gold} style={{ filter: "drop-shadow(0 0 4px " + gold + ")" }} />
        <polygon points="37,65 32,40 42,40" fill="#5a4d78" />
      </g>
      <circle cx="37" cy="37" r="3" fill={gold} />
    </svg>
  );
}

/* 晶格场可视化：圆盘 + 密度热点 + 选中点 + 方向线 */
function LatticeViz({ analysis, radius, result, gold, cyan, violet }) {
  const S = 320, C = S / 2, pad = 14, R = C - pad;
  if (!analysis) return null;
  const m2px = (m) => (m / radius) * R;

  // 采样热点单元用于绘制
  const cellEls = useMemo(() => {
    const els = [];
    let maxC = 1;
    for (const k of analysis.valid) maxC = Math.max(maxC, analysis.cells[k].count);
    for (const k of analysis.valid) {
      const c = analysis.cells[k];
      const intensity = c.count / maxC;
      if (intensity < 0.45) continue; // 只画较热的，保持清爽
      els.push(
        <circle key={k} cx={C + m2px(c.cx)} cy={C - m2px(c.cy)} r={Math.max(1.5, intensity * 7)}
          fill={cyan} opacity={0.06 + intensity * 0.28} />
      );
    }
    return els;
  }, [analysis]);

  const px = C + m2px(result.gx);
  const py = C - m2px(result.gy);
  const isAtt = result.kind === "attractor";
  const accent = isAtt ? gold : violet;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${S} ${S}`} width="100%" style={{ display: "block" }}>
        <defs>
          <radialGradient id="disk" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1a1530" /><stop offset="100%" stopColor="#0c0918" />
          </radialGradient>
        </defs>
        <circle cx={C} cy={C} r={R} fill="url(#disk)" stroke="#2e2548" />
        {/* 晶格细网 */}
        <g stroke="#3a3158" strokeOpacity=".25">
          {Array.from({ length: 9 }).map((_, i) => {
            const off = (i - 4) * (R / 4.5);
            const half = Math.sqrt(Math.max(0, R * R - off * off));
            return <g key={i}>
              <line x1={C + off} y1={C - half} x2={C + off} y2={C + half} />
              <line x1={C - half} y1={C + off} x2={C + half} y2={C + off} />
            </g>;
          })}
        </g>
        {cellEls}
        {/* 方向线 */}
        <line x1={C} y1={C} x2={px} y2={py} stroke={accent} strokeOpacity=".6" strokeWidth="1.5" strokeDasharray="4 4" />
        {/* 中心（你） */}
        <circle cx={C} cy={C} r="5" fill="#fff" />
        <circle cx={C} cy={C} r="9" fill="none" stroke="#fff" strokeOpacity=".4" />
        {/* 选中点 */}
        <circle cx={px} cy={py} r="13" fill="none" stroke={accent} strokeOpacity=".5">
        </circle>
        <circle cx={px} cy={py} r="6" fill={accent} style={{ filter: `drop-shadow(0 0 8px ${accent})` }} />
      </svg>
      <div style={{ position: "absolute", top: 10, left: 12, fontSize: 11, color: "#8c83a8", fontFamily: "'Cinzel',serif", letterSpacing: 1 }}>
        SYNTERGIC LATTICE · 9000 pts
      </div>
      <div style={{ position: "absolute", bottom: 10, right: 12, fontSize: 11, color: accent }}>
        {isAtt ? "● 凝聚 attractor" : "○ 稀释 void"}
      </div>
    </div>
  );
}
