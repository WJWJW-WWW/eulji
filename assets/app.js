import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as C from "./core.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const won = (n) => n.toLocaleString("ko-KR") + "원";
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── 상태 ────────────────────────────────────────────────────
let design = load() ?? C.defaultDesign();
let selected = null;                  // {level, bay}
let mode = "easy";
const undo = [], redo = [];
let pending = null, pendTimer = 0, saveTimer = 0, lastTotal = null;

function commitSoon(before) {         // 슬라이더를 끌 때마다 히스토리가 쌓이면 Undo 가 쓸모없어진다
  if (!pending) pending = before;
  clearTimeout(pendTimer);
  pendTimer = setTimeout(() => {
    if (pending && JSON.stringify(pending) !== JSON.stringify(design)) { undo.push(pending); redo.length = 0; }
    pending = null; syncHistory();
  }, 450);
}
function apply(patch, { history = true } = {}) {
  const before = clone(design);
  Object.assign(design, patch);
  C.normalize(design);
  if (history) commitSoon(before);
  refresh();
}
function syncHistory() { $("#nav-undo").disabled = !undo.length; $("#nav-redo").disabled = !redo.length; }

// ── 3D ──────────────────────────────────────────────────────
const canvas = $("#cv"), viewEl = $("#view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;

/* 질감은 텍스처 파일이 아니라 캔버스로 만든다. 에셋이 늘면 배포가 무거워지고,
   어차피 필요한 건 사진이 아니라 "완전히 매끈하지 않다"는 미세한 흔들림이다. */
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// 압출 방향으로 흐르는 헤어라인 — 알루미늄이 거울이 아니라 금속으로 보이게 하는 것
const texBrushed = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#7d7d7d"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++) {
    const y = Math.random() * h, v = 104 + Math.random() * 78;
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = 0.4 + Math.random() * 0.9;
    g.beginPath(); g.moveTo(Math.random() * w, y); g.lineTo(Math.random() * w, y); g.stroke();
  }
}, [1, 10]);

// 면재의 미세한 요철 — 이게 없으면 패널이 색종이처럼 보인다
const texGrain = canvasTex(256, 256, (g, w, h) => {
  const img = g.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 30;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}, [4, 4]);

// 바닥 접지 그림자 — 그림자맵만으론 가구가 떠 보인다
const texContact = canvasTex(256, 256, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, "rgba(0,0,0,0.5)");
  r.addColorStop(0.5, "rgba(0,0,0,0.16)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});

const scene = new THREE.Scene();
// 평평한 단색 대신 위에서 아래로 떨어지는 스튜디오 스윕
scene.background = canvasTex(4, 256, (g, w, h) => {
  const lg = g.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, "#F7F7F7"); lg.addColorStop(0.62, "#EDEDED"); lg.addColorStop(1, "#DCDCDC");
  g.fillStyle = lg; g.fillRect(0, 0, w, h);
});
{ const p = new THREE.PMREMGenerator(renderer);       // 금속은 환경맵이 없으면 새까맣게 나온다
  scene.environment = p.fromScene(new RoomEnvironment(), 0.04).texture; p.dispose(); }
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
camera.up.set(0, 0, 1);                                // 설계 좌표계가 Z-up 이라 맞춰둔다
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 0.5; controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.52;

const key = new THREE.DirectionalLight(0xffffff, 1.45);
key.position.set(-1.9, 2.2, 4.8); key.castShadow = true;   // 뒤쪽에서 쏴야 그림자가 카메라 쪽으로 떨어진다
key.shadow.mapSize.set(2048, 2048);
key.shadow.radius = 4; key.shadow.bias = -0.0004;
const sc = key.shadow.camera; sc.left = -2.4; sc.right = 2.4; sc.top = 2.4; sc.bottom = -2.4; sc.near = 0.5; sc.far = 14;
sc.updateProjectionMatrix();   // 값만 바꾸면 투영행렬이 안 따라온다

const fill = new THREE.DirectionalLight(0xffffff, 0.42); fill.position.set(3.0, -2.0, 1.4);
const rim  = new THREE.DirectionalLight(0xffffff, 1.15); rim.position.set(2.4, 2.6, 1.3);  // 블랙 아노다이징의 모서리 선
scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.10));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.2 }));
ground.receiveShadow = true; scene.add(ground);

const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
  map: texContact, transparent: true, depthWrite: false, opacity: 0.5,
}));
contact.position.z = 0.002; contact.renderOrder = -1; scene.add(contact);
const grid = new THREE.GridHelper(12, 48, 0xC9C2B4, 0xDCD6C9);
grid.rotation.x = Math.PI / 2; grid.visible = false; scene.add(grid);

