/* 컨피규레이터 핵심 로직 — DOM·Three.js 의존 없음.
   명세서 §6-3: 같은 코드가 클라이언트와 서버 양쪽에서 돌아야 가격이 어긋나지 않는다.
   그래서 이 파일은 순수 함수만 둔다. 서버로 옮길 때 그대로 import 하면 된다. */

// ── 자재 상수 ───────────────────────────────────────────────
// ⚠ 단가는 전부 [추정]이다. 기획서 §12와 같은 한계 — 을지로 실견적으로 교체해야 한다.
export const SERIES = {
  "2020": { w: 20, h: 20, I: 6800,  kgPerM: 0.49, cost: 4200, label: "2020" },
  "2040": { w: 20, h: 40, I: 44000, kgPerM: 0.98, cost: 7800, label: "2040" },
  "3030": { w: 30, h: 30, I: 31000, kgPerM: 1.10, cost: 9500, label: "3030" },
};

export const E_AL = 68900;        // 6063-T5 탄성계수 N/mm² (Vention 설계 가이드)
export const PULLOUT_KN = 7.2;    // 체결당 풀아웃 설계값 kN (Vention)
export const BRACKET_KN = { std: 1.8, heavy: 4.5 };  // 브래킷 등급별 한계 kN [추정]
export const STOCK_MM = 6000;     // 프로파일 원장

// 가공·부자재 단가 [추정] — 을지로 실견적으로 교체 대상
export const BRACKET_WON = { std: 1400, heavy: 3200 };  // 코너 브래킷 1개
export const FASTENER_WON = 820;   // 레일 끝 1곳: 탭 가공 + 볼트 + T너트
export const FOOT_WON = 1800;      // 수평조절풋
export const CUT_WON = 450;        // 절단 1회
export const PANEL_CUT_WON = 1200; // 패널 재단 1장
export const EDGE_WON = 1600;      // 엣지 마감 1m
export const PACK_BASE = 6000, PACK_PER5 = 1200;

export const MATERIALS = {
  lpm:     { label: "LPM 화이트",   won: 28000, color: 0xE8E6E0, kgM2: 11.5 },
  birch:   { label: "HPL 자작",     won: 46000, color: 0xD6C3A2, kgM2: 12.0 },
  walnut:  { label: "월넛",         won: 72000, color: 0x5A4330, kgM2: 12.6 },
  acrylic: { label: "컬러 아크릴",  won: 95000, color: 0xC66A4A, kgM2: 14.3 },
};

export const FINISHES = {
  black:  { label: "블랙 아노다이징", color: 0x1C1C1E, rough: 0.34 },
  silver: { label: "실버",            color: 0xB8B9BC, rough: 0.30 },
  white:  { label: "화이트",          color: 0xE4E4E2, rough: 0.42 },
};

export const PRESETS = {
  desk:      { label: "데스크",     w: 1200, d: 600, h: 740,  cols: 2, rows: 2, material: "birch" },
  shelf:     { label: "선반",       w: 900,  d: 350, h: 1800, cols: 1, rows: 5, material: "lpm" },
  sideboard: { label: "사이드보드", w: 1600, d: 400, h: 800,  cols: 2, rows: 3, material: "walnut" },
};

export const LIMITS = { w: [300, 2400], d: [250, 700], h: [300, 2100], cols: [1, 6], rows: [2, 6] };
export const STEP = 10;           // R2 — 10mm 그리드
export const MIN_CUT = 30;        // R1 — 가공 설비 한계
export const GM = 0.35;           // 목표 매출총이익률

export function defaultDesign(preset = "sideboard") {
  const p = PRESETS[preset];
  return {
    name: "내 가구 1", preset,
    series: "2020", finish: "black", material: p.material, bracket: "std",
    w: p.w, d: p.d, h: p.h, cols: p.cols, rows: p.rows,
    load: 10,                     // 칸당 kg
    removed: [],                  // 비운 칸 "level,bay"
    panelMaterials: {},           // 칸별 소재 덮어쓰기. 없는 칸은 material 을 따른다
    rowHeights: null,             // 자유 모드에서만 채워진다 (null = 균등)
    room: null,                   // { wallW, wallH, depth }
  };
}

