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
const edgesPanel = new THREE.EdgesGeometry(panelGeo);
let edgesBar = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.021, 0.021, 1));
const selBox = new THREE.LineSegments(
  edgesPanel,
  new THREE.LineBasicMaterial({ color: 0x0D0D0D, depthTest: false, transparent: true, opacity: 0.9 }),
);
selBox.visible = false; selBox.renderOrder = 10; scene.add(selBox);
let selMesh = null;
let matAlu, panelMeshes = [], barMeshes = [], allMeshes = [], exploding = false, explodeT = 0;

function rebuild() {
  root.clear(); panelMeshes = []; barMeshes = []; allMeshes = [];
  const parts = C.buildParts(design);
  const F = C.FINISHES[design.finish];

  matAlu = new THREE.MeshPhysicalMaterial({
    color: F.color, metalness: 1, roughness: F.rough,
    roughnessMap: texBrushed,
    anisotropy: 0.7, anisotropyRotation: Math.PI / 2,   // 결이 길이 방향으로 눕는다
  });

  const S = C.SERIES[design.series];
  edgesBar = new THREE.EdgesGeometry(new THREE.BoxGeometry(S.w / 1000 + 0.001, S.h / 1000 + 0.001, 1));
  const geo = profileGeo(design.series);
  for (const b of parts.bars) {
    const m = new THREE.Mesh(geo, matAlu);
    m.position.set(b.pos[0] / 1000, b.pos[1] / 1000, b.pos[2] / 1000);
    if (b.axis === "x") m.rotation.y = Math.PI / 2;
    if (b.axis === "y") m.rotation.x = -Math.PI / 2;
    m.scale.z = b.len / 1000;
    m.castShadow = m.receiveShadow = true;
    m.userData.bar = b;
    root.add(m); barMeshes.push(m);
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
const CSSVAR = (n) => parseInt(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0;
const SIDE = CSSVAR("--side") || 258;
const BARS = (CSSVAR("--bar") || 52) + (CSSVAR("--quote") || 66);
function fitDistance() {
  const w = design.w / 1000, d = design.d / 1000, h = design.h / 1000;
  const r = viewEl.getBoundingClientRect();
  /* 레이아웃이 잡히기 전에는 높이가 0 이다. 그대로 나누면 화각이 폭발해
     카메라가 가구 안으로 들어가 버린다 — 그때는 직전 종횡비를 쓴다. */
  const ok = r.width > 1 && r.height > 1;
  // 좌우 패널이 캔버스를 덮으므로, 가구는 그 사이에 들어와야 한다
  const visW = isMobile() ? r.width : Math.max(r.width * 0.42, r.width - SIDE * 2);
  const visH = isMobile() ? r.height : Math.max(r.height * 0.5, r.height - BARS);
  const aspect = ok ? visW / visH : camera.aspect;
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const tanH = tanV * Math.max(0.35, aspect);
  const distW = (Math.max(w, d) / 2) * 1.45 / tanH;   // 가로가 잘리지 않을 거리 (아이소 각도에서 실루엣이 더 넓어진다)
  const vScale = ok && !isMobile() ? Math.max(0.5, (r.height - BARS) / r.height) : 1;
  const distH = (Math.max(h, d) / 2) * 1.3 / (tanV * vScale);
  return Math.max(distW, distH) + d / 2;
}
function fit(view = "iso", animate = true) {
  const h = design.h / 1000;
  const dist = fitDistance();
  const dirs = {
    iso:   new THREE.Vector3(-0.72, -1, 0.52),
    front: new THREE.Vector3(0, -1, 0.06),
    back:  new THREE.Vector3(0, 1, 0.06),
    left:  new THREE.Vector3(-1, 0, 0.06),
    right: new THREE.Vector3(1, 0, 0.06),
    top:   new THREE.Vector3(0, -0.02, 1),
    bottom:new THREE.Vector3(0, -0.02, -1),
  };
  fitDir(dirs[view] ?? dirs.iso, animate);
}
/** 임의 방향에서 가구를 바라본다 — 뷰큐브가 이걸 쓴다 */
function fitDir(dir, animate = true) {
  const dist = fitDistance();
  const target = new THREE.Vector3(0, 0, design.h / 2000);
  const pos = target.clone().add(dir.clone().normalize().multiplyScalar(dist));
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
  // 큐브는 본 카메라의 자세를 그대로 따라간다
  cubeCam.position.copy(camera.position).sub(controls.target).normalize().multiplyScalar(8);
  cubeCam.lookAt(0, 0, 0);
  cubeR.render(cubeScene, cubeCam);
  placeLabels();
});

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

// ── 뷰큐브 ──────────────────────────────────────────────────
/* 정/측/평 글자 버튼 대신 실제 큐브를 돌린다. 지금 어느 쪽에서 보고 있는지가
   버튼 하이라이트보다 큐브의 자세로 훨씬 빨리 읽힌다. */
const CUBE_FACES = [            // BoxGeometry 의 +X,-X,+Y,-Y,+Z,-Z 순서
  { label: "우측면", dir: [1, 0, 0.06], tone: "#F2F2F2" },
  { label: "좌측면", dir: [-1, 0, 0.06], tone: "#F2F2F2" },
  { label: "뒷면",   dir: [0, 1, 0.06], tone: "#EDEDED" },
  { label: "정면",   dir: [0, -1, 0.06], tone: "#FBFBFB" },
  { label: "윗면",   dir: [0, -0.02, 1], tone: "#FFFFFF" },
  { label: "아랫면", dir: [0, -0.02, -1], tone: "#E4E4E4" },
];

function faceTex(label, tone) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = tone; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#C9C9C9"; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
    g.fillStyle = "#1A1A1A";
    g.font = "500 27px -apple-system,BlinkMacSystemFont,system-ui,sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(label, w / 2, h / 2);
  });
}