const root = new THREE.Group(); scene.add(root);
const dimGroup = new THREE.Group(); scene.add(dimGroup);

const geoCache = new Map();
function profileGeo(series) {
  if (geoCache.has(series)) return geoCache.get(series);
  const shape = new THREE.Shape(C.profileOutline(series).map(([x, y]) => new THREE.Vector2(x / 1000, y / 1000)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 1, steps: 1, bevelEnabled: true, bevelSize: 0.0004, bevelThickness: 0.0004, bevelSegments: 1,
  });
  g.translate(0, 0, -0.5);              // 중심 기준 — scale.z 로 길이를 준다
  geoCache.set(series, g);
  return g;
}

const panelGeo = new THREE.BoxGeometry(1, 1, 1);
const selBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(panelGeo),
  new THREE.LineBasicMaterial({ color: 0x0D0D0D, depthTest: false, transparent: true, opacity: 0.85 }),
);
selBox.visible = false; selBox.renderOrder = 10; scene.add(selBox);
let selMesh = null;
let matAlu, panelMeshes = [], allMeshes = [], exploding = false, explodeT = 0;

function rebuild() {
  root.clear(); panelMeshes = []; allMeshes = [];
  const parts = C.buildParts(design);
  const F = C.FINISHES[design.finish];

  matAlu = new THREE.MeshPhysicalMaterial({
    color: F.color, metalness: 1, roughness: F.rough,
    roughnessMap: texBrushed,
    anisotropy: 0.7, anisotropyRotation: Math.PI / 2,   // 결이 길이 방향으로 눕는다
  });

  const geo = profileGeo(design.series);
  for (const b of parts.bars) {
    const m = new THREE.Mesh(geo, matAlu);
    m.position.set(b.pos[0] / 1000, b.pos[1] / 1000, b.pos[2] / 1000);
    if (b.axis === "x") m.rotation.y = Math.PI / 2;
    if (b.axis === "y") m.rotation.x = -Math.PI / 2;
    m.scale.z = b.len / 1000;
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }
  for (const p of parts.panels) {
    const PM = C.MATERIALS[p.material];                 // 칸마다 소재가 다를 수 있다
    const m = new THREE.Mesh(panelGeo, new THREE.MeshPhysicalMaterial({
      color: PM.color, metalness: 0,
      roughness: p.material === "oak" ? 0.72 : 0.56,
      roughnessMap: texGrain,
      clearcoat: p.material === "oak" ? 0 : 0.18,       // 멜라민의 얕은 광
      clearcoatRoughness: 0.4,
      sheen: p.material === "charcoal" ? 0.25 : 0,      // 어두운 면은 스침광이 있어야 형태가 보인다
      sheenColor: new THREE.Color(0x6A6A6A),
    }));
    m.position.set(p.pos[0] / 1000, p.pos[1] / 1000, p.pos[2] / 1000);
    m.scale.set(p.w / 1000, p.d / 1000, p.t / 1000);
    m.castShadow = m.receiveShadow = true;
    m.userData.cell = { level: p.level, bay: p.bay };
    root.add(m); panelMeshes.push(m);
  }
  for (const [x, y] of parts.feet) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.022, 16),
                             new THREE.MeshStandardMaterial({ color: 0x15151A, roughness: 0.7 }));
    m.rotation.x = Math.PI / 2;
    m.position.set(x / 1000, y / 1000, -0.011);
    m.castShadow = true; root.add(m);
  }
  root.position.set(-design.w / 2000, -design.d / 2000, 0);
  contact.scale.set(design.w / 1000 * 1.3, design.d / 1000 * 2.4, 1);
  for (const m of root.children) { m.userData.base = m.position.clone(); allMeshes.push(m); }

  markSelection();
  buildDims();
}