export const cellKey = (level, bay) => `${level},${bay}`;
/** 그 칸의 실제 소재 키. 덮어쓴 값이 없으면 기본 소재. */
export function cellMaterial(d, level, bay) {
  const m = d.panelMaterials?.[cellKey(level, bay)];
  return MATERIALS[m] ? m : d.material;
}

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
export const snap = (v) => Math.round(v / STEP) * STEP;

export function normalize(d) {
  d.w = clamp(snap(d.w), LIMITS.w);
  d.d = clamp(snap(d.d), LIMITS.d);
  d.h = clamp(snap(d.h), LIMITS.h);
  d.cols = clamp(Math.round(d.cols), LIMITS.cols);
  d.rows = clamp(Math.round(d.rows), LIMITS.rows);
  d.load = Math.max(0, Math.round(d.load));
  if (!BRACKET_WON[d.bracket]) d.bracket = "std";
  if (!MATERIALS[d.material]) d.material = "lpm";
  if (d.rowHeights && d.rowHeights.length !== d.rows) d.rowHeights = null;

  /* 칸 수가 줄면 범위 밖 키가 남는다. 그대로 두면 칸을 다시 늘렸을 때
     예전 소재가 유령처럼 되살아난다. 기본값과 같은 키도 같이 버린다. */
  const pm = {};
  for (const [k, v] of Object.entries(d.panelMaterials ?? {})) {
    const [j, b] = k.split(",").map(Number);
    if (!MATERIALS[v] || v === d.material) continue;
    if (!(j >= 0 && j < d.rows && b >= 0 && b < d.cols)) continue;
    pm[k] = v;
  }
  d.panelMaterials = pm;
  return d;
}

// ── 단면 윤곽 ───────────────────────────────────────────────
/* T슬롯 단면을 좌표로 직접 그린다. 명세서 §9의 판단 — 프로파일은 모델 파일이
   아니라 런타임 생성이다. 길이만 다른 무한 조합을 파일로 관리할 수 없다.
   한 면을 만들고 90°씩 돌려 4면을 잇는다. 20mm 모듈마다 슬롯 하나. */
function faceOutline(len, t) {
  const CH = 1.5;                                   // 모서리 챔퍼
  const n = Math.max(1, Math.round(len / 20));
  const pts = [[len / 2 - CH, t]];
  for (let i = n - 1; i >= 0; i--) {                // +x → -x 방향 (CCW)
    const c = ((i + 0.5) / n - 0.5) * len;
    pts.push([c + 3.0, t], [c + 3.0, t - 1.8], [c + 5.2, t - 3.2], [c + 5.2, t - 4.8],
             [c - 5.2, t - 4.8], [c - 5.2, t - 3.2], [c - 3.0, t - 1.8], [c - 3.0, t]);
  }
  pts.push([-(len / 2 - CH), t]);
  return pts;
}

/** 시리즈의 단면 윤곽을 mm 단위 [x,y] 배열로 돌려준다 (원점 중심, 닫힌 루프). */
export function profileOutline(series) {
  const { w, h } = SERIES[series];
  const out = [];
  for (let k = 0; k < 4; k++) {
    const even = k % 2 === 0;
    const face = faceOutline(even ? w : h, (even ? h : w) / 2);
    const a = (Math.PI / 2) * k, ca = Math.cos(a), sa = Math.sin(a);
    for (const [x, y] of face) out.push([x * ca - y * sa, x * sa + y * ca]);
  }
  return out;
}

// ── 부재 생성 ───────────────────────────────────────────────
/* 반환하는 bar 는 {axis, len, pos:[x,y,z]} — pos 는 부재 중심, mm.
   edges(체결 그래프)를 따로 들지 않고 joints 수만 센다. P0 BOM 에는 그걸로 충분하고,
   명세서 §6-1 의 edges 는 작업지시서를 뽑을 때 필요해진다. */
