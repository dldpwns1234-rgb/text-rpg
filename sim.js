/* =====================================================================
   mini4x 플레이테스트 시뮬레이터 (얇은 버전)
   - 게임 규칙은 전부 game.js(단일 소스)에서 가져옴. 여기엔 플레이어 봇 + 집계만.
   - 실행: node sim.js
   - 참고: 봇은 연구·영웅을 안 씀 → 플레이어에 다소 불리한 하한선.
   ===================================================================== */
const Game = require("./game.js");
const E = require("./engine.js");
const troops = Game.troops;
const RESNODE={식량:"FOOD",목재:"WOOD",석재:"STONE",철:"IRON"};
const BOT_ATTACK=20;

function botCounter(g){const t={front:0,mid:0,back:0};
  for(const a of g.armies){if(a.side!=="E")continue;for(const u in a.comp){const U=E.UNITS[Game.baseOf(u)];if(U.monster)continue;t[U.row]+=a.comp[u];}}
  const mx=["front","mid","back"].reduce((a,b)=>t[a]>=t[b]?a:b);return mx==="mid"?"창병":mx==="back"?"경기병":"석궁병";}

function botTurn(g){
  // 0) 채집대 1개만 파견(스타터 부대 없음). 주둔군은 수성용으로 넉넉히 남김.
  let gth=g.armies.filter(a=>a.side==="P"&&a.goal&&a.goal.startsWith("gather"));
  if(gth.length<1 && Game.canAddArmy(g) && troops({comp:g.castle.garrison})>=20){
    let need=4; for(const u of Object.keys(g.castle.garrison)){ while(need>0&&(g.castle.garrison[u]||0)>0){Game.draftAdjust(g,u,1);need--;} if(need<=0)break; }
    const a=Game.deploy(g); if(!a){g.castle.draft={};} else { a.goal="gather:FOOD"; gth.push(a); }
  }
  // 1) 채집: 워커를 가장 부족한 자원지로
  const scarce=[...Game.RES].sort((a,b)=>g.res[a]-g.res[b]);
  gth.forEach((w,i)=>{const dest=RESNODE[scarce[i%Game.RES.length]];w.goal="gather:"+dest;if(w.node!==dest)Game.marchToward(g,w,dest);});
  if(g.over)return;
  // 1.2) 내정 영웅 성 배치(생산속도 +1) + 연구(대장간→영농→채굴법, 병렬)
  const ch=g.heroes.find(h=>h.type==="내정"); if(ch&&ch.loc!=="castle")Game.assignHero(g,ch.id,"castle");
  if(g.castle.buildings.includes("대학")&&!g.research.active){ for(const r of ["대장간","영농","채굴법","군제 개편"]){ if(!Game.startResearch(g,r))break; } }
  // 2) 생산: 큐가 마르지 않게 상성 위주로 채움 (건물 레벨 되면 T2 섞기)
  let cap=Game.buildRate(g)*2, q=0;
  while(q<cap){ let bought=false;
    for(const u of [botCounter(g),"중갑보병","창병","장궁병","경기병"]){ if(!u)continue; const t=Math.min(Game.maxTierFor(g,u)||1, g.turn>16?2:1); if(!Game.produce(g,u,1,t)){bought=true;break;} }
    if(!bought)break; q++; }
  // 3) 건설(시간 소요, 한 번에 하나) — 우선순위: 초반 경제 Lv2 → 대학 → 성 레벨 → 경제 Lv4 → 궁수대 → 성벽
  if(!g.castle.build){
    let did=false;
    for(const k of ["농장","철광산","벌목장","채석장"]){ if((g.castle.econ[k]||0)<2 && !Game.buildEcon(g,k)){did=true;break;} }
    if(!did && !g.castle.buildings.includes("대학") && g.res.석재>=20){ if(!Game.buildUniversity(g))did=true; }
    if(!did && g.castle.level<4 && g.res.목재>=25&&g.res.철>=15){ if(!Game.levelUp(g))did=true; }
    if(!did) for(const k of ["농장","철광산","벌목장","채석장"]){ if((g.castle.econ[k]||0)<4 && !Game.buildEcon(g,k)){did=true;break;} }
    if(!did && !g.castle.buildings.includes("궁수대") && g.res.목재>=40&&g.res.철>=30){ if(!Game.construct(g,"궁수대"))did=true; }
    if(!did && g.res.석재>=90) Game.fortifyWall(g);
  }
  // 4) 공격: 슬롯 여유 있으면 20병 편성 부대를 계속 찍어 E로 결집(방어 예비 15 유지)
  const gar=troops({comp:g.castle.garrison});
  if(gar>=35 && Game.canAddArmy(g)){
    let take=20; for(const u in {...g.castle.garrison}){let n=g.castle.garrison[u]||0;while(n-->0&&take>0){Game.draftAdjust(g,u,1);take--;}if(take<=0)break;}
    const army=Game.deploy(g);
    if(army){ army.goal="attack"; const h=g.heroes.find(h=>h.type==="전투"&&h.loc==="idle"); if(h){h.loc=army.id;army.hero=h.id;} }
    else g.castle.draft={};
  }
  for(const a of g.armies.filter(a=>a.side==="P"&&a.goal==="attack")){if(g.over)break;Game.marchToward(g,a,"E");}
}

function runGame(maxTurns=140){
  const g=Game.newGame(); const trace=[];
  while(!g.over && g.turn<=maxTurns){
    botTurn(g); if(g.over)break;
    Game.endTurn(g);
    if(g.turn%6===0)trace.push({t:g.turn,res:{...g.res},aiHome:troops(g.armies.find(a=>a.role==="home")||{comp:{}}),pArmies:g.armies.filter(a=>a.side==="P").length});
  }
  if(!g.over)g.winner="timeout";
  return {winner:g.winner,turns:g.turn,resEnd:g.res,monLeft:g.armies.filter(a=>a.side==="M").length,trace};
}

const N=400; const stat={P:0,E:0,timeout:0}; let sumWin=0,winCount=0,resAcc={식량:0,목재:0,석재:0,철:0},monClear=0;
for(let i=0;i<N;i++){const r=runGame();stat[r.winner]++;if(r.winner!=="timeout"){sumWin+=r.turns;winCount++;}for(const k of Game.RES)resAcc[k]+=r.resEnd[k];if(r.monLeft<2)monClear++;}
console.log(`=== ${N}판 플레이테스트 (game.js 공유 규칙) ===`);
console.log(`승률 — 플레이어 ${(100*stat.P/N).toFixed(0)}% · 적 ${(100*stat.E/N).toFixed(0)}% · 시간초과 ${(100*stat.timeout/N).toFixed(0)}%`);
console.log(`평균 게임 길이 — 승부난 판 ${(winCount?sumWin/winCount:0).toFixed(1)}턴`);
console.log(`종료 시 평균 잉여 자원 — ${Game.RES.map(k=>k+" "+(resAcc[k]/N).toFixed(0)).join(" / ")}`);
console.log(`몬스터 소탕(≥1) — ${(100*monClear/N).toFixed(0)}%`);
const demo=runGame(); console.log(`\n대표 1판: ${demo.winner} 승, ${demo.turns}턴`);
demo.trace.forEach(t=>console.log(`  T${t.t}: 식${t.res.식량} 목${t.res.목재} 석${t.res.석재} 철${t.res.철} · 적본대 ${t.aiHome} · 아군부대 ${t.pArmies}`));