// ── 치수선 ──────────────────────────────────────────────────
const labelBox = $("#labels");
let dimPts = [];
function buildDims() {
  dimGroup.clear(); labelBox.innerHTML = ""; dimPts = [];
  if (!$("#v-dim").classList.contains("on")) return;
  const w = design.w / 1000, d = design.d / 1000, h = design.h / 1000;
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2, o = 0.09;
  const seg = [], tick = (p, v) => { seg.push(p[0] - v[0], p[1] - v[1], p[2] - v[2], p[0] + v[0], p[1] + v[1], p[2] + v[2]); };
  const line = (a, b) => seg.push(...a, ...b);

  line([x0, y0 - o, 0], [x1, y0 - o, 0]); tick([x0, y0 - o, 0], [0, 0.02, 0]); tick([x1, y0 - o, 0], [0, 0.02, 0]);
  line([x1 + o, y0, 0], [x1 + o, y1, 0]); tick([x1 + o, y0, 0], [0.02, 0, 0]); tick([x1 + o, y1, 0], [0.02, 0, 0]);
  line([x0 - o, y1, 0], [x0 - o, y1, h]); tick([x0 - o, y1, 0], [0.02, 0, 0]); tick([x0 - o, y1, h], [0.02, 0, 0]);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
  dimGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8C887E })));

  dimPts = [
    [new THREE.Vector3(0, y0 - o, 0), `W ${design.w}`],
    [new THREE.Vector3(x1 + o, 0, 0), `D ${design.d}`],
    [new THREE.Vector3(x0 - o, y1, h / 2), `H ${design.h}`],
  ];
  for (const [, t] of dimPts) { const s = document.createElement("span"); s.textContent = t; labelBox.appendChild(s); }
}
function placeLabels() {
  const kids = labelBox.children, r = viewEl.getBoundingClientRect();
  dimPts.forEach(([v], i) => {
    const p = v.clone().project(camera);
    const el = kids[i]; if (!el) return;
    el.style.left = ((p.x * 0.5 + 0.5) * r.width) + "px";
    el.style.top = ((-p.y * 0.5 + 0.5) * r.height) + "px";
    el.style.opacity = p.z > 1 ? 0 : 1;
  });
}

// ── 카메라 ──────────────────────────────────────────────────
function fitDistance() {
  const w = design.w / 1000, d = design.d / 1000, h = design.h / 1000;
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const tanH = tanV * Math.max(0.35, camera.aspect);
  const distW = (Math.max(w, d) / 2) * 1.45 / tanH;   // 가로가 잘리지 않을 거리 (아이소 각도에서 실루엣이 더 넓어진다)
  const distH = (Math.max(h, d) / 2) * 1.3 / tanV;    // 세로가 잘리지 않을 거리
  return Math.max(distW, distH) + d / 2;
}
function fit(view = "iso", animate = true) {
  const h = design.h / 1000;
  const dist = fitDistance();
  const dirs = {
    iso:   new THREE.Vector3(-0.72, -1, 0.52),
    front: new THREE.Vector3(0, -1, 0.06),
    side:  new THREE.Vector3(-1, 0, 0.06),
    top:   new THREE.Vector3(0, -0.02, 1),
  };
  const target = new THREE.Vector3(0, 0, h / 2);
  const pos = target.clone().add(dirs[view].clone().normalize().multiplyScalar(dist));
  if (animate) { camTo = { pos, target, t: 0 }; } else { camera.position.copy(pos); controls.target.copy(target); }
}
let camTo = null;

function resize() {
  const r = viewEl.getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
}
function refit() {                     // 보던 각도는 유지하고 거리만 다시 맞춘다
  const dist = fitDistance();
  const target = new THREE.Vector3(0, 0, design.h / 2000);
  const dir = camera.position.clone().sub(controls.target).normalize();
  camTo = { pos: target.clone().add(dir.multiplyScalar(dist)), target, t: 0 };
}
let fitTimer = 0;
new ResizeObserver(() => { resize(); clearTimeout(fitTimer); fitTimer = setTimeout(refit, 220); }).observe(viewEl);

renderer.setAnimationLoop(() => {
  if (camTo) {
    camTo.t = Math.min(1, camTo.t + 0.09);
    const e = 1 - Math.pow(1 - camTo.t, 3);
    camera.position.lerp(camTo.pos, e * 0.5);
    controls.target.lerp(camTo.target, e * 0.5);
    if (camTo.t >= 1) camTo = null;
  }
  const want = exploding ? 1 : 0;
  if (Math.abs(explodeT - want) > 0.002) {
    explodeT += (want - explodeT) * 0.14;
    for (const m of allMeshes) {
      const b = m.userData.base; if (!b) continue;
      m.position.copy(b).add(b.clone().setZ(b.z - design.h / 3000).multiplyScalar(0.42 * explodeT));
    }
  }
  if (selMesh) selMesh.getWorldPosition(selBox.position);
  controls.update();
  renderer.render(scene, camera);
  placeLabels();
});

// ── 선택 ────────────────────────────────────────────────────
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;  // 드래그는 선택이 아니다
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(panelMeshes, false)[0];
  select(hit ? hit.object.userData.cell : null);
});
function select(cell) {
  selected = cell; markSelection(); renderProps();
  if (cell && isMobile()) setPane("props");
}
function markSelection() {
  selMesh = selected
    ? panelMeshes.find((m) => m.userData.cell.level === selected.level && m.userData.cell.bay === selected.bay)
    : null;
  selBox.visible = !!selMesh;
  if (selMesh) selBox.scale.copy(selMesh.scale);
}