const cubeCanvas = $("#cube");
const cubeR = new THREE.WebGLRenderer({ canvas: cubeCanvas, antialias: true, alpha: true });
cubeR.setPixelRatio(Math.min(devicePixelRatio, 2));
const cubeScene = new THREE.Scene();
const cubeCam = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 30);
cubeCam.up.set(0, 0, 1);

const cubeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1.55, 1.55, 1.55),
  CUBE_FACES.map((f) => new THREE.MeshBasicMaterial({ map: faceTex(f.label, f.tone) })),
);
cubeScene.add(cubeMesh);
cubeScene.add(new THREE.LineSegments(
  new THREE.EdgesGeometry(cubeMesh.geometry),
  new THREE.LineBasicMaterial({ color: 0x9A9A9A })));

// 축 — 어느 쪽이 위이고 어느 쪽이 깊이인지 알려준다
{
  const o = -0.81, L = 0.58;
  const axes = [[[L, 0, 0], 0xC2453A], [[0, L, 0], 0x4C9A5B], [[0, 0, L], 0x3F6FB5]];
  for (const [v, col] of axes) {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(o, o, o), new THREE.Vector3(o + v[0], o + v[1], o + v[2])]);
    cubeScene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: col })));
  }
}

function sizeCube() {
  const r = cubeCanvas.getBoundingClientRect();
  if (r.width > 1) cubeR.setSize(r.width, r.height, false);
}
new ResizeObserver(sizeCube).observe(cubeCanvas);
sizeCube();

cubeCanvas.addEventListener("pointerdown", (e) => {
  const r = cubeCanvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, cubeCam);
  const hit = ray.intersectObject(cubeMesh, false)[0];
  if (!hit) return;
  const f = CUBE_FACES[Math.floor(hit.face.materialIndex ?? hit.faceIndex / 2)];
  if (f) fitDir(new THREE.Vector3(...f.dir));
});

// ── 선택 ────────────────────────────────────────────────────
let downAt = null, selectedBar = null, dragging = null;
/* 끌 수 있는 부재인지. 양끝 기둥과 맨 위·아래 단은 외곽 치수가 잡고 있으므로
   움직일 수 없다 — 그건 W/H 슬라이더의 몫이다. */
function dragSpec(bar) {
  if (!bar) return null;
  if (bar.kind === "post" && bar.col > 0 && bar.col < design.cols)
    return { axis: "x", index: bar.col };
  if (bar.kind !== "post" && bar.level > 0 && bar.level < design.rows - 1)
    return { axis: "z", index: bar.level };
  return null;
}