export function buildParts(d) {
  const P = SERIES[d.series].w;
  const bays = d.cols, levels = d.rows;
  const pitch = (d.w - P) / bays;                   // 기둥 중심 간격
  const postX = Array.from({ length: bays + 1 }, (_, i) => P / 2 + i * pitch);
  const postY = [P / 2, d.d - P / 2];

  // 단 높이 — 자유 모드면 사용자가 정한 값, 아니면 균등
  let zs;
  if (d.rowHeights) {
    let acc = P / 2; zs = [];
    for (let j = 0; j < levels; j++) { zs.push(acc); acc += d.rowHeights[j]; }
  } else {
    const span = d.h - P;
    zs = Array.from({ length: levels }, (_, j) => P / 2 + (levels > 1 ? (j * span) / (levels - 1) : span / 2));
  }

  const bars = [];
  const xRailLen = pitch - P;
  const yRailLen = d.d - 2 * P;

  for (const x of postX) for (const y of postY)
    bars.push({ kind: "post", axis: "z", len: d.h, pos: [x, y, d.h / 2] });

  for (const z of zs) {
    for (const y of postY)
      for (let b = 0; b < bays; b++)
        bars.push({ kind: "xrail", axis: "x", len: xRailLen, pos: [(postX[b] + postX[b + 1]) / 2, y, z] });
    for (const x of postX)
      bars.push({ kind: "yrail", axis: "y", len: yRailLen, pos: [x, d.d / 2, z] });
  }

  const removed = new Set(d.removed);
  const panels = [];
  for (let j = 0; j < levels; j++)
    for (let b = 0; b < bays; b++) {
      if (removed.has(cellKey(j, b))) continue;
      panels.push({
        level: j, bay: b, w: pitch, d: d.d - P, t: 18,
        material: cellMaterial(d, j, b),
        pos: [(postX[b] + postX[b + 1]) / 2, d.d / 2, zs[j] + P / 2 + 9],
        span: xRailLen,
      });
    }

  const feet = postX.flatMap((x) => postY.map((y) => [x, y]));
  const rails = bars.filter((b) => b.kind !== "post");
  return { bars, panels, feet, joints: rails.length * 2, zs, postX, pitch, xRailLen, yRailLen };
}

// ── 규칙 엔진 (R1–R9) ───────────────────────────────────────
/** 중앙 집중하중 처짐. 80/20 문서의 D = L³W/(48EI). L,δ 는 mm, W 는 N. */
export function deflection(L, W_N, I) { return (L ** 3 * W_N) / (48 * E_AL * I); }

const PANEL_MAX_SPAN = { 12: 600, 15: 760, 18: 900 };   // 18T 합판 20kg 기준 [추정]