// ── 라이브러리 (B) ──────────────────────────────────────────
function card(on, name, sub, onClick) {
  const b = document.createElement("button");
  b.className = "card" + (on ? " on" : "");
  b.innerHTML = `<span class="ico"></span><span><span class="nm">${name}</span><br><span class="sub">${sub}</span></span>`;
  b.onclick = onClick; return b;
}
function renderLib() {
  const pc = $("#preset-cards"); pc.innerHTML = "";
  for (const [k, p] of Object.entries(C.PRESETS))
    pc.append(card(design.preset === k, p.label, `${p.w}×${p.d}×${p.h} · ${p.cols}칸 ${p.rows}단`,
      () => apply({ ...C.PRESETS[k], preset: k, removed: [], rowHeights: null })));

  const sc2 = $("#series-cards"); sc2.innerHTML = "";
  for (const [k, s] of Object.entries(C.SERIES))
    sc2.append(card(design.series === k, s.label,
      `${s.w}×${s.h}mm · I ${(s.I / 10000).toFixed(2)}cm⁴ · ${s.kgPerM}kg/m`, () => apply({ series: k })));

  const fs = $("#finish-sw"); fs.innerHTML = "";
  for (const [k, f] of Object.entries(C.FINISHES)) {
    const b = document.createElement("button");
    b.className = "sw" + (design.finish === k ? " on" : "");
    b.style.background = "#" + f.color.toString(16).padStart(6, "0");
    b.title = f.label; b.onclick = () => apply({ finish: k });
    fs.append(b);
  }

  const mc = $("#material-cards"); mc.innerHTML = "";
  const over = Object.keys(design.panelMaterials ?? {}).length;
  for (const [k, m] of Object.entries(C.MATERIALS))
    mc.append(card(design.material === k, m.label, `${m.won.toLocaleString()}원/m² · 18T`, () => apply({ material: k })));
  $("#material-note").textContent = over
    ? `${over}칸은 따로 지정돼 있어 기본 소재를 바꿔도 그대로입니다.`
    : "패널을 클릭하면 그 칸만 다른 소재로 바꿀 수 있습니다.";
}

// ── 속성 패널 (D) ───────────────────────────────────────────
const DIM_CHIPS = [["책상 높이 740", { h: 740 }], ["선반 높이 1800", { h: 1800 }],
                   ["깊이 300", { d: 300 }], ["TV장 높이 450", { h: 450 }]];
const LOAD_CHIPS = [["책·소품 10kg", 10], ["식기·공구 25kg", 25], ["TV·모니터 40kg", 40]];