const dragPlane = new THREE.Plane(), hitPt = new THREE.Vector3();

canvas.addEventListener("pointerdown", (e) => {
  downAt = [e.clientX, e.clientY];
  const hit = pick(e, barMeshes);
  const spec = hit && dragSpec(hit.object.userData.bar);
  if (!spec) return;

  const parts = C.buildParts(design);
  const world = hit.object.getWorldPosition(new THREE.Vector3());
  // 끌기 축을 품은 평면 위에서 포인터 위치를 읽는다
  dragPlane.setFromNormalAndCoplanarPoint(
    spec.axis === "x" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0), world);

  dragging = { ...spec, parts, before: clone(design) };
  controls.enabled = false;
  viewEl.classList.add(spec.axis === "x" ? "dragging" : "dragging-v");
  canvas.setPointerCapture(e.pointerId);
  selectBar(hit.object.userData.bar);
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (!ray.ray.intersectPlane(dragPlane, hitPt)) return;

  const { axis, index, parts } = dragging;
  const M = C.MIN_SPAN;
  if (axis === "x") {
    const mm = C.snap((hitPt.x + design.w / 2000) * 1000);
    const lo = parts.postX[index - 1] + M, hi = parts.postX[index + 1] - M;
    if (hi < lo) return;
    const x = Math.min(hi, Math.max(lo, mm));
    const cw = [...parts.colW];
    cw[index - 1] = x - parts.postX[index - 1];
    cw[index] = parts.postX[index + 1] - x;
    apply({ colWidths: cw }, { history: false });
  } else {
    const mm = C.snap(hitPt.z * 1000);
    const lo = parts.zs[index - 1] + M, hi = parts.zs[index + 1] - M;
    if (hi < lo) return;
    const z = Math.min(hi, Math.max(lo, mm));
    const g = [...parts.gaps];
    g[index - 1] = z - parts.zs[index - 1];
    g[index] = parts.zs[index + 1] - z;
    apply({ rowHeights: g }, { history: false });
  }
});

