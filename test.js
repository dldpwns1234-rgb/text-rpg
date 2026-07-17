/* =====================================================================
   mini4x 자동 테스트 — 빌드된 HTML을 실제 브라우저에서 검증
   실행:  node build.js && node test.js
   목적:  로드·전투·턴 진행·저장/불러오기를 두 판(노드/타일) 모두 확인.
          (예: engine snapshot 이름 충돌로 전투가 깨졌던 버그를 즉시 잡음)
   ===================================================================== */
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright/index.js")); }

const TARGETS = [
  { name: "노드판 phaseB", file: "phaseB_economy.html",  minNodes: 17 },
  { name: "타일판 phaseC", file: "phaseC_tilemap.html",  minNodes: 100 },
];
const ROOT = path.join(__dirname, "docs");   // 빌드 산출물 위치(docs/ = GitHub Pages 서빙 폴더)

let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : fail++; console.log(`  ${cond ? "✅" : "❌"} ${label}`); return cond; };

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  for (const t of TARGETS) {
    console.log(`\n[${t.name}]`);
    const page = await browser.newPage();
    const errs = [];
    page.on("pageerror", e => errs.push("PAGEERR: " + e.message));
    page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto("file://" + path.join(ROOT, t.file));
    await page.waitForTimeout(400);

    // 1) 로드 + 맵 규모
    const load = await page.evaluate(() => ({ game: typeof Game, nodes: Object.keys(Game.NODES).length, turn: state.turn }));
    ok(load.game === "object", "Game 로드");
    ok(load.nodes >= t.minNodes, `맵 노드 ${load.nodes} (≥${t.minNodes})`);
    ok(load.turn === 1, "시작 턴 1");

    // 2) 전투 (snapshot 충돌류 회귀 방지)
    const battle = await page.evaluate(() => {
      try {
        const atk = { id: "T_atk", side: "P", node: "P", name: "테스트", comp: { 경기병: 20 }, hero: null };
        const def = { id: "T_def", side: "M", node: "P", name: "몹", mtier: "사냥", comp: { 고블린: 6 }, hero: null, reward: { 식량: 5 } };
        const s = Game.resolveBattle(state, atk, def, "P");
        return { ok: !!(s && s.result) };
      } catch (e) { return { ok: false, msg: e.message }; }
    });
    ok(battle.ok, "전투 resolveBattle 정상" + (battle.msg ? ` (${battle.msg})` : ""));

    // 3) 턴 진행 3회 (적 AI·건설·리스폰 포함) 무에러
    for (let i = 0; i < 3; i++) { await page.click("#endturn"); await page.waitForTimeout(150); }
    const after = await page.evaluate(() => state.turn);
    ok(after >= 4, `3턴 진행 → 턴 ${after}`);

    // 4) 저장/불러오기 라운드트립
    const save = await page.evaluate(() => {
      state.res.석재 = 4321;
      saveLocal(true);
      const t0 = state.turn; state.turn = 999; state.res.석재 = 0;
      loadLocal();
      return { turn: state.turn === t0, stone: state.res.석재 === 4321 };
    });
    ok(save.turn && save.stone, "저장→불러오기 복원");

    ok(errs.length === 0, "콘솔/페이지 에러 없음" + (errs.length ? " — " + errs.slice(0, 2).join(" | ") : ""));
    await page.close();
  }
  await browser.close();
  console.log(`\n===== 결과: ${pass} PASS / ${fail} FAIL =====`);
  process.exit(fail ? 1 : 0);
})();