function bindRange(k, lo, hi) {
  const rg = $("#rg-" + k), nm = $("#in-" + k);
  rg.min = nm.min = lo; rg.max = nm.max = hi; rg.step = C.STEP;
  const set = (v) => apply({ [k]: +v });
  rg.oninput = (e) => set(e.target.value);
  nm.onchange = (e) => set(e.target.value);
}
function renderProps() {
  const isPanel = !!selected;
  $("#props-design").hidden = isPanel;
  $("#props-panel").hidden = !isPanel;

  for (const k of ["w", "d", "h"]) { $("#rg-" + k).value = design[k]; $("#in-" + k).value = design[k]; }
  $("#rg-load").value = design.load; $("#in-load").value = design.load;
  $("#v-cols").textContent = design.cols; $("#v-rows").textContent = design.rows;

  $("#dim-presets").innerHTML = "";
  for (const [label, patch] of DIM_CHIPS) {
    const b = document.createElement("button");
    b.className = "chip" + (Object.entries(patch).every(([k, v]) => design[k] === v) ? " on" : "");
    b.textContent = label; b.onclick = () => apply(patch);
    $("#dim-presets").append(b);
  }
  $("#load-chips").innerHTML = "";
  for (const [label, v] of LOAD_CHIPS) {
    const b = document.createElement("button");
    b.className = "chip" + (design.load === v ? " on" : "");
    b.textContent = label; b.onclick = () => apply({ load: v });
    $("#load-chips").append(b);
  }

  // 자유 모드 — 단마다 높이를 따로 준다
  $("#free-rows").hidden = mode !== "free";
  if (mode === "free") {
    const host = $("#rowheights"); host.innerHTML = "";
    const hs = rowHeights();
    hs.forEach((v, i) => {
      const r = document.createElement("div"); r.className = "row";
      r.innerHTML = `<label>${i + 1}단</label><input type="range" min="60" max="900" step="10" value="${v}">
                     <input type="number" step="10" value="${v}"><span class="u">mm</span>`;
      const [rg, nm] = [r.querySelector("input[type=range]"), r.querySelector("input[type=number]")];
      const set = (val) => { const a = rowHeights(); a[i] = C.snap(+val); apply({ rowHeights: a, h: sum(a) + C.SERIES[design.series].w }); };
      rg.oninput = (e) => set(e.target.value); nm.onchange = (e) => set(e.target.value);
      host.append(r);
    });
  }

  if (isPanel) {
    const parts = C.buildParts(design);
    const p = parts.panels.find((x) => x.level === selected.level && x.bay === selected.bay);
    $("#sel-info").textContent = p
      ? `${selected.level + 1}단 ${selected.bay + 1}번 칸 · ${Math.round(p.w)}×${Math.round(p.d)}mm · 무지지 스팬 ${Math.round(p.span)}mm`
      : `${selected.level + 1}단 ${selected.bay + 1}번 칸 · 비어 있음`;
    $("#sel-remove").textContent = p ? "이 칸 비우기" : "이 칸 채우기";

    const cur = C.cellMaterial(design, selected.level, selected.bay);
    const overridden = !!design.panelMaterials?.[C.cellKey(selected.level, selected.bay)];
    const sm = $("#sel-material"); sm.innerHTML = "";
    for (const [k, m] of Object.entries(C.MATERIALS)) {
      const b = document.createElement("button");
      b.className = "sw" + (cur === k ? " on" : "");
      b.style.background = "#" + m.color.toString(16).padStart(6, "0");
      b.title = m.label; b.onclick = () => setCellMaterial(k);
      sm.append(b);
    }
    $("#sel-matname").textContent = C.MATERIALS[cur].label + (overridden ? " (이 칸만 지정됨)" : " (기본 소재)");
    $("#sel-spread").hidden = !overridden;
    $("#sel-revert").hidden = !overridden;
  }
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
function rowHeights() {
  if (design.rowHeights) return [...design.rowHeights];
  const P = C.SERIES[design.series].w, span = design.h - P;
  const step = design.rows > 1 ? span / (design.rows - 1) : span;
  return Array.from({ length: design.rows }, () => C.snap(step));
}

// ── 검증 배너 (F) ───────────────────────────────────────────
function renderBanner(issues) {
  const box = $("#banner"); box.innerHTML = "";
  for (const v of issues.slice(0, isMobile() ? 1 : 3)) {
    const el = document.createElement("div");
    el.className = "msg " + v.level;
    el.innerHTML = `<span class="id">${v.id}</span><span class="tx">${v.msg}</span>`;
    for (const f of v.fixes ?? []) {
      const b = document.createElement("button");
      b.className = "fix"; b.textContent = f.label; b.onclick = () => apply(f.patch);
      el.append(b);
    }
    box.append(el);
  }
}

// ── 견적 바 (G) ─────────────────────────────────────────────
let quote = null, issues = [];
function renderQuote() {
  $("#q-total").textContent = won(quote.total);
  $("#nav-partno").textContent = `\u2116${design.w}\u00B7${design.d}\u00B7${design.h}`;
  $("#q-lead").textContent = `제작 ${quote.leadDays.make}일 + 배송 ${quote.leadDays.ship}일`;
  $("#q-weight").textContent = quote.weight.toFixed(1) + "kg";
  $("#q-parts").textContent = `${quote.counts.bars}개 · 패널 ${quote.counts.panels}장`;

  const d = $("#q-delta");
  if (lastTotal !== null && lastTotal !== quote.total) {
    const diff = quote.total - lastTotal;
    d.textContent = (diff > 0 ? "+" : "") + diff.toLocaleString();
    d.classList.add("show"); clearTimeout(d._t); d._t = setTimeout(() => d.classList.remove("show"), 1800);
  }
  lastTotal = quote.total;

  const blocked = issues.some((v) => v.level === "error");
  $("#q-cart").disabled = blocked;
  $("#q-cart").title = blocked ? "제작 불가 항목을 먼저 해결하세요" : "";
}

// ── 전체 갱신 ───────────────────────────────────────────────
function refresh() {
  rebuild();
  quote = C.price(design);
  issues = C.validate(design, C.buildParts(design), quote);
  renderLib(); renderProps(); renderBanner(issues); renderQuote();
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 1200);   // 명세서 §7 자동 임시저장
}

// ── 저장·공유 ───────────────────────────────────────────────
const KEY = "eulji.design";
function save() { try { localStorage.setItem(KEY, JSON.stringify({ ...design, name: $("#nav-title").value })); } catch {} }
function load() {
  try {
    if (location.hash.length > 2) return C.normalize(JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1))))));
    const s = localStorage.getItem(KEY); if (s) return C.normalize(JSON.parse(s));
  } catch {}
  return null;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 2200); }