function endDrag(e) {
  if (!dragging) return;
  const before = dragging.before;
  dragging = null;
  controls.enabled = true;
  viewEl.classList.remove("dragging", "dragging-v");
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  if (JSON.stringify(before) !== JSON.stringify(design)) { undo.push(before); redo.length = 0; syncHistory(); }
  setTimeout(() => { downAt = null; }, 0);
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
function pick(e, list) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(list, false)[0];
}
canvas.addEventListener("pointerup", (e) => {
  if (dragging) return;
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;  // 드래그는 선택이 아니다
  const hit = pick(e, [...panelMeshes, ...barMeshes]);
  if (!hit) { select(null); return; }
  const u = hit.object.userData;
  if (u.cell) select(u.cell); else selectBar(u.bar);
});
function select(cell) {
  selected = cell; selectedBar = null; markSelection(); renderProps();
  if (cell && isMobile()) setPane("props");
}
function selectBar(bar) {
  selectedBar = bar ?? null; selected = null; markSelection(); renderProps();
  if (bar && isMobile()) setPane("props");
}
function markSelection() {
  if (selected) {
    selMesh = panelMeshes.find((m) => m.userData.cell.level === selected.level && m.userData.cell.bay === selected.bay);
  } else if (selectedBar) {
    selMesh = barMeshes.find((m) => m.userData.bar.id === selectedBar.id);
  } else selMesh = null;

  selBox.visible = !!selMesh;
  if (!selMesh) return;
  if (selected) { selBox.geometry = edgesPanel; selBox.scale.copy(selMesh.scale); selBox.rotation.set(0, 0, 0); }
  else {
    // 부재는 길이만 다른 같은 단면이라 외곽선도 같은 식으로 늘린다
    selBox.geometry = edgesBar;
    selBox.scale.set(1, 1, selMesh.scale.z);
    selBox.rotation.copy(selMesh.rotation);
  }
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
      () => apply({ ...C.PRESETS[k], preset: k, removed: [], colWidths: null, rowHeights: null })));

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
  const isPanel = !!selected, isBar = !!selectedBar;
  $("#props-design").hidden = isPanel || isBar;
  $("#props-panel").hidden = !isPanel;
  $("#props-bar").hidden = !isBar;
  if (isBar) renderBarProps();

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

  // 자유 모드 — 칸과 단을 개별로 준다
  $("#free-spans").hidden = mode !== "free";
  if (mode === "free") {
    const parts = C.buildParts(design);
    spanRows($("#colwidths"), parts.colW, "칸", (a) => apply({ colWidths: a }));
    spanRows($("#rowheights"), parts.gaps, "단", (a) => apply({ rowHeights: a }));
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

/* 한 칸을 늘리면 다른 칸이 줄어야 한다 — 전체 치수는 고정이다.
   옆 칸에서 가져오고, 모자라면 그다음 칸에서 이어서 가져온다. */
function redistribute(arr, i, want) {
  const a = arr.map((v) => Math.round(v));
  const total = sum(a), M = C.MIN_SPAN;
  const max = total - M * (a.length - 1);
  a[i] = Math.min(max, Math.max(M, C.snap(want)));
  let rest = total - a[i];
  const others = a.map((_, k) => k).filter((k) => k !== i);
  const curRest = sum(others.map((k) => a[k])) || 1;
  for (const k of others) a[k] = Math.max(M, C.snap((a[k] / curRest) * rest));
  // 스냅 오차는 마지막 칸이 흡수
  const last = others[others.length - 1];
  a[last] += total - sum(a);
  return sum(a) === total && a.every((v) => v >= M) ? a : null;
}

function spanRows(host, spans, unit, onChange) {
  host.innerHTML = "";
  spans.forEach((v, i) => {
    const val = Math.round(v);
    const r = document.createElement("div"); r.className = "row";
    r.innerHTML = `<label>${i + 1}${unit}</label>
      <input type="range" min="${C.MIN_SPAN}" max="2400" step="10" value="${val}">
      <input type="number" step="10" value="${val}"><span class="u">mm</span>`;
    const [rg, nm] = [r.querySelector("input[type=range]"), r.querySelector("input[type=number]")];
    const set = (x) => { const a = redistribute(spans, i, +x); if (a) onChange(a); };
    rg.oninput = (e) => set(e.target.value);
    nm.onchange = (e) => set(e.target.value);
    host.append(r);
  });
  if (spans.length < 2) host.innerHTML = '<p class="hint">칸이 하나뿐이라 나눌 게 없습니다.</p>';
}

// ── 선택한 부재 ─────────────────────────────────────────────
const KIND = { post: "기둥", xrail: "가로 레일", yrail: "세로 레일" };
function renderBarProps() {
  const b = selectedBar, S = C.SERIES[design.series];
  const parts = C.buildParts(design);
  const spec = dragSpec(b);
  $("#bar-info").innerHTML =
    `${KIND[b.kind]} · ${S.label} ${C.FINISHES[design.finish].label}<br>` +
    `길이 <b>${Math.round(b.len)}mm</b> · 위치 X ${Math.round(b.pos[0])} / Y ${Math.round(b.pos[1])} / Z ${Math.round(b.pos[2])}`;

  const host = $("#bar-move"); host.innerHTML = "";
  if (!spec) {
    $("#bar-tip").textContent = b.kind === "post"
      ? "바깥쪽 기둥은 전체 폭이 잡고 있습니다. 가로 W 를 바꾸세요."
      : "맨 위·아래 단은 전체 높이가 잡고 있습니다. 높이 H 를 바꾸세요.";
    return;
  }
  const isX = spec.axis === "x";
  const cur = Math.round(isX ? parts.postX[spec.index] : parts.zs[spec.index]);
  const lo = Math.round((isX ? parts.postX[spec.index - 1] : parts.zs[spec.index - 1]) + C.MIN_SPAN);
  const hi = Math.round((isX ? parts.postX[spec.index + 1] : parts.zs[spec.index + 1]) - C.MIN_SPAN);

  const r = document.createElement("div"); r.className = "row";
  r.innerHTML = `<label>${isX ? "X 위치" : "Z 높이"}</label>
    <input type="range" min="${lo}" max="${Math.max(lo, hi)}" step="10" value="${cur}">
    <input type="number" step="10" min="${lo}" max="${Math.max(lo, hi)}" value="${cur}"><span class="u">mm</span>`;
  const [rg, nm] = [r.querySelector("input[type=range]"), r.querySelector("input[type=number]")];
  const set = (x) => moveDivider(spec, Math.min(hi, Math.max(lo, C.snap(+x))));
  rg.oninput = (e) => set(e.target.value);
  nm.onchange = (e) => set(e.target.value);
  host.append(r);
  $("#bar-tip").textContent = "3D 에서 이 부재를 바로 끌어도 됩니다.";
}

/** 경계 하나를 옮긴다 — 양옆 두 칸만 바뀌고 전체 치수는 그대로다 */
function moveDivider(spec, mm) {
  const parts = C.buildParts(design);
  if (spec.axis === "x") {
    const cw = [...parts.colW];
    cw[spec.index - 1] = mm - parts.postX[spec.index - 1];
    cw[spec.index] = parts.postX[spec.index + 1] - mm;
    apply({ colWidths: cw });
  } else {
    const g = [...parts.gaps];
    g[spec.index - 1] = mm - parts.zs[spec.index - 1];
    g[spec.index] = parts.zs[spec.index + 1] - mm;
    apply({ rowHeights: g });
  }
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
  // 부재를 옮기면 길이·위치가 달라진다 — 선택한 부재를 새 것으로 다시 잡는다
  if (selectedBar)
    selectedBar = barMeshes.find((m) => m.userData.bar.id === selectedBar.id)?.userData.bar ?? null;
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
$("#nav-undo").onclick = () => { if (!undo.length) return; redo.push(clone(design)); design = undo.pop(); selected = selectedBar = null; refresh(); syncHistory(); };
$("#nav-redo").onclick = () => { if (!redo.length) return; undo.push(clone(design)); design = redo.pop(); selected = selectedBar = null; refresh(); syncHistory(); };
$("#nav-reset").onclick = () => {
  if (!confirm("설계를 처음 상태로 되돌립니다. 계속할까요?")) return;
  undo.push(clone(design)); redo.length = 0; design = C.defaultDesign(); selected = selectedBar = null; refresh(); fit("iso"); syncHistory();
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
  if (m === "easy" && (design.rowHeights || design.colWidths)) apply({ colWidths: null, rowHeights: null });
  else renderProps();
  toast(m === "free" ? "자유 모드 — 칸 폭과 단 높이를 따로 정할 수 있습니다" : "간편 모드 — 칸과 단을 균등하게 맞춥니다");
}
$("#spans-even").onclick = () => apply({ colWidths: null, rowHeights: null });

$$("[data-step]").forEach((b) => b.onclick = () => {
  const [k, v] = b.dataset.step.split(",");
  apply({ [k]: design[k] + +v, colWidths: null, rowHeights: null });
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
$("#bar-clear").onclick = () => selectBar(null);

// ── 탭 · 뷰 컨트롤 ──────────────────────────────────────────
$("#lib-tabs").onclick = (e) => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  $$("#lib-tabs button").forEach((x) => x.classList.toggle("on", x === b));
  $$("[data-pane]").forEach((p) => p.hidden = p.dataset.pane !== b.dataset.tab);
};
$("#v-reset").onclick = () => fit("iso");
$("#v-fit").onclick = () => fitDir(camera.position.clone().sub(controls.target));
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
  if (e.key === "Escape") { select(null); selectBar(null); }
});

// ── 시작 ────────────────────────────────────────────────────
bindRange("w", ...C.LIMITS.w); bindRange("d", ...C.LIMITS.d); bindRange("h", ...C.LIMITS.h);
$("#rg-load").oninput = (e) => apply({ load: +e.target.value });
$("#in-load").onchange = (e) => apply({ load: +e.target.value });
if (design.name) $("#nav-title").value = design.name;
$("#cart-n").textContent = JSON.parse(localStorage.getItem("eulji.cart") || "[]").length;
resize(); refresh(); fit("iso", false); syncHistory();
requestAnimationFrame(() => { resize(); fit("iso", false); });
if (!localStorage.getItem("eulji.seen")) { $("#m-help").showModal(); localStorage.setItem("eulji.seen", "1"); }

