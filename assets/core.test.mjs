/* core.js 자가검증. 실행: node assets/core.test.mjs
   프레임워크 없음 — 로직이 깨지면 여기서 먼저 터지게만 해둔다. */
import assert from "node:assert/strict";
import * as C from "./core.js";

const d = C.defaultDesign("sideboard");   // 1600×400×800, 2칸 3단, 2020

// 단면 — 4면 × (챔퍼2 + 슬롯8×n)
{
  const o = C.profileOutline("2020");
  assert.equal(o.length, 4 * (2 + 8), "2020 은 면당 슬롯 1개");
  assert.equal(C.profileOutline("2040").length, 2 * (2 + 8) + 2 * (2 + 16), "2040 긴 면은 슬롯 2개");
  const r = Math.max(...o.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  assert.ok(Math.abs(r - 10) < 1e-9, "2020 외곽은 ±10mm");
}

// 부재 수 — 기둥 (칸+1)×2, 레일 단마다 (칸×2 + 기둥열)
{
  const p = C.buildParts(d);
  const posts = (d.cols + 1) * 2;
  const rails = d.rows * (d.cols * 2 + (d.cols + 1));
  assert.equal(p.bars.length, posts + rails);
  assert.equal(p.feet.length, posts);
  assert.equal(p.joints, rails * 2);
  assert.equal(p.panels.length, d.rows * d.cols);
  // 외곽 치수가 입력값과 같아야 한다 (기둥이 밖으로 삐져나오면 안 됨)
  assert.equal(p.postX[0] - 10, 0);
  assert.equal(p.postX.at(-1) + 10, d.w);
}

// 칸 비우기
{
  const p = C.buildParts({ ...d, removed: ["0,0", "1,1"] });
  assert.equal(p.panels.length, d.rows * d.cols - 2);
}

// 칸별 소재
{
  // 덮어쓴 칸만 바뀌고 나머지는 기본 소재를 따른다
  const mixed = C.normalize({ ...d, material: "white", panelMaterials: { "0,0": "oak" } });
  const p = C.buildParts(mixed);
  assert.equal(C.cellMaterial(mixed, 0, 0), "oak");
  assert.equal(C.cellMaterial(mixed, 1, 0), "white");
  assert.equal(p.panels.filter((x) => x.material === "oak").length, 1);

  // 비싼 소재를 한 칸 섞으면 전부 기본일 때보다 비싸고, 전부 비쌀 때보다 싸다
  const allCheap = C.price({ ...d, material: "white", panelMaterials: {} }).total;
  const allPricey = C.price({ ...d, material: "oak", panelMaterials: {} }).total;
  const one = C.price(mixed).total;
  assert.ok(allCheap < one && one < allPricey, "한 칸만 바꾸면 가격이 그 사이에 있어야 한다");

  // 무게도 소재를 따라간다
  assert.ok(C.price(mixed).weight > C.price({ ...d, material: "white", panelMaterials: {} }).weight);

  // BOM 은 소재별로 쪼개지고 수량 합은 패널 수와 같다
  const rows = C.bom(mixed).filter((r) => r.name.includes("패널"));
  assert.equal(rows.length, 2, "화이트와 오크 두 줄");
  assert.equal(rows.reduce((s, r) => s + r.qty, 0), p.panels.length);

  // 칸을 줄이면 범위 밖 덮어쓰기는 버려진다 — 다시 늘렸을 때 되살아나면 안 된다
  const shrunk = C.normalize({ ...d, cols: 1, panelMaterials: { "0,1": "charcoal", "0,0": "oak" } });
  assert.deepEqual(Object.keys(shrunk.panelMaterials), ["0,0"]);
  assert.equal(C.cellMaterial(C.normalize({ ...shrunk, cols: 2 }), 0, 1), shrunk.material);

  // 기본 소재와 같은 덮어쓰기는 남겨둘 이유가 없다
  assert.deepEqual(C.normalize({ ...d, material: "charcoal", panelMaterials: { "0,0": "charcoal" } }).panelMaterials, {});

  // 비운 칸은 소재 집계에 들어가지 않는다
  const holed = C.normalize({ ...d, material: "white", removed: ["0,0"], panelMaterials: { "0,0": "oak" } });
  assert.ok(!C.materialsUsed(holed).some((m) => m.key === "oak"));
}

// 처짐 — 길이 2배면 8배 (L³), 단면2차모멘트가 크면 덜 휜다
{
  const a = C.deflection(600, 100, 6800);
  assert.ok(Math.abs(C.deflection(1200, 100, 6800) / a - 8) < 1e-9);
  assert.ok(C.deflection(600, 100, 44000) < a);
}

// R1 — 칸이 너무 좁으면 제작 불가
{
  const tiny = C.normalize({ ...d, w: 300, cols: 6 });
  assert.ok(C.validate(tiny).some((v) => v.id === "R1" && v.level === "error"));
}

// R3 — 긴 스팬 + 무거운 적재는 경고, 2040 으로 바꾸면 완화된다
{
  const heavy = C.normalize({ ...d, w: 2400, cols: 1, load: 40 });
  const hit = C.validate(heavy).find((v) => v.id === "R3");
  assert.ok(hit, "처짐 경고가 떠야 한다");
  assert.ok(hit.fixes.some((f) => f.patch.series === "2040"), "원클릭 해결 버튼이 있어야 한다");
  // 2040 은 완화만 한다 — 2.4m 외팔 한 칸에 40kg 은 규격을 바꿔도 못 만든다.
  // 실제로 푸는 건 중간 지지대다.
  const stiffer = C.validate({ ...heavy, series: "2040" }).find((v) => v.id === "R3");
  assert.ok(stiffer, "2040 으로도 완전히 해소되진 않는다");
  assert.ok(!C.validate(C.normalize({ ...heavy, cols: 4 })).some((v) => v.id === "R3"),
            "칸을 나누면 처짐 경고가 사라져야 한다");
}

// normalize — 스냅과 범위
{
  const n = C.normalize({ ...d, w: 1237, d: 9999, h: -5, cols: 99, rows: 0 });
  assert.equal(n.w % C.STEP, 0);
  assert.equal(n.d, C.LIMITS.d[1]);
  assert.equal(n.h, C.LIMITS.h[0]);
  assert.equal(n.cols, C.LIMITS.cols[1]);
  assert.equal(n.rows, C.LIMITS.rows[0]);
}

// 견적 — 단조성과 마진
{
  const q = C.price(d);
  assert.ok(q.total > q.cogs, "판매가가 원가보다 커야 한다");
  assert.ok(Math.abs(1 - q.cogs / q.total - C.GM) < 0.02, "마진이 목표치 근처");
  assert.ok(q.total % 1000 === 0, "1,000원 단위로 끊는다");
  assert.ok(C.price({ ...d, w: 2000 }).total > q.total, "넓어지면 비싸진다");
  assert.ok(C.price({ ...d, material: "oak" }).total > C.price({ ...d, material: "white" }).total);
  const sum = Object.values(q.breakdown).reduce((a, b) => a + b, 0);
  assert.equal(sum, q.cogs, "분해 합계가 원가와 같아야 한다");
}

// 수율 — 손실은 음수가 될 수 없고, 제안이 나오면 실제로 싸져야 한다
{
  assert.ok(C.offcut(d) >= 0);
  const b = C.bestYield(d);
  if (b) assert.ok(C.price({ ...d, w: b.w }).total < C.price(d).total);
}

// BOM — 수량 합이 부재 수와 맞아야 한다
{
  const rows = C.bom(d), p = C.buildParts(d);
  const barQty = rows.filter((r) => r.name.includes("프로파일")).reduce((s, r) => s + r.qty, 0);
  assert.equal(barQty, p.bars.length);
  assert.ok(rows.every((r) => r.qty > 0 && r.won > 0));
}

console.log("core.js — 모든 검사 통과");