// ── 모달 ────────────────────────────────────────────────────
$$("[data-close]").forEach((b) => b.onclick = () => b.closest("dialog").close());

$("#open-room").onclick = () => {
  if (design.room) { $("#r-w").value = design.room.wallW ?? ""; $("#r-h").value = design.room.wallH ?? ""; $("#r-d").value = design.room.depth ?? ""; }
  $("#m-room").showModal();
};
$("#r-ok").onclick = () => {
  const wallW = +$("#r-w").value || null, wallH = +$("#r-h").value || null, depth = +$("#r-d").value || null;
  const patch = { room: { wallW, wallH, depth } };
  // 벽보다 크면 못 들어간다. 여유 10mm 를 빼고 그리드에 맞춘다
  if (wallW) patch.w = Math.min(C.LIMITS.w[1], C.snap(wallW - 10));
  if (wallH) patch.h = Math.min(C.LIMITS.h[1], C.snap(wallH - 10));
  if (depth) patch.d = Math.min(C.LIMITS.d[1], C.snap(depth));
  apply(patch); fit("iso");
  toast("방 치수에 맞춰 조정했습니다");
};

$("#q-bom").onclick = showBom;
function showBom() {
  const rows = C.bom(design);
  $("#bom-table").innerHTML =
    `<thead><tr><th>품목</th><th class="n">수량</th><th class="n">단가</th><th class="n">금액</th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${r.name}</td><td class="n">${r.qty} ${r.unit}</td><td class="n">${r.won.toLocaleString()}</td><td class="n">${(r.qty * r.won).toLocaleString()}</td></tr>`).join("") +
    `</tbody><tfoot><tr><td>자재 합계</td><td class="n"></td><td class="n"></td><td class="n">${rows.reduce((s, r) => s + r.qty * r.won, 0).toLocaleString()}</td></tr></tfoot>`;
  $("#m-bom").showModal();
}
$("#q-breakdown").onclick = () => {
  const b = quote.breakdown;
  const names = { material: "자재", fabrication: "가공", packing: "포장", shipping: "배송" };
  $("#break-table").innerHTML =
    `<tbody>${Object.entries(b).map(([k, v]) => `<tr><td>${names[k]}</td><td class="n">${won(v)}</td></tr>`).join("")}` +
    `<tr><td>원가 합계</td><td class="n">${won(quote.cogs)}</td></tr></tbody>` +
    `<tfoot><tr><td>판매가</td><td class="n">${won(quote.total)}</td></tr></tfoot>`;
  $("#m-break").showModal();
};