export function validate(d, parts = buildParts(d), quote = null) {
  const S = SERIES[d.series];
  const out = [];
  const add = (level, id, msg, fixes = []) => out.push({ level, id, msg, fixes });

  // R1 — 절단 최소 길이
  const shortest = Math.min(parts.xRailLen, parts.yRailLen);
  if (shortest < MIN_CUT)
    add("error", "R1", `절단 길이 ${Math.round(shortest)}mm — ${MIN_CUT}mm 미만은 제작할 수 없습니다`,
        [{ label: "폭 늘리기", patch: { w: snap(d.w + 120) } }]);

  // R2 — 그리드 스냅 (입력에서 막지만 외부 주입 대비)
  if ([d.w, d.d, d.h].some((v) => v % STEP !== 0))
    add("error", "R2", `치수는 ${STEP}mm 단위여야 합니다`, [{ label: "맞추기", patch: { w: snap(d.w), d: snap(d.d), h: snap(d.h) } }]);

  // R3 — 처짐. 한 칸 하중을 앞뒤 레일 2개가 나눠 받는다
  const L = parts.xRailLen;
  const W_N = (d.load * 9.81) / 2;
  const dz = deflection(L, W_N, S.I);
  const limit = L / 300;
  if (dz > limit) {
    const fixes = [];
    if (d.series !== "2040") fixes.push({ label: "2040으로 변경", patch: { series: "2040" } });
    if (d.cols < LIMITS.cols[1]) fixes.push({ label: "중간 지지대 추가", patch: { cols: d.cols + 1 } });
    add(dz > L / 150 ? "error" : "warn", "R3",
        `폭 ${Math.round(L)}mm 선반에 ${d.load}kg 적재 시 처짐 ${dz.toFixed(1)}mm 예상 (허용 ${limit.toFixed(1)}mm)`, fixes);
  }

  // R4 — 체결부 강도. 강한 프로파일에 약한 브래킷을 물리면 바보다 체결부가 먼저 깨진다
  const perJoint_kN = (d.load * d.rows * 9.81) / Math.max(1, parts.joints) / 1000;
  const bk = BRACKET_KN[d.bracket] ?? BRACKET_KN.std;
  if (perJoint_kN > bk)
    add("info", "R4", `체결부 1곳당 ${(perJoint_kN * 1000).toFixed(0)}N — ${d.bracket === "heavy" ? "강화" : "표준"} 브래킷 한계(${bk}kN)를 넘습니다`,
        d.bracket === "std" ? [{ label: "강화 브래킷으로", patch: { bracket: "heavy" } }] : []);

  // R5 — 풀아웃
  if (perJoint_kN > PULLOUT_KN)
    add("error", "R5", `볼트 풀아웃 설계값 ${PULLOUT_KN}kN 초과`, [{ label: "적재 하중 낮추기", patch: { load: Math.max(1, d.load - 10) } }]);

  // R6 — 전도
  if (d.h / d.d > 2.2)
    add("info", "R6", `높이/깊이 비 ${(d.h / d.d).toFixed(1)} — 벽 고정 브래킷을 권장합니다`,
        [{ label: "깊이 늘리기", patch: { d: clamp(snap(d.d + 100), LIMITS.d) } }]);

  // R7 — 패널 무지지 스팬
  const maxSpan = PANEL_MAX_SPAN[18];
  if (parts.panels.length && L > maxSpan)
    add("warn", "R7", `18T 패널 무지지 스팬 ${Math.round(L)}mm — 권장 ${maxSpan}mm 이하`,
        [{ label: "칸 나누기", patch: { cols: Math.min(LIMITS.cols[1], d.cols + 1) } }]);

  // R8 — 분할 배송
  if (quote && quote.weight > 30)
    add("info", "R8", `총 ${quote.weight.toFixed(1)}kg — 택배 규격을 넘어 분할 배송됩니다`);

  // R9 — 원장 수율. 사용자에겐 할인, 우리에겐 수율이다
  if (quote) {
    const best = bestYield(d);
    if (best && best.save >= 2000)
      add("tip", "R9", `폭을 ${best.w}mm로 바꾸면 원장 손실이 줄어 ${best.save.toLocaleString()}원 저렴해집니다`,
          [{ label: "적용", patch: { w: best.w } }]);
  }
  return out;
}

/** 6000mm 원장에 담았을 때 버리는 길이(mm). 같은 길이끼리만 묶는 단순 판단이다. */
export function offcut(d) {
  const parts = buildParts(d);
  const groups = new Map();
  for (const b of parts.bars) groups.set(b.len, (groups.get(b.len) || 0) + 1);
  let waste = 0;
  for (const [len, n] of groups) {
    if (len > STOCK_MM) continue;
    const perStock = Math.floor(STOCK_MM / len);
    const stocks = Math.ceil(n / perStock);
    waste += stocks * STOCK_MM - n * len;
  }
  return waste;
}

/** 폭을 ±60mm 안에서 흔들어 가장 싸지는 값을 찾는다. ponytail: 완전 네스팅은 서버 배치 몫 */
export function bestYield(d) {
  const base = price(d).total;
  let best = null;
  for (let delta = -60; delta <= 60; delta += STEP) {
    if (delta === 0) continue;
    const w = snap(d.w + delta);
    if (w < LIMITS.w[0] || w > LIMITS.w[1]) continue;
    const save = base - price({ ...d, w }).total;
    if (save > 0 && (!best || save > best.save)) best = { w, save };
  }
  return best;
}

