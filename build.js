/* =====================================================================
   mini4x 빌드 — 단일 engine.js 를 HTML 템플릿의 //__ENGINE__ 자리에 인라인
   실행:  node build.js
   결과:  ../phaseA_prototype.html (자체 완결, 엔진 복제 없음)
   → engine.js 를 고치면 verify.js(검증)와 이 빌드(프로토타입)가 같은 소스를 씀.
   ===================================================================== */
const fs = require("fs");
const path = require("path");

const engine = fs.readFileSync(path.join(__dirname, "engine.js"), "utf8");
const game   = fs.readFileSync(path.join(__dirname, "game.js"),   "utf8");
const ui     = fs.readFileSync(path.join(__dirname, "ui.js"),     "utf8");   // 공유 UI(노드·타일 공용)

const targets = [
  { tpl: "app_combat.html",  out: "../phaseA_prototype.html" },
  { tpl: "app_economy.html", out: "../phaseB_economy.html" },
  { tpl: "app_tilemap.html", out: "../phaseC_tilemap.html" },
];

// node 전용 export 줄을 브라우저 전역 노출로 치환.
//  - engine: 최상위 const(UNITS/simulate)는 self에 안 붙으므로 명시적으로 노출
//    → game.js 의 `global.UNITS||UNITS` 폴백이 TDZ(로컬 const) 건드리기 전에 단락 평가됨
const engineForBrowser = engine.replace(
  /if \(typeof module[^\n]*/,
  'if (typeof self !== "undefined") { self.UNITS = UNITS; self.simulate = simulate; self.Engine = API; }'
);
const gameForBrowser = game.replace(/if\(typeof module[\s\S]*?global\.Game=API;?/, "global.Game=API;");

for (const { tpl, out } of targets) {
  const tplPath = path.join(__dirname, tpl);
  if (!fs.existsSync(tplPath)) { console.log(`- skip ${tpl} (없음)`); continue; }
  let html = fs.readFileSync(tplPath, "utf8");
  if (!html.includes("//__ENGINE__")) { console.log(`- ${tpl}: //__ENGINE__ 마커 없음`); continue; }
  html = html.replace("//__ENGINE__", "/* ==== engine.js 인라인 (build.js 생성, 직접 수정 금지) ==== */\n" + engineForBrowser);
  let parts = `engine.js ${engine.length}자`;
  if (html.includes("//__GAME__")) {
    html = html.replace("//__GAME__", "/* ==== game.js 인라인 (build.js 생성, 직접 수정 금지) ==== */\n" + gameForBrowser);
    parts += ` + game.js ${game.length}자`;
  }
  if (html.includes("//__UI__")) {
    html = html.replace("//__UI__", "/* ==== ui.js 인라인 (build.js 생성, 직접 수정 금지) ==== */\n" + ui);
    parts += ` + ui.js ${ui.length}자`;
  }
  fs.writeFileSync(path.join(__dirname, out), html);
  console.log(`✓ ${out} 생성 (${parts} 인라인)`);
}