$("#bom-csv").onclick = () => {
  const rows = C.bom(design);
  const csv = "﻿품목,수량,단위,단가,금액\n" +
    rows.map((r) => `"${r.name}",${r.qty},${r.unit},${r.won},${r.qty * r.won}`).join("\n");
  dl(new Blob([csv], { type: "text/csv" }), `${$("#nav-title").value || "설계"}_부품표.csv`);
};
function dl(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* 작업지시서 — 담당자가 출력해서 들고 가는 A4 한 장 */
$("#bom-print").onclick = () => {
  const parts = C.buildParts(design), S = C.SERIES[design.series];
  const cuts = new Map();
  for (const b of parts.bars) { const k = Math.round(b.len); cuts.set(k, (cuts.get(k) || 0) + 1); }
  const panels = new Map();
  for (const p of parts.panels) {
    const k = `${C.MATERIALS[p.material].label}|${Math.round(p.w)}×${Math.round(p.d)}`;
    if (!panels.has(k)) panels.set(k, []);
    panels.get(k).push(`${p.level + 1}단 ${p.bay + 1}칸`);
  }
  $("#worksheet").innerHTML = `
    <h1>작업지시서 — ${esc($("#nav-title").value || "무제")}</h1>
    <div class="sub">${esc(C.summary(design))} · 출력 ${new Date().toLocaleString("ko-KR")}</div>
    <h2>1. 프로파일 절단 (${S.label}, ${C.FINISHES[design.finish].label})</h2>
    <table><thead><tr><th>절단 길이</th><th>수량</th><th>양끝 탭</th><th>검수(실측)</th></tr></thead><tbody>
    ${[...cuts].sort((a, b) => b[0] - a[0]).map(([l, n]) =>
      `<tr><td>${l} mm</td><td>${n} EA</td><td>${l === design.h ? "—" : "M5 양끝"}</td><td></td></tr>`).join("")}
    </tbody></table>
    <h2>2. 패널 재단 (18T)</h2>
    <table><thead><tr><th>소재</th><th>치수</th><th>수량</th><th>들어갈 자리</th><th>검수(실측)</th></tr></thead><tbody>
    ${[...panels].map(([k, cells]) => { const [mat, size] = k.split("|");
      return `<tr><td>${esc(mat)}</td><td>${size} mm</td><td>${cells.length} EA</td><td>${cells.join(", ")}</td><td></td></tr>`;
    }).join("")}
    </tbody></table>
    <h2>3. 부자재</h2>
    <table><tbody>${C.bom(design).filter((r) => !r.name.includes("프로파일") && !r.name.includes("패널"))
      .map((r) => `<tr><td>${esc(r.name)}</td><td>${r.qty} ${r.unit}</td></tr>`).join("")}</tbody></table>
    <div class="note">
      공차 ±0.5mm. 절단면 버 제거 필수.<br>
      원장 손실 ${(C.offcut(design) / 1000).toFixed(2)}m — 동일 길이끼리 묶어 6,000mm 원장에서 뽑을 것.<br>
      불량·치수 이상 발견 시 가공 중단하고 담당자에게 연락.
    </div>`;
  print();
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 전자상거래법 제17조 — 치수 재확인 + 별도 동의 2건을 모두 받아야 예외 요건이 성립한다
$("#q-cart").onclick = () => {
  $("#c-summary").innerHTML = `<b>${esc(C.summary(design))}</b><br>칸당 적재 ${design.load}kg · 총 ${quote.weight.toFixed(1)}kg<br>
    금액 <b>${won(quote.total)}</b> · 납기 제작 ${quote.leadDays.make}일 + 배송 ${quote.leadDays.ship}일`;
  $("#c-1").checked = $("#c-2").checked = false; $("#c-ok").disabled = true;
  $("#m-consent").showModal();
};
for (const id of ["#c-1", "#c-2"])
  $(id).onchange = () => { $("#c-ok").disabled = !($("#c-1").checked && $("#c-2").checked); };
$("#c-ok").onclick = () => {
  const cart = JSON.parse(localStorage.getItem("eulji.cart") || "[]");
  cart.push({ at: Date.now(), name: $("#nav-title").value, design: clone(design), total: quote.total,
              consent: { spec: true, withdrawal: true, at: new Date().toISOString() } });
  localStorage.setItem("eulji.cart", JSON.stringify(cart));
  $("#cart-n").textContent = cart.length;
  $("#m-consent").close();
  toast("장바구니에 담았습니다 — 결제는 서버 연동 후입니다");
};
$("#nav-cart").onclick = () => {
  const n = JSON.parse(localStorage.getItem("eulji.cart") || "[]").length;
  toast(n ? `${n}건 담겨 있습니다. 결제는 서버 연동 후입니다` : "장바구니가 비어 있습니다");
};
$("#nav-help").onclick = () => $("#m-help").showModal();

// ── 상단 바 ─────────────────────────────────────────────────
$("#nav-undo").onclick = () => { if (!undo.length) return; redo.push(clone(design)); design = undo.pop(); selected = null; refresh(); syncHistory(); };
$("#nav-redo").onclick = () => { if (!redo.length) return; undo.push(clone(design)); design = redo.pop(); selected = null; refresh(); syncHistory(); };
$("#nav-reset").onclick = () => {
  if (!confirm("설계를 처음 상태로 되돌립니다. 계속할까요?")) return;
  undo.push(clone(design)); redo.length = 0; design = C.defaultDesign(); selected = null; refresh(); fit("iso"); syncHistory();
};
$("#nav-save").onclick = () => { save(); toast("이 브라우저에 저장했습니다"); };
$("#nav-share").onclick = async () => {
  const hash = btoa(unescape(encodeURIComponent(JSON.stringify(design))));
  const url = location.origin + location.pathname + "#" + hash;
  try { await navigator.clipboard.writeText(url); toast("링크를 복사했습니다"); }
  catch { location.hash = hash; toast("주소창의 링크를 복사하세요"); }
};
$("#nav-title").oninput = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 800); };

$("#mode-easy").onclick = () => setMode("easy");
$("#mode-free").onclick = () => setMode("free");
function setMode(m) {
  mode = m;
  $("#mode-easy").classList.toggle("on", m === "easy");
  $("#mode-free").classList.toggle("on", m === "free");
  if (m === "easy" && design.rowHeights) apply({ rowHeights: null });
  else renderProps();
  toast(m === "free" ? "자유 모드 — 단별 높이를 따로 정할 수 있습니다" : "간편 모드 — 단 높이를 균등하게 맞춥니다");
}
$("#rows-even").onclick = () => apply({ rowHeights: null });