// ── 견적 ────────────────────────────────────────────────────
export function price(d) {
  const S = SERIES[d.series];
  const parts = buildParts(d);

  const barLenM = parts.bars.reduce((s, b) => s + b.len, 0) / 1000;
  const panelPerimM = parts.panels.reduce((s, p) => s + (2 * (p.w + p.d)) / 1000, 0);
  // 칸마다 소재가 다를 수 있으니 장당으로 합산한다
  let panelWon = 0, panelKg = 0;
  for (const p of parts.panels) {
    const M = MATERIALS[p.material], m2 = (p.w * p.d) / 1e6;
    panelWon += m2 * M.won; panelKg += m2 * M.kgM2;
  }

  /* 체결은 엔드 패스너(탭+볼트+T너트)가 기본이고, 브래킷은 기둥 상하단 보강에만 쓴다.
     처음엔 모든 조인트에 브래킷과 탭을 둘 다 물려 원가가 두 배로 튀었다. */
  const brackets = parts.feet.length * 2;
  const material = Math.round(
    barLenM * S.cost +
    panelWon +
    brackets * (BRACKET_WON[d.bracket] ?? BRACKET_WON.std) +
    parts.joints * FASTENER_WON +
    parts.feet.length * FOOT_WON
  );
  const fabrication = Math.round(
    parts.bars.length * CUT_WON +
    parts.panels.length * PANEL_CUT_WON +
    panelPerimM * EDGE_WON
  );

  const weight = barLenM * S.kgPerM + panelKg + parts.joints * 0.06 + parts.feet.length * 0.05;
  const packing = Math.round(PACK_BASE + Math.ceil(weight / 5) * PACK_PER5);
  const shipping = weight > 30 ? 12000 : 6000;

  const cogs = material + fabrication + packing + shipping;
  const total = Math.ceil(cogs / (1 - GM) / 1000) * 1000;

  return {
    total, cogs, weight,
    breakdown: { material, fabrication, packing, shipping },
    leadDays: { make: 10, ship: 2 },
    counts: { bars: parts.bars.length, panels: parts.panels.length, joints: parts.joints, feet: parts.feet.length },
  };
}

/** 명세서 G `quote.bom` — 부품표를 통째로 공개한다. 단가 근거를 숨기지 않는 게 신뢰 장치다. */
export function bom(d) {
  const S = SERIES[d.series];
  const parts = buildParts(d);
  const rows = [];
  const group = new Map();
  for (const b of parts.bars) {
    const key = `${S.label} 프로파일 ${Math.round(b.len)}mm`;
    group.set(key, (group.get(key) || 0) + 1);
  }
  for (const [name, qty] of group) {
    const len = parseInt(name.match(/(\d+)mm/)[1], 10);
    rows.push({ name, qty, unit: "EA", won: Math.round((len / 1000) * S.cost) });
  }
  // 패널은 치수가 모두 같으므로 소재별로만 묶는다
  const byMat = new Map();
  for (const p of parts.panels) byMat.set(p.material, (byMat.get(p.material) || 0) + 1);
  for (const [mk, qty] of byMat) {
    const M = MATERIALS[mk], p = parts.panels[0];
    rows.push({ name: `${M.label} 패널 18T ${Math.round(p.w)}×${Math.round(p.d)}mm`, qty,
                unit: "EA", won: Math.round((p.w * p.d / 1e6) * M.won) });
  }
  rows.push({ name: `코너 브래킷 ${d.bracket === "heavy" ? "(강화)" : "(표준)"}`, qty: parts.feet.length * 2,
              unit: "EA", won: BRACKET_WON[d.bracket] ?? BRACKET_WON.std });
  rows.push({ name: "엔드 패스너 세트 (탭+볼트+T너트)", qty: parts.joints, unit: "SET", won: FASTENER_WON });
  rows.push({ name: "수평조절풋", qty: parts.feet.length, unit: "EA", won: FOOT_WON });
  return rows;
}

/** 쓰인 소재를 많은 순으로 [{key, label, qty}] 로 돌려준다 */
export function materialsUsed(d) {
  const byMat = new Map();
  for (const p of buildParts(d).panels) byMat.set(p.material, (byMat.get(p.material) || 0) + 1);
  return [...byMat].sort((a, b) => b[1] - a[1])
                   .map(([key, qty]) => ({ key, label: MATERIALS[key].label, qty }));
}

/** 치수 요약 — 공유·주문서·작업지시서 머리말에 쓴다 */
export function summary(d) {
  const mats = materialsUsed(d);
  const matTxt = mats.length === 0 ? "패널 없음"
    : mats.length === 1 ? mats[0].label
    : mats.map((m) => `${m.label} ${m.qty}`).join(" + ");
  return `${d.w}×${d.d}×${d.h}mm · ${SERIES[d.series].label} ${FINISHES[d.finish].label} · ${matTxt} · ${d.cols}칸 ${d.rows}단`;
}