$$("[data-step]").forEach((b) => b.onclick = () => {
  const [k, v] = b.dataset.step.split(",");
  apply({ [k]: design[k] + +v, rowHeights: null });
});

function setCellMaterial(k) {
  const pm = { ...design.panelMaterials };
  if (k === design.material) delete pm[C.cellKey(selected.level, selected.bay)];
  else pm[C.cellKey(selected.level, selected.bay)] = k;
  apply({ panelMaterials: pm });
}
// 이 칸 소재를 기본값으로 올리고 다른 칸의 개별 지정을 모두 지운다
$("#sel-spread").onclick = () => {
  apply({ material: C.cellMaterial(design, selected.level, selected.bay), panelMaterials: {} });
  toast("이 소재를 전체 패널에 적용했습니다");
};
$("#sel-revert").onclick = () => {
  const pm = { ...design.panelMaterials };
  delete pm[C.cellKey(selected.level, selected.bay)];
  apply({ panelMaterials: pm });
};
$("#sel-remove").onclick = () => {
  const k = `${selected.level},${selected.bay}`;
  const set = new Set(design.removed);
  set.has(k) ? set.delete(k) : set.add(k);
  apply({ removed: [...set] });
};
$("#sel-clear").onclick = () => select(null);

// ── 탭 · 뷰 컨트롤 ──────────────────────────────────────────
$("#lib-tabs").onclick = (e) => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  $$("#lib-tabs button").forEach((x) => x.classList.toggle("on", x === b));
  $$("[data-pane]").forEach((p) => p.hidden = p.dataset.pane !== b.dataset.tab);
};
$("#v-reset").onclick = () => fit("iso");
$("#v-fit").onclick = () => fit(currentView);
let currentView = "iso";
$$("[data-view]").forEach((b) => b.onclick = () => {
  currentView = b.dataset.view;
  $$("[data-view]").forEach((x) => x.classList.toggle("on", x === b));
  fit(currentView);
});
$("#v-grid").onclick = (e) => { grid.visible = !grid.visible; e.currentTarget.classList.toggle("on", grid.visible); };
$("#v-dim").onclick = (e) => { e.currentTarget.classList.toggle("on"); buildDims(); };
$("#v-explode").onclick = (e) => { exploding = !exploding; e.currentTarget.classList.toggle("on", exploding); };

// ── 모바일 하단 시트 (3단) ──────────────────────────────────
// 드래그 제스처 대신 탭으로 단계를 돈다. 작은 화면에서 드래그는 실패율이 높다
let sheet = 0;
const isMobile = () => matchMedia("(max-width:860px)").matches;
function setSheet(n) { sheet = n; document.body.dataset.sheet = n; setTimeout(resize, 290); }
function setPane(p) {
  document.body.dataset.pane = p;
  $$("[data-sheetpane]").forEach((b) => b.classList.toggle("on", b.dataset.sheetpane === p));
  if (sheet === 0 && isMobile()) setSheet(1);
}
$("#grip").onclick = () => setSheet(sheet === 2 ? 1 : sheet + 1);
$$("[data-sheetpane]").forEach((b) => b.onclick = () => setPane(b.dataset.sheetpane));
document.body.dataset.pane = "props";
$$("[data-sheetpane]").forEach((b) => b.classList.toggle("on", b.dataset.sheetpane === "props"));
setSheet(isMobile() ? 1 : 0);
matchMedia("(max-width:860px)").addEventListener("change", (e) => {
  setSheet(e.matches ? 1 : 0);
  renderBanner(issues);   // 모바일은 배너를 1줄만 띄운다 — 폭이 바뀌면 다시 그려야 한다
});

addEventListener("keydown", (e) => {
  if (e.target.matches("input,textarea")) return;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); (e.shiftKey ? $("#nav-redo") : $("#nav-undo")).click(); }
  if (e.key === "Escape") select(null);
});

// ── 시작 ────────────────────────────────────────────────────
bindRange("w", ...C.LIMITS.w); bindRange("d", ...C.LIMITS.d); bindRange("h", ...C.LIMITS.h);
$("#rg-load").oninput = (e) => apply({ load: +e.target.value });
$("#in-load").onchange = (e) => apply({ load: +e.target.value });
if (design.name) $("#nav-title").value = design.name;
$("#cart-n").textContent = JSON.parse(localStorage.getItem("eulji.cart") || "[]").length;
resize(); refresh(); fit("iso", false); syncHistory();
if (!localStorage.getItem("eulji.seen")) { $("#m-help").showModal(); localStorage.setItem("eulji.seen", "1"); }

