/* =====================================================================
   mini4x 게임 로직 — 단일 캔노니컬 모듈 (DOM 없음, node + 브라우저 공용)
   - HTML 게임(렌더링)과 sim(플레이테스트)이 이 하나를 공유.
   - 모든 함수는 게임 상태 g 를 인자로 받는 순수 로직. 렌더/토스트/애니메이션 없음.
   - node:    const Game = require('./game.js');  Game.endTurn(g)
   - 브라우저: engine.js + game.js 인라인 → 전역 Game 로 노출
   ===================================================================== */
(function(global){
  "use strict";
  const E = (typeof module!=="undefined" && module.exports) ? require("./engine.js")
          : { UNITS: global.UNITS || UNITS, simulate: global.simulate || simulate,
              CONST: (global.Engine&&global.Engine.CONST) || (typeof CONST!=="undefined"?CONST:null) };
  const UNITS = E.UNITS, simulate = E.simulate;
  const BATTLE_ROUNDS = (E.CONST && E.CONST.BATTLE_ROUNDS) || 40;  // 전투 라운드 캡(엔진 공유 상수). 브라우저 폴백 40.
  let API;  // 하단에서 채움. setMap 이 맵 교체 시 노출 참조를 갱신하는 데 필요(TDZ 회피).

  // ---- 상수 ----
  const RES=["식량","목재","석재","철"];
  const GATHER_BASE=6, GATHER_HERO=1.5, ARMY_CAP=20, ECON_CAP=20, WOUND_RATE=0.35;
  const ARMY_SLOTS_BASE=3;  // 운용 부대 수 상한(§9): 기본 + 성 레벨 + 연구. 총군사력 = 부대수 × ARMY_CAP
  const UPKEEP_RATE=0.2, UPKEEP_FREE=20;  // 식량 유지비: FREE 초과 병력 1당 매턴 소모(대군 소프트 상한). 고갈 시 생산 중단
  const XP_REWARD={사냥:1,토벌:2,레이드:3};      // 몬스터 처치 → 경험치 아이템
  const PROMOTE_COST={1:2,2:4};                  // ★1→2 : 2, ★2→3 : 4 (경험치 아이템)
  const wallCost=lv=>({석재:25+lv*20,철:5+lv*4}); // 성벽 보강(반복형 석재 소비처) — 수성 방어↑
  const HERO_BUFF=0.20, HP_SCALE=1.0;  // HP 전역 배율. 1.4는 티어테스트 잔재로 삼각(기병>궁병)을 깨뜨려 1.0으로 정정(§7). 1.0=항등 → 실제 전투가 verify.js 검증 조건과 일치.
  // ---- 영웅 등급(★1~3): 등급이 버프 세기 결정 ----
  const GRADE_BUFF={1:0.15,2:0.20,3:0.28}, GRADE_GATHER={1:1.4,2:1.5,3:1.7};
  // ---- 선술집 · 토벌 점수 ----
  const HERO_NAMES=["기사 아론","현자 밀라","용병 카일","사제 리나","궁정관 세드","기공사 도라","방백 유리","척후장 벤","연금술사 나임","백부장 그렌"];
  const TAVERN_COST={목재:20,석재:15,철:10}, POOL_CAP=3, TAVERN_GAP=3;
  const RECRUIT_COST={1:{식량:30,목재:20},2:{식량:50,목재:35,철:20}};
  const SPECIAL_COST={토벌:15,식량:60,철:40};        // ★3 특별 영입(토벌 점수 소모)
  const SUBDUE_REWARD={토벌:3,레이드:10};             // 토벌·레이드 처치 시 토벌 점수
  const UNIT_COST={중갑보병:{식량:2,목재:2,철:2},창병:{식량:2,목재:3,철:2},장궁병:{식량:1,목재:3,철:1},석궁병:{식량:1,목재:2,철:2},경기병:{식량:4,목재:2,철:3},중기병:{식량:3,목재:1,철:4}};
  // ---- 티어 (T1 기본 · T2 정예 · T3 상급). 스탯 배율은 engine.tierMult, 여기선 비용/키 관리 ----
  const TIER_MAX=3, TIER_NAME={1:"기본",2:"정예",3:"상급"};
  // 복합 키: T1은 순수 이름, T2+는 "이름@T2" (기존 저장구조 하위호환)
  const uk=(name,tier)=>(tier&&tier>1)?name+"@T"+tier:name;
  const baseOf=k=>{const i=k.indexOf("@T");return i<0?k:k.slice(0,i);};
  const tierOf=k=>{const i=k.indexOf("@T");return i<0?1:(+k.slice(i+2)||1);};
  const unitLabel=k=>{const t=tierOf(k);return t>1?baseOf(k)+" T"+t:baseOf(k);};
  // 고티어 = 비용↑, 특히 철(기획서: 고티어 철 병목). T2 ×1.6, T3 ×2.4 + 티어당 철 추가
  function costOf(name,tier){tier=tier||1;const base=UNIT_COST[name],mul=1+0.6*(tier-1),c={};
    for(const r in base)c[r]=Math.round(base[r]*mul);c.철=(c.철||0)+2*(tier-1);return c;}
  const CASTLE_UP_COST={목재:20,석재:15,철:10};
  const BUILDINGS={ "병영":{cost:{목재:15,석재:10,철:5},units:["중갑보병","창병"],icon:"🛡"},
    "궁수대":{cost:{목재:15,석재:5,철:10},units:["장궁병","석궁병"],icon:"🏹"},
    "마구간":{cost:{목재:10,석재:10,철:15},units:["경기병","중기병"],icon:"🐎"} };
  // 유닛 → 생산 건물 매핑, 건물 레벨업 비용 (레벨↑ = 생산 가능 티어↑, 최대 TIER_MAX)
  const UNIT_BLD={}; for(const b in BUILDINGS) for(const u of BUILDINGS[b].units) UNIT_BLD[u]=b;
  function bUpCost(key,lv){const base=BUILDINGS[key].cost,c={};for(const r in base)c[r]=Math.round(base[r]*(0.8+0.7*lv));c.철=(c.철||0)+5*lv;return c;}
  const ECON_BUILDINGS={ 농장:{icon:"🌾",cost:{목재:8,석재:4,철:2},res:"식량",amt:3},
    벌목장:{icon:"🪵",cost:{목재:4,석재:6,철:4},res:"목재",amt:3},
    채석장:{icon:"🪨",cost:{목재:8,석재:2,철:4},res:"석재",amt:2},
    철광산:{icon:"⚒",cost:{목재:8,석재:6,철:2},res:"철",amt:2},
    병원:{icon:"🏥",cost:{목재:10,석재:8,철:6},res:null} };
  const UNIV_COST={목재:25,석재:20,철:15};
  const GROUPS={보병:["중갑보병","창병"],궁병:["장궁병","석궁병"],기병:["경기병","중기병"]};
  // ---- 시간 기반 이동 속도: 병종 그룹별 타일 1칸 통과 소요 틱(작을수록 빠름). 섞이면 그룹 단순 평균. ----
  const MOVE_TICKS={보병:4,궁병:3,기병:2};
  const UNIT_GROUP={}; for(const grp in GROUPS) for(const u of GROUPS[grp]) UNIT_GROUP[u]=grp;
  const STATNAME={atk:"공격",df:"방어",hp:"체력"};
  // 시간 기반 이동으로 수비가 강해져(웨이브가 느리게 도착) 구값(waveSize30)은 AI 무력화 → 상향.
  // ws40이면 AI 100%(과함), ws38이면 ~40%(명확한 위협+능동 방어로 극복 가능). §10 밸런스 참조.
  const AI={budgetPerTurn:5,waveSize:38,homeCap:70,tierEvery:16,waveCap:2,waveFrac:0.85}, AI_UNIT_COST={중갑보병:3,창병:3,장궁병:2,석궁병:3,경기병:4,중기병:5};

  const RESEARCH={
    "축성술":{cat:"전투",sub:"공성·수성",req:[],cost:{목재:15,철:15},turns:2,desc:"내 성 수비 +15%"},
    "공성술":{cat:"전투",sub:"공성·수성",req:["축성술"],cost:{목재:20,철:20},turns:3,desc:"공성 시 적 성벽 완화"},
    "영농":{cat:"내정",sub:"경제",req:[],cost:{식량:15,목재:15},turns:2,desc:"자원 건물 수입 +50%"},
    "대장간":{cat:"내정",sub:"경제",req:[],cost:{목재:15,철:20},turns:2,desc:"병력 생산 속도 +1"},
    "행군술":{cat:"내정",sub:"경제",req:[],cost:{식량:15,철:15},turns:2,desc:"모든 부대 이동력 +1"},
    "채굴법":{cat:"내정",sub:"경제",req:[],cost:{목재:20,석재:15},turns:2,desc:"자원지 채집량 +2"},
    "정밀 채굴":{cat:"내정",sub:"경제",req:["채굴법"],cost:{목재:25,석재:20},turns:3,desc:"자원지 채집량 +2 (누적)"},
    "군제 개편":{cat:"내정",sub:"경제",req:[],cost:{식량:20,목재:20,철:10},turns:3,desc:"운용 부대 수 +1"},
  };
  (function(){ const base={atk:{목재:12,철:12},df:{목재:8,철:16},hp:{식량:12,철:14}};
    for(const g in GROUPS) for(const st in STATNAME){ const c1=base[st],c2={}; for(const r in c1)c2[r]=Math.round(c1[r]*1.6);
      const k1=`${g} ${STATNAME[st]} I`,k2=`${g} ${STATNAME[st]} II`;
      RESEARCH[k1]={cat:"전투",sub:g,req:[],cost:c1,turns:2,desc:`${g} ${STATNAME[st]} +15%`,mod:{group:g,stat:st,mul:1.15}};
      RESEARCH[k2]={cat:"전투",sub:g,req:[k1],cost:c2,turns:3,desc:`${g} ${STATNAME[st]} +15% (누적)`,mod:{group:g,stat:st,mul:1.15}}; } })();

  // ---- 맵 (로직: 위상만. 좌표는 렌더러 담당) — setMap 으로 교체 가능(노드↔타일) ----
  const RESPAWN_DELAY=8;
  // 기본 맵: 17노드 (침공 회랑 P-FOOD-NORTH-CROSS-STONE-RUIN-E, 둥지는 가지)
  const DEFAULT_MAP={
    NODES:{ P:{name:"아군 성",type:"castle",owner:"P"}, FOOD:{name:"곡창",type:"resource",res:"식량"},
      WOOD:{name:"삼림",type:"resource",res:"목재"}, DEN3:{name:"도적 소굴",type:"den"}, DEN1:{name:"늑대 둥지",type:"den"},
      GROVE:{name:"남부 삼림",type:"resource",res:"목재"}, NORTH:{name:"북부 평원",type:"plain"},
      CROSS:{name:"중앙 교차로",type:"plain"}, SOUTH:{name:"남부 평원",type:"plain"},
      ANCIENT:{name:"고대성",type:"ancient",owner:null}, DEN2:{name:"고블린 소굴",type:"den"}, DEN4:{name:"오크 진지",type:"den"},
      STONE:{name:"채석장",type:"resource",res:"석재"}, IRON:{name:"철광",type:"resource",res:"철"},
      FOOD2:{name:"동부 곡창",type:"resource",res:"식량"}, RUIN:{name:"폐허 평원",type:"plain"},
      E:{name:"적 성",type:"castle",owner:"E"} },
    EDGES:[
      ["P","FOOD",1],["P","WOOD",1],["P","DEN3",1],
      ["FOOD","NORTH",1],["FOOD","DEN1",1],["WOOD","GROVE",1],
      ["DEN3","DEN1",1],["DEN1","NORTH",1],["GROVE","SOUTH",1],
      ["NORTH","CROSS",1],["SOUTH","CROSS",1],
      ["CROSS","STONE",2],["CROSS","ANCIENT",1],["CROSS","DEN2",2],["CROSS","DEN4",2],
      ["SOUTH","DEN4",2],["SOUTH","IRON",2],
      ["ANCIENT","DEN4",1],["ANCIENT","STONE",2],
      ["DEN2","STONE",1],["DEN4","IRON",1],
      ["STONE","RUIN",1],["STONE","FOOD2",1],["IRON","RUIN",1],
      ["FOOD2","E",1],["RUIN","E",1],["IRON","E",2]],
    MONSTERS:[
      {node:"DEN1", name:"늑대 무리",  mtier:"사냥", comp:{늑대:12},            reward:{식량:25,목재:20}},
      {node:"DEN3", name:"도적 소굴",  mtier:"사냥", comp:{고블린:8,늑대:4},     reward:{식량:20,철:12}},
      {node:"DEN2", name:"고블린 소굴", mtier:"토벌", comp:{오크:6,하피:6,오우거:2}, reward:{철:40,석재:30,식량:30}},
      {node:"DEN4", name:"오크 진지",  mtier:"토벌", comp:{오크:10,오우거:3,하피:5}, reward:{철:35,목재:30,석재:25}},
      {node:"ANCIENT", name:"고대 생물", mtier:"레이드", comp:{오우거:6,오크:12,하피:8}, reward:{철:70,석재:50,식량:50}},
    ],
  };
  // 교체 가능한 현재 맵 (let → 클로저가 항상 최신 참조). setMap 으로 노드↔타일 전환.
  let NODES, EDGES, ADJ, MONSTERS, MSPAWN;
  function setMap(m){ NODES=m.NODES; EDGES=m.EDGES; MONSTERS=m.MONSTERS||[]; MSPAWN=m.spawn||null;
    ADJ={}; for(const id in NODES) ADJ[id]=[];
    for(const[a,b,c]of EDGES){ADJ[a].push({to:b,cost:c});ADJ[b].push({to:a,cost:c});}
    if(typeof API!=="undefined"&&API){ API.NODES=NODES; API.EDGES=EDGES; API.ADJ=ADJ; API.MONSTERS=MONSTERS; } // 노출 참조 갱신
    return API; }
  setMap(DEFAULT_MAP);
  // 랜덤 스폰(타일 맵): 성/인접이 아닌 빈 평지 타일에 몬스터 배치
  const randomTile=g=>{const cands=Object.keys(NODES).filter(id=>NODES[id].type==="plain"&&!g.armies.some(a=>a.node===id)&&!ADJ[id].some(n=>NODES[n.to].type==="castle"));
    return cands.length?cands[Math.floor(Math.random()*cands.length)]:null;};
  function spawnRoamer(g,tmpl){const node=randomTile(g); if(!node)return null;
    const a={id:"MON"+(g._nid++),side:"M",node,mp:0,maxMp:0,name:tmpl.name,mtier:tmpl.mtier,comp:{...tmpl.comp},hero:null,reward:{...tmpl.reward},roamer:true};
    g.armies.push(a); return a;}
  function dijkstra(start,maxCost){const dist={[start]:0},prev={},pq=[[0,start]];
    while(pq.length){pq.sort((x,y)=>x[0]-y[0]);const[d,u]=pq.shift();if(d>dist[u])continue;
      for(const{to,cost}of ADJ[u]){const nd=d+cost;if(nd<=maxCost&&(dist[to]===undefined||nd<dist[to])){dist[to]=nd;prev[to]=u;pq.push([nd,to]);}}}
    return{dist,prev};}
  function pathTo(t,prev){const p=[t];let c=t;while(prev[c]!==undefined){c=prev[c];p.unshift(c);}return p;}
  const mkMonster=t=>({id:"MON_"+t.node,side:"M",node:t.node,mp:0,maxMp:0,name:t.name,mtier:t.mtier,comp:{...t.comp},hero:null,reward:{...t.reward}});

  // ---- 상태 ----
  function _baseGame(){ if(NODES.ANCIENT)NODES.ANCIENT.owner=null; return {
    turn:1, res:{식량:45,목재:45,석재:25,철:25},
    castle:{level:1,queue:[],buildings:["병영"],blevel:{병영:1},openBuilding:"병영",garrison:{중갑보병:5,창병:5,경기병:6},draft:{},econ:{},wounded:{},wall:0,build:null},
    research:{done:{},active:null,tab:"전투"}, ai:{budget:0},
    raid:{need:4,holder:null,holdTurns:0,cleared:false}, subdue:0, xpItems:0, tavern:{built:false,pool:[]}, respawns:[],
    quests:{done:[],idx:0},   // 온보딩 퀘스트 진행(선형 체인 인덱스)
    milestones:{done:[],idx:0,unlocked:[]},   // 마일스톤 진행(A2)
    conquests:0, defeats:0, raidWins:0, raidLosses:0,   // 지속형 왕국 지표(A3) — 게임오버 대신 누적 기록
    heroes:[{id:"H1",name:"재상 로한",type:"내정",grade:2,loc:"idle"},{id:"H2",name:"장군 카이",type:"전투",grade:2,loc:"idle"}],
    armies:[
      {id:"E1",side:"E",node:"E",mp:0,maxMp:0,name:"적 1군",comp:{중기병:8},hero:null,role:"home"},
    ], over:false, winner:null, _nid:1000 };
  }
  function newGame(){ const g=_baseGame();
    if(MSPAWN){ for(let i=0;i<(MSPAWN.count||4);i++) spawnRoamer(g, MSPAWN.pool[i%MSPAWN.pool.length]);
      if(MSPAWN.raid && NODES.ANCIENT) g.armies.push(mkMonster({node:"ANCIENT",...MSPAWN.raid})); }
    else for(const m of MONSTERS) g.armies.push(mkMonster(m));
    return g;
  }
  const newId=(g,p)=>p+(g._nid++);

  // ---- 헬퍼 ----
  const findArmy=(g,id)=>g.armies.find(a=>a.id===id);
  const armiesAt=(g,n)=>g.armies.filter(a=>a.node===n);
  const pArmyCount=g=>g.armies.filter(a=>a.side==="P").length;
  // 운용 부대 수: 기본 3, 성 Lv3→4·Lv5→5 (연구 '군제 개편' +1), 최대 5
  const ARMY_SLOTS_MAX_BASE=5, WALL_MAX_BASE=6;   // 마일스톤(A2) 해금으로 각각 +1씩, 최대 +2까지 확장
  const milestoneUnlocks=g=>(g.milestones&&g.milestones.unlocked)||[];
  const unlockCount=(g,key,cap)=>Math.min(cap,milestoneUnlocks(g).filter(x=>x===key).length);
  const armySlotsMax=g=>ARMY_SLOTS_MAX_BASE+unlockCount(g,"slot",2);
  const wallMaxLv=g=>WALL_MAX_BASE+unlockCount(g,"wall",2);
  const armySlots=g=>Math.min(armySlotsMax(g), ARMY_SLOTS_BASE+(g.castle.level>=3?1:0)+(g.castle.level>=5?1:0)+(g.research.done["군제 개편"]?1:0));
  const canAddArmy=g=>pArmyCount(g)<armySlots(g);
  const heroById=(g,id)=>g.heroes.find(h=>h.id===id);
  const troops=a=>Object.values(a.comp).reduce((x,y)=>x+y,0);
  const canAfford=(g,c)=>Object.entries(c).every(([r,v])=>g.res[r]>=v);
  const pay=(g,c)=>{for(const r in c)g.res[r]-=c[r];};
  const hasR=(g,k)=>!!g.research.done[k];
  const pBaseMp=g=>5+(hasR(g,"행군술")?1:0);   // 확장 맵 대응(회랑 P→E≈7)
  const cityHero=g=>g.heroes.find(h=>h.type==="내정"&&h.loc==="castle");
  const buildRate=g=>{const h=cityHero(g);return 1+(g.castle.level-1)+(h?(h.grade>=3?2:1):0)+(hasR(g,"대장간")?1:0);};
  const aiTierOf=g=>Math.min(TIER_MAX,1+Math.floor(g.turn/(AI.tierEvery||14)));   // AI 티어 성장
  const aiCombatBuff=g=>0.06+0.03*(aiTierOf(g)-1);                                // AI 지휘관 정예화(영웅 대칭)
  const castleBaseIncome=g=>({식량:3+g.castle.level,목재:2+g.castle.level,석재:1+g.castle.level,철:g.castle.level+2});
  function econIncome(g){const inc={식량:0,목재:0,석재:0,철:0},mult=hasR(g,"영농")?1.5:1;
    for(const k in ECON_BUILDINGS){const b=ECON_BUILDINGS[k],n=g.castle.econ[k]||0;if(b.res&&n)inc[b.res]+=Math.round(b.amt*n*mult);}return inc;}
  function gatherOf(g,a){const n=NODES[a.node];if(a.side!=="P"||n.type!=="resource")return null;
    const hero=a.hero&&heroById(g,a.hero); const isCity=hero&&hero.type==="내정";
    const base=GATHER_BASE+(hasR(g,"채굴법")?2:0)+(hasR(g,"정밀 채굴")?2:0);
    return {res:n.res,amt:Math.round(base*(isCity?GRADE_GATHER[hero.grade]:1))};}
  // 총 병력(주둔군 + 아군 부대) → 식량 유지비
  const totalTroops=g=>Object.values(g.castle.garrison).reduce((x,y)=>x+y,0)+g.armies.filter(a=>a.side==="P").reduce((x,a)=>x+troops(a),0);
  const foodUpkeep=g=>Math.ceil(Math.max(0,totalTroops(g)-UPKEEP_FREE)*UPKEEP_RATE);
  function income(g){const inc={식량:0,목재:0,석재:0,철:0},base=castleBaseIncome(g),e=econIncome(g);
    for(const r of RES)inc[r]+=base[r]+e[r];
    for(const a of g.armies){const gt=gatherOf(g,a);if(gt)inc[gt.res]+=gt.amt;}
    inc.식량-=foodUpkeep(g);   // 유지비 차감(순수입, 음수 가능)
    return inc;}

  // ---- 국력(Might) 점수(A1): 왕국의 성장을 단일 수치로 요약 → 상단 상시 표시. 성장 요소 증가 시에만 단조 증가. ----
  const MIGHT_TIER_W={1:1,2:1.6,3:2.4};   // costOf 티어 배율과 동일선상 가중
  const compMight=comp=>Object.entries(comp||{}).reduce((s,[k,v])=>s+v*(MIGHT_TIER_W[tierOf(k)]||1),0);
  function computeMight(g){
    let m=g.castle.level*20 + (g.castle.wall||0)*10;
    for(const k in g.castle.blevel) m+=(g.castle.blevel[k]||0)*8;
    for(const k in g.castle.econ) m+=(g.castle.econ[k]||0)*4;
    m+=Object.keys(g.research.done||{}).length*10;
    m+=compMight(g.castle.garrison)*0.6;
    for(const a of g.armies) if(a.side==="P") m+=compMight(a.comp)*0.6;
    m+=g.heroes.reduce((s,h)=>s+h.grade*15,0);
    return Math.round(m);
  }
  // 적 위협 대략치(비교용 표시): P와 동일 스케일은 아님, 병력 규모 기준 단순 지표
  const enemyMight=g=>{let t=0;for(const a of g.armies)if(a.side==="E")t+=troops(a);return Math.round(t*1.2);};

  // ---- 연구 버프 → 전투 mods ----
  function researchMods(g){const m={};
    for(const k in RESEARCH){const r=RESEARCH[k];if(r.mod&&g.research.done[k]){for(const n of GROUPS[r.mod.group]){m[n]=m[n]||{};m[n][r.mod.stat]=(m[n][r.mod.stat]||1)*r.mod.mul;}}}return m;}
  const HP_MODS=Object.fromEntries(Object.keys(UNITS).map(n=>[n,{hp:HP_SCALE}]));
  function mergeMods(a,b){if(!a)return b;if(!b)return a;const m={};
    for(const n of new Set([...Object.keys(a),...Object.keys(b)])){m[n]={};for(const s of["atk","df","hp"]){const v=((a[n]&&a[n][s])||1)*((b[n]&&b[n][s])||1);if(v!==1)m[n][s]=v;}}return m;}

  // ---- 전투 ----
  const compArr=a=>Object.entries(a.comp).map(([k,count])=>({name:baseOf(k),count,tier:tierOf(k)}));
  const hasCombatHero=(g,a)=>a.hero&&heroById(g,a.hero)?.type==="전투";
  function removeArmy(g,a){g.heroes.forEach(h=>{if(h.loc===a.id)h.loc="idle";});g.armies=g.armies.filter(x=>x!==a);}
  function resolveBattle(g,attacker,defender,node){
    const fort=NODES[node].type==="castle"&&NODES[node].owner===defender.side;
    const ancientHold=node==="ANCIENT"&&NODES.ANCIENT.owner===defender.side; // 고대성 방어 보정
    const aHero=hasCombatHero(g,attacker)?heroById(g,attacker.hero):null;
    const dHero=hasCombatHero(g,defender)?heroById(g,defender.hero):null;
    let aB=aHero?GRADE_BUFF[aHero.grade]:0, dB=dHero?GRADE_BUFF[dHero.grade]:0;
    if(fort){ dB+=(attacker.side==="P"&&hasR(g,"공성술"))?0.05:0.22; if(defender.side==="P"&&hasR(g,"축성술"))dB+=0.15; }
    if(node==="P"&&defender.side==="P") dB+=Math.min(wallMaxLv(g)*0.05,(g.castle.wall||0)*0.05);  // 성벽 보강
    if(ancientHold) dB+=0.20;
    if(attacker.side==="E") aB+=aiCombatBuff(g);   // AI 지휘관 정예화
    if(defender.side==="E") dB+=aiCombatBuff(g);
    const modsA=mergeMods(attacker.side==="P"?researchMods(g):null,HP_MODS);
    const modsB=mergeMods(defender.side==="P"?researchMods(g):null,HP_MODS);
    const beforeA={...attacker.comp},beforeB={...defender.comp};
    const res=simulate(compArr(attacker),aB,compArr(defender),dB,BATTLE_ROUNDS,modsA,modsB);
    const last=res.frames[res.frames.length-1];
    const rebuild=s=>{const c={};for(const x of last[s])if(x.alive>0)c[x.name]=(c[x.name]||0)+x.alive;return c;};
    const rA=rebuild("A"),rB=rebuild("B");
    const wound=(army,before,after)=>{if(army.side!=="P")return 0;let t=0;for(const u in before){const lost=(before[u]||0)-(after[u]||0);if(lost>0){const w=Math.round(lost*WOUND_RATE);if(w>0){g.castle.wounded[u]=(g.castle.wounded[u]||0)+w;t+=w;}}}return t;};
    const sum={attacker:attacker.name,defender:defender.name,aSide:attacker.side,fort:fort||ancientHold,w:res.w,survA:res.survA,survB:res.survB,
      heroA:aHero?aHero.name:null,heroB:dHero?dHero.name:null,
      buffA:aHero?Math.round(GRADE_BUFF[aHero.grade]*100):0, buffB:dHero?Math.round(GRADE_BUFF[dHero.grade]*100):0,
      gradeA:aHero?aHero.grade:0, gradeB:dHero?dHero.grade:0};
    if(res.w==="A"){ attacker.comp=rA; const wd=wound(attacker,beforeA,rA);
      let rw=""; if(defender.side==="M"&&defender.reward){for(const r in defender.reward)g.res[r]=(g.res[r]||0)+defender.reward[r];rw=" · 보상 "+Object.entries(defender.reward).map(([r,v])=>`${r} +${v}`).join(", ");sum.reward=defender.reward;
        if(defender.mtier&&SUBDUE_REWARD[defender.mtier]){g.subdue=(g.subdue||0)+SUBDUE_REWARD[defender.mtier];sum.subdue=SUBDUE_REWARD[defender.mtier];rw+=` · 토벌점수 +${sum.subdue}`;}
        if(defender.mtier&&XP_REWARD[defender.mtier]){g.xpItems=(g.xpItems||0)+XP_REWARD[defender.mtier];sum.xp=XP_REWARD[defender.mtier];rw+=` · 경험치 +${sum.xp}`;}
        if(defender.mtier&&defender.mtier!=="레이드"){(g.respawns=g.respawns||[]).push(defender.roamer?{random:true,at:g.turn+RESPAWN_DELAY}:{node:node,at:g.turn+RESPAWN_DELAY});}}
      sum.result=`${attacker.name} ${defender.side==="M"?"소탕 성공":"승리"} · ${defender.name} ${defender.side==="M"?"소멸":"전멸"}${rw}`+(wd?` · 부상 ${wd}`:"");
      removeArmy(g,defender); attacker.node=node; }
    else if(res.w==="B"){ defender.comp=rB; const wd=wound(defender,beforeB,rB); sum.result=`${defender.name} 방어 · ${attacker.name} 전멸`+(wd?` · 부상 ${wd}`:""); removeArmy(g,attacker); }
    else { attacker.comp=rA; defender.comp=rB; wound(attacker,beforeA,rA); wound(defender,beforeB,rB); sum.result="무승부 · 양측 생존"; }
    return sum;
  }
  function defendCastle(g,attacker){
    const defComp={...g.castle.garrison}; const pArmies=armiesAt(g,"P").filter(a=>a.side==="P"); let hero=null;
    for(const a of pArmies){for(const u in a.comp)defComp[u]=(defComp[u]||0)+a.comp[u]; if(a.hero&&heroById(g,a.hero)?.type==="전투")hero=a.hero;}
    const defender={side:"P",name:"수도 수비대",comp:defComp,hero};
    const sum=resolveBattle(g,attacker,defender,"P");
    if(sum.w==="B"){ g.castle.garrison={...defender.comp}; for(const a of pArmies){if(a.hero)heroById(g,a.hero).loc="castle";removeArmy(g,a);} }
    else { g.castle.garrison={}; for(const a of pArmies){if(a.hero)heroById(g,a.hero).loc="idle";removeArmy(g,a);} }
    return sum;
  }
  // ---- 비종결 플레이(A3): 정복·레이드·함락이 "게임오버"가 아니라 진행 이벤트. 왕국은 계속된다. ----
  // 정복/함락은 상태(적 본대 유무)를 매틱 재확인하므로 edge-trigger(g._eArmed/_pArmed)로 중복 발동을 막고,
  // 상대가 다시 방비를 갖추면(본대 재건) 재무장해 다음 함락도 이벤트로 잡는다.
  function checkVictory(g){
    const R=g.raid;
    if(R&&R.holder&&R.holdTurns>=R.need){
      const winnerSide=R.holder; let reward=null;
      if(winnerSide==="P"){ reward={철:80,석재:60,식량:60}; for(const r in reward) g.res[r]=(g.res[r]||0)+reward[r]; g.raidWins=(g.raidWins||0)+1; }
      else g.raidLosses=(g.raidLosses||0)+1;
      R.holdTurns=0; R.holder=null; R.cleared=false; if(NODES.ANCIENT) NODES.ANCIENT.owner=null;   // 리셋 → 다시 도전 가능
      return {type:"raid",winner:winnerSide,reward};
    }
    const eDef=armiesAt(g,"E").some(a=>a.side==="E"), pOnE=armiesAt(g,"E").some(a=>a.side==="P");
    if(pOnE&&!eDef){
      if(g._eArmed!==false){
        g._eArmed=false;
        const reward={식량:80,목재:60,철:50,석재:50}; for(const r in reward) g.res[r]=(g.res[r]||0)+reward[r];
        g.conquests=(g.conquests||0)+1;
        g.armies=g.armies.filter(a=>a.side!=="E");   // 적 잔여 세력 정리 — 다음 턴부터 본대 재건
        return {type:"conquest",winner:"P",reward};
      }
    } else if(eDef) g._eArmed=true;
    const pDef=armiesAt(g,"P").some(a=>a.side==="P")||troops({comp:g.castle.garrison})>0, eOnP=armiesAt(g,"P").some(a=>a.side==="E");
    if(eOnP&&!pDef){
      if(g._pArmed!==false){
        g._pArmed=false;
        for(const r of RES) g.res[r]=Math.floor(g.res[r]*0.5);
        g.castle.wall=Math.max(0,(g.castle.wall||0)-2);
        g.defeats=(g.defeats||0)+1;
        g.armies=g.armies.filter(a=>a.side!=="E");   // 침공군 물러남 — 왕국은 재건해 계속
        return {type:"defeat",winner:"E"};
      }
    } else if(pDef) g._pArmed=true;
    return null;
  }
  // 둥지 리스폰: 예약된 재생성이 도래하면 몬스터 재배치(점거 중이면 지연)
  function processRespawns(g){ if(!g.respawns||!g.respawns.length)return; const keep=[];
    for(const r of g.respawns){ if(r.at>g.turn){keep.push(r);continue;}
      if(r.random){ if(MSPAWN)spawnRoamer(g, MSPAWN.pool[Math.floor(Math.random()*MSPAWN.pool.length)]); continue; }  // 랜덤 타일 재등장
      const occ=armiesAt(g,r.node); if(occ.some(a=>a.side==="M"))continue;          // 이미 있음 → 취소
      if(occ.some(a=>a.side!=="M")){keep.push({node:r.node,at:g.turn+2});continue;} // 점거 중 → 지연
      const t=MONSTERS.find(m=>m.node===r.node); if(t)g.armies.push(mkMonster(t)); }
    g.respawns=keep; }
  // 레이드 수성 카운트: 보스 처치 후 ANCIENT를 한 세력이 점거하면 매턴 +1, 비거나 교전 중이면 리셋
  function raidTick(g){ const R=g.raid; if(!R)return;
    if(armiesAt(g,"ANCIENT").some(a=>a.side==="M")){R.holder=null;R.holdTurns=0;return;}
    R.cleared=true;
    const sides=[...new Set(armiesAt(g,"ANCIENT").filter(a=>a.side==="P"||a.side==="E").map(a=>a.side))];
    if(sides.length===1){const s=sides[0];NODES.ANCIENT.owner=s; if(R.holder===s)R.holdTurns++;else{R.holder=s;R.holdTurns=1;}}
    else{R.holder=null;R.holdTurns=0;}
  }
  // ---- 시간 기반 이동 (mp 대체) ----
  // 부대 속도: comp에 존재하는 병종 그룹들의 MOVE_TICKS 단순 평균 → 틱당 진행도(1/틱).
  function armyTicksPerTile(a){ const gs=new Set();
    for(const k in a.comp){ if(a.comp[k]>0){ const grp=UNIT_GROUP[baseOf(k)]; if(grp)gs.add(grp); } }
    if(!gs.size) return MOVE_TICKS.보병;
    let s=0; for(const grp of gs) s+=MOVE_TICKS[grp]; return s/gs.size; }
  function armySpeed(g,a){ let t=armyTicksPerTile(a);
    if(a.side==="P" && hasR(g,"행군술")) t=Math.max(1,t-1);   // 행군술: 통과 1틱 단축(구 이동력+1 재활용)
    return 1/t; }
  // 목적지 지정: 부대가 여러 틱에 걸쳐 스스로 이동. 동일 목적지면 진행도 보존.
  function orderMove(g,armyId,dest){ const a=findArmy(g,armyId); if(!a)return"부대 없음";
    if(dest===a.node){ a.dest=null; a.path=null; a.moveProg=0; return null; }
    if(a.dest===dest && a.path) return null;
    const {dist,prev}=dijkstra(a.node,99); if(dist[dest]===undefined) return"도달 불가";
    a.dest=dest; a.path=pathTo(dest,prev); a.moveProg=0; return null; }
  function stopMove(g,armyId){ const a=findArmy(g,armyId); if(a){a.dest=null;a.path=null;a.moveProg=0;} }
  // 한 칸 진입 + 교전 해결. {battle} 반환.
  function enterTile(g,a,next){ a.node=next; let battle=null;
    if(next==="P"&&a.side==="E") battle=defendCastle(g,a);          // 성 수비: 주둔군 자동 방어
    else { const enemy=armiesAt(g,next).find(x=>x.side!==a.side); if(enemy) battle=resolveBattle(g,a,enemy,next); }
    const event=checkVictory(g); return {battle,event}; }
  // 매 틱: 이동 중인 모든 부대를 speed 만큼 전진(엣지 비용만큼 차면 한 칸). 접촉 시 교전(정지). 마지막 전투/세계이벤트 반환.
  function moveTick(g){ let battle=null, event=null;
    for(const a of [...g.armies]){ if(g.over) break;
      if(!g.armies.includes(a)) continue;                          // 이미 제거됨
      if(!a.dest || a.node===a.dest){ if(a.dest){a.dest=null;a.path=null;} continue; }
      if(!a.path || a.path[0]!==a.node){                           // 경로 재계산(위치 어긋남)
        const {dist,prev}=dijkstra(a.node,99); if(dist[a.dest]===undefined){stopMove(g,a.id);continue;} a.path=pathTo(a.dest,prev); a.moveProg=0; }
      a.moveProg=(a.moveProg||0)+armySpeed(g,a);
      let guard=0;
      while(a.node!==a.dest && guard++<50){
        const idx=a.path.indexOf(a.node), next=a.path[idx+1]; if(!next){stopMove(g,a.id);break;}
        const cost=(ADJ[a.node].find(n=>n.to===next)||{cost:1}).cost;
        if(a.moveProg<cost) break;                                 // 다음 타일 아직 못 감
        a.moveProg-=cost;
        const r=enterTile(g,a,next);
        if(r.event) event=r.event;
        if(r.battle){ battle=r.battle; stopMove(g,a.id); break; }  // 접촉 전투 → 이동 정지
        if(!g.armies.includes(a)) break;                           // 전투로 제거됨
        if(a.node===a.dest){ stopMove(g,a.id); break; }
      }
    }
    return {battle,event}; }

  // ---- 액션 (g 변경, 실패 시 메시지 반환 / 성공 시 null) ----
  const maxTierFor=(g,u)=>{const b=UNIT_BLD[u];return b?(g.castle.blevel[b]||0):0;};
  function produce(g,u,qty,tier){qty=Math.max(1,qty|0);tier=Math.max(1,Math.min(TIER_MAX,tier||1));
    const b=UNIT_BLD[u]; if(!b||!g.castle.buildings.includes(b))return"건물 미건설";
    const lv=g.castle.blevel[b]||1; if(tier>lv)return`${b} Lv.${lv} — T${tier} 생산 불가(레벨업 필요)`;
    const c=costOf(u,tier),tot={};for(const r in c)tot[r]=c[r]*qty;
    if(!canAfford(g,tot))return"자원 부족"; pay(g,tot); const key=uk(u,tier); for(let i=0;i<qty;i++)g.castle.queue.push(key); return null;}
  // ---- 시간 소요 건설(건설잡 1개 동시). 완료 시 효과 적용. 저장 호환(순수 데이터) ----
  const ECON_MAX=6;
  const econCost=(k,lv)=>{const b=ECON_BUILDINGS[k].cost,c={};for(const r in b)c[r]=Math.round(b[r]*(1+lv*0.6));return c;};
  const buildDur=(kind,lv)=>kind==="castle"?4:kind==="wall"?3:kind==="bld"?3:kind==="construct"?3:kind==="univ"?3:kind==="tavern"?2:2+Math.floor((lv||0)/2);
  function startBuild(g,kind,key,cost,dur,label){ if(g.castle.build)return"건설 중 — 한 번에 하나만"; if(!canAfford(g,cost))return"자원 부족"; pay(g,cost); g.castle.build={kind,key:key||null,left:dur,total:dur,label}; return null; }
  function completeBuild(g,j){
    if(j.kind==="castle")g.castle.level++;
    else if(j.kind==="wall")g.castle.wall=(g.castle.wall||0)+1;
    else if(j.kind==="econ")g.castle.econ[j.key]=(g.castle.econ[j.key]||0)+1;
    else if(j.kind==="bld")g.castle.blevel[j.key]=(g.castle.blevel[j.key]||1)+1;
    else if(j.kind==="construct"){g.castle.buildings.push(j.key);g.castle.blevel[j.key]=1;g.castle.openBuilding=j.key;}
    else if(j.kind==="univ")g.castle.buildings.push("대학");
    else if(j.kind==="tavern"){g.tavern.built=true;rollCandidate(g);}
  }
  function construct(g,key){if(g.castle.buildings.includes(key))return null; return startBuild(g,"construct",key,BUILDINGS[key].cost,buildDur("construct"),`${key} 건설`);}
  function upgradeBuilding(g,key){if(!g.castle.buildings.includes(key))return"미건설";
    const lv=g.castle.blevel[key]||1; if(lv>=TIER_MAX)return"최대 레벨"; return startBuild(g,"bld",key,bUpCost(key,lv),buildDur("bld"),`${key} → T${lv+1}`);}
  function fortifyWall(g){return startBuild(g,"wall",null,wallCost(g.castle.wall||0),buildDur("wall"),"성벽 보강");}
  function promoteHero(g,hid){const h=heroById(g,hid); if(!h)return"영웅 없음"; if(h.grade>=3)return"이미 최고 등급"; const c=PROMOTE_COST[h.grade]; if((g.xpItems||0)<c)return"경험치 아이템 부족"; g.xpItems-=c; h.grade++; return null;}
  function levelUp(g){return startBuild(g,"castle",null,CASTLE_UP_COST,buildDur("castle"),"성 레벨업");}
  function buildEcon(g,k){const lv=g.castle.econ[k]||0; if(lv>=ECON_MAX)return"최대 레벨"; return startBuild(g,"econ",k,econCost(k,lv),buildDur("econ",lv),`${k} Lv${lv+1}`);}
  function buildUniversity(g){if(g.castle.buildings.includes("대학"))return null; return startBuild(g,"univ",null,UNIV_COST,buildDur("univ"),"대학 건설");}
  function startResearch(g,k){if(g.research.active)return"이미 연구 중"; const r=RESEARCH[k]; if(g.research.done[k])return null;
    if(!(r.req||[]).every(q=>g.research.done[q]))return"선행 연구 필요"; if(!canAfford(g,r.cost))return"자원 부족";
    pay(g,r.cost); g.research.active={key:k,left:r.turns}; return null;}
  function assignHero(g,hid,loc){heroById(g,hid).loc=loc; return null;}
  const heroEffect=h=>h.type==="전투"?`전투 참전 시 부대 전투력 +${Math.round(GRADE_BUFF[h.grade]*100)}%`
    :`성 배치: 생산 +${h.grade>=3?2:1} · 자원지 배치: 채집 ×${GRADE_GATHER[h.grade]}`;
  // ---- 선술집: 랜덤 후보 등장 → 재화 영입 · ★3은 토벌 점수 특별 영입 ----
  function buildTavern(g){if(g.tavern.built)return null; return startBuild(g,"tavern",null,TAVERN_COST,buildDur("tavern"),"선술집 건설");}
  function rollCandidate(g){if(!g.tavern.built||g.tavern.pool.length>=POOL_CAP)return;
    const type=Math.random()<0.5?"내정":"전투", grade=Math.random()<0.6?1:2;
    const name=HERO_NAMES[Math.floor(Math.random()*HERO_NAMES.length)];
    g.tavern.pool.push({id:newId(g,"H"),name,type,grade}); }
  function tavernTick(g){ if(g.tavern.built && g.turn%TAVERN_GAP===0) rollCandidate(g); }
  function recruitHero(g,cid){const i=g.tavern.pool.findIndex(c=>c.id===cid);if(i<0)return"후보 없음";
    const c=g.tavern.pool[i],cost=RECRUIT_COST[c.grade]; if(!canAfford(g,cost))return"자원 부족";
    pay(g,cost); g.heroes.push({id:c.id,name:c.name,type:c.type,grade:c.grade,loc:"idle"}); g.tavern.pool.splice(i,1); return null;}
  function specialRecruit(g){if(!g.tavern.built)return"선술집 필요";
    if((g.subdue||0)<SPECIAL_COST.토벌)return"토벌 점수 부족";
    const res={식량:SPECIAL_COST.식량,철:SPECIAL_COST.철}; if(!canAfford(g,res))return"자원 부족";
    pay(g,res); g.subdue-=SPECIAL_COST.토벌;
    const type=Math.random()<0.5?"내정":"전투", name=HERO_NAMES[Math.floor(Math.random()*HERO_NAMES.length)];
    g.heroes.push({id:newId(g,"H"),name:name,type,grade:3,loc:"idle"}); return null;}
  function draftAdjust(g,u,d){const gar=g.castle.garrison,draft=g.castle.draft;const avail=gar[u]||0,cur=draft[u]||0,tot=Object.values(draft).reduce((x,y)=>x+y,0);
    if(d>0&&(cur>=avail||tot>=ARMY_CAP))return; const nv=Math.max(0,Math.min(avail,cur+d)); if(nv===0)delete draft[u];else draft[u]=nv;}
  function makeArmyFromDraft(g){const draft=g.castle.draft,comp={};
    for(const u in draft){comp[u]=draft[u];g.castle.garrison[u]-=draft[u];if(g.castle.garrison[u]<=0)delete g.castle.garrison[u];}
    const army={id:newId(g,"P"),side:"P",node:"P",mp:pBaseMp(g),maxMp:pBaseMp(g),name:(g.armies.filter(a=>a.side==="P").length+1)+"군",comp,hero:null,dest:null,moveProg:0};
    g.armies.push(army); g.castle.draft={}; return army;}
  function deploy(g){if(Object.values(g.castle.draft).reduce((x,y)=>x+y,0)<=0)return null; if(!canAddArmy(g))return null; return makeArmyFromDraft(g);}
  // deployTo: 성에서 출전 후 target 방면으로 목적지 지정(부대가 여러 틱에 걸쳐 이동). {army, target} 반환.
  function deployTo(g,target){if(Object.values(g.castle.draft).reduce((x,y)=>x+y,0)<=0||!canAddArmy(g))return{army:null,target:null};
    const army=makeArmyFromDraft(g);
    if(target!=="P") orderMove(g,army.id,target);
    return {army, target:(target!=="P"&&army.dest)?target:null};}
  function disband(g,id){const a=findArmy(g,id);if(!a||a.node!=="P")return"성에서만 귀환 가능";
    for(const u in a.comp)g.castle.garrison[u]=(g.castle.garrison[u]||0)+a.comp[u]; if(a.hero)heroById(g,a.hero).loc="idle"; removeArmy(g,a); return null;}

  // ---- 적 AI ----
  function playerCounterUnit(g){const t={front:0,mid:0,back:0};for(const a of g.armies){if(a.side!=="P")continue;for(const u in a.comp){const bu=baseOf(u);if(UNITS[bu].monster)continue;t[UNITS[bu].row]+=a.comp[u];}}
    if(t.front+t.mid+t.back===0)return null;const mx=["front","mid","back"].reduce((a,b)=>t[a]>=t[b]?a:b);
    return mx==="mid"?"창병":mx==="back"?"경기병":"석궁병";}
  function pickAIUnit(counter){if(counter&&Math.random()<0.65)return counter;const pool=["중갑보병","창병","장궁병","경기병"];return pool[Math.floor(Math.random()*pool.length)];}
  // AI 원정대 목적지: 레이드 처치됐고 E가 점거 못했으면 고대성도 노림(기획: AI도 레이드 도전)
  function pickAITarget(g){const R=g.raid;
    if(R&&R.cleared&&R.holder!=="E"&&Math.random()<0.55)return "ANCIENT"; return "P";}
  // 본대에서 tgt명 뽑아 새 원정대 편성(상성·티어 유지)
  function detach(g,home,tgt,name,role,target){const atk={},keys=Object.keys(home.comp);let moved=0;
    for(const u of keys){if(moved>=tgt)break;const take=Math.min(home.comp[u],tgt-moved);atk[u]=take;home.comp[u]-=take;if(home.comp[u]<=0)delete home.comp[u];moved+=take;}
    const e={id:newId(g,role==="attack"&&target==="ANCIENT"?"ER":"EA"),side:"E",node:"E",mp:4,maxMp:4,name,comp:atk,hero:null,role,target};
    g.armies.push(e); return e;}
  function aiTurn(g){
    g.ai.budget+=AI.budgetPerTurn+Math.min(3,Math.floor(g.turn/14));   // 후반 눈덩이 완화(긴 판 대응)
    let home=g.armies.find(a=>a.side==="E"&&a.node==="E"&&a.role!=="attack");
    if(!home){home={id:newId(g,"EH"),side:"E",node:"E",mp:0,maxMp:0,name:"적 본대",comp:{},hero:null,role:"home"};g.armies.push(home);}
    const cu=playerCounterUnit(g), t=aiTierOf(g); let guard=0;
    while(guard++<60&&troops(home)<AI.homeCap){const u=pickAIUnit(cu),c=AI_UNIT_COST[u]*t;if(g.ai.budget<c)break;g.ai.budget-=c;const key=uk(u,t);home.comp[key]=(home.comp[key]||0)+1;}
    // 동시 원정대 수 제한(§9 부대 수 상한 대칭) — 무한 웨이브 방지
    const waves=g.armies.filter(a=>a.side==="E"&&a.role==="attack").length;
    const bossAlive=armiesAt(g,"ANCIENT").some(a=>a.side==="M");
    const raiding=g.armies.some(a=>a.side==="E"&&a.target==="ANCIENT");
    if(waves<(AI.waveCap||2)){
      if(bossAlive&&!raiding&&troops(home)>=40) detach(g,home,Math.floor(troops(home)*0.7),"적 레이드대","attack","ANCIENT");
      else if(troops(home)>=AI.waveSize) detach(g,home,Math.floor(troops(home)*(AI.waveFrac||0.7)),"적 원정대","attack",pickAITarget(g));
    }
    for(const e of g.armies.filter(a=>a.side==="E"&&a.role==="attack")){ orderMove(g,e.id,e.target||"P"); }   // 목적지만 지정, 이동은 moveTick
    return null;
  }

  // ---- 온보딩 퀘스트 (초반 빌드 가이드 겸 튜토리얼) ----
  // 선형 체인. done(g)=상태를 받는 순수 조건 함수. 달성 시 questTick 이 보상 지급 후 다음 목표로.
  // 데이터는 여기(단일 소스), 표시는 ui.js renderQuests. 시간모델 무관 → 실시간 전환해도 tick 에서 그대로.
  const QUESTS=[
    {id:"farm",  name:"터전 다지기", desc:"🌾 농장을 지어 식량 수입을 늘리자.",                reward:{목재:15},       done:g=>(g.castle.econ["농장"]||0)>=1},
    {id:"gather",name:"첫 채집대",   desc:"⛏ 부대를 자원지(곡창·삼림 등)로 보내 채집을 시작하자.", reward:{목재:15},       done:g=>g.armies.some(a=>a.side==="P"&&NODES[a.node]&&NODES[a.node].type==="resource")},
    {id:"hunt",  name:"첫 사냥",     desc:"⚔ 약한 둥지(늑대·도적)를 소탕해 경험치를 얻자.",       reward:{철:10},         done:g=>(g.xpItems||0)>=1},
    {id:"barr",  name:"병종 확장",   desc:"🏹 궁수대나 마구간을 지어 병종을 늘리자.",             reward:{식량:20},       done:g=>g.castle.buildings.includes("궁수대")||g.castle.buildings.includes("마구간")},
    {id:"univ",  name:"지식의 전당", desc:"🎓 대학을 지어 연구를 해금하자.",                     reward:{목재:10,철:10}, done:g=>g.castle.buildings.includes("대학")},
    {id:"res",   name:"첫 연구",     desc:"🔬 연구를 하나 완료해 부대를 강화하자.",               reward:{철:15},         done:g=>Object.keys(g.research.done||{}).length>=1},
    {id:"hero",  name:"영웅 영입",   desc:"🍺 선술집을 짓고 새 영웅을 영입하자.",                 reward:{식량:25},       done:g=>g.heroes.length>=3},
    {id:"subdue",name:"토벌 원정",   desc:"☠ 강한 둥지(고블린·오크 진지)를 토벌하자.",            reward:{철:20,석재:20}, done:g=>(g.subdue||0)>=1},
  ];
  function questTick(g){
    if(!g.quests) g.quests={done:[],idx:0};
    const completed=[];
    while(g.quests.idx<QUESTS.length){
      const q=QUESTS[g.quests.idx];
      if(!q.done(g)) break;
      g.quests.done.push(q.id);
      if(q.reward) for(const r in q.reward) g.res[r]=(g.res[r]||0)+q.reward[r];
      g.quests.idx++; completed.push(q);
    }
    return completed;
  }

  // ---- 마일스톤 사다리(A2): 국력 문턱마다 보상·해금 → "다음 목표"가 항상 존재. 순차 달성(퀘스트와 같은 패턴). ----
  // need 값은 newGame() 시작 국력(~98, 영웅 2명·성Lv1 기준)보다 충분히 위에서 시작하도록 봇 플레이테스트(하한선)로 보정:
  // 하한선 봇 기준 T20≈150 · T60≈280 · T150+≈450 대까지 성장(§ sim.js). 실제 플레이는 더 빠름.
  const MILESTONES=[
    {id:"m1",name:"개척지",       need:150, reward:{목재:40,석재:20},                              desc:"국력 150 — 왕국의 기틀을 다졌다."},
    {id:"m2",name:"번영하는 영지", need:280, reward:{식량:60,철:30},               unlock:"slot",  desc:"국력 280 — 운용 부대 수 상한 +1."},
    {id:"m3",name:"무장한 왕국",   need:450, reward:{철:50,석재:40},               unlock:"wall",  desc:"국력 450 — 성벽 보강 상한 +1."},
    {id:"m4",name:"지역의 패자",   need:650, reward:{식량:100,목재:80,철:60},                       desc:"국력 650 — 주변에 이름이 알려지다."},
    {id:"m5",name:"왕국의 전설",   need:900, reward:{식량:150,목재:120,석재:100,철:100}, unlock:"slot", desc:"국력 900 — 운용 부대 수 상한 +1 (추가)."},
  ];
  function milestoneTick(g){
    if(!g.milestones) g.milestones={done:[],idx:0,unlocked:[]};
    const completed=[], might=computeMight(g);
    while(g.milestones.idx<MILESTONES.length){
      const m=MILESTONES[g.milestones.idx]; if(might<m.need) break;
      g.milestones.done.push(m.id);
      if(m.reward) for(const r in m.reward) g.res[r]=(g.res[r]||0)+m.reward[r];
      if(m.unlock) g.milestones.unlocked.push(m.unlock);
      g.milestones.idx++; completed.push(m);
    }
    return completed;
  }

  // ---- 턴 종료 (income → 생산 → 연구 → 병원 → AI → mp회복 → turn++ → 승패 → 퀘스트) ----
  function endTurn(g){
    if(g.over)return{enemyBattle:null};
    const inc=income(g); for(const r of RES)g.res[r]+=inc[r];
    g.starving = g.res.식량<0; if(g.starving) g.res.식량=0;   // 식량 고갈 → 이번 턴 생산 중단
    let made=g.starving?0:buildRate(g); while(made>0&&g.castle.queue.length){const u=g.castle.queue.shift();g.castle.garrison[u]=(g.castle.garrison[u]||0)+1;made--;}
    if(g.research.active){g.research.active.left--;if(g.research.active.left<=0){const k=g.research.active.key;g.research.done[k]=true;g.research.active=null;if(k==="행군술")g.armies.forEach(a=>{if(a.side==="P")a.maxMp=pBaseMp(g);});}}
    let built=null;
    if(g.castle.build){g.castle.build.left--;if(g.castle.build.left<=0){built=g.castle.build.label;completeBuild(g,g.castle.build);g.castle.build=null;}}   // 건설 진행
    let heal=(g.castle.econ["병원"]||0)*3;
    for(const u in g.castle.wounded){if(heal<=0)break;const take=Math.min(g.castle.wounded[u],heal);g.castle.wounded[u]-=take;if(g.castle.wounded[u]<=0)delete g.castle.wounded[u];g.castle.garrison[u]=(g.castle.garrison[u]||0)+take;heal-=take;}
    aiTurn(g);                       // AI 생산 + 원정대 목적지 지정
    const mt=moveTick(g);            // 모든 부대(플레이어·AI) 한 틱 이동 + 접촉 전투(+세계이벤트)
    raidTick(g);
    g.turn++; tavernTick(g); processRespawns(g);
    const raidEvent=checkVictory(g);          // 턴 경계 이벤트(레이드 수성 완료 등)
    const worldEvent=mt.event||raidEvent;
    const questsCompleted=questTick(g);
    const msCompleted=milestoneTick(g);
    return {enemyBattle:mt.battle, built, questsCompleted, msCompleted, worldEvent};
  }

  // ---- 오프라인 누적(A4): 실시각 계산은 ui.js 몫(Date.now()) — 여긴 순수하게 "틱 수"만 받아 진행.
  // 전투·AI 원정은 스킵(자리 비운 사이 불공정한 기습 패배 방지), 경제·생산·연구·건설·퀘스트/마일스톤만 진행.
  const OFFLINE_MAX_TICKS=20000;   // 안전 상한(ui의 시간 상한과 별개인 하드 백스톱)
  function offlineStep(g){
    const inc=income(g); for(const r of RES)g.res[r]+=inc[r];
    g.starving=g.res.식량<0; if(g.starving)g.res.식량=0;
    let made=g.starving?0:buildRate(g); while(made>0&&g.castle.queue.length){const u=g.castle.queue.shift();g.castle.garrison[u]=(g.castle.garrison[u]||0)+1;made--;}
    if(g.research.active){g.research.active.left--;if(g.research.active.left<=0){const k=g.research.active.key;g.research.done[k]=true;g.research.active=null;if(k==="행군술")g.armies.forEach(a=>{if(a.side==="P")a.maxMp=pBaseMp(g);});}}
    if(g.castle.build){g.castle.build.left--;if(g.castle.build.left<=0){completeBuild(g,g.castle.build);g.castle.build=null;}}
    let heal=(g.castle.econ["병원"]||0)*3;
    for(const u in g.castle.wounded){if(heal<=0)break;const take=Math.min(g.castle.wounded[u],heal);g.castle.wounded[u]-=take;if(g.castle.wounded[u]<=0)delete g.castle.wounded[u];g.castle.garrison[u]=(g.castle.garrison[u]||0)+take;heal-=take;}
    g.turn++; tavernTick(g); processRespawns(g); questTick(g); milestoneTick(g);
  }
  function offlineTick(g,ticks){ ticks=Math.max(0,Math.min(ticks|0,OFFLINE_MAX_TICKS));
    const t0=g.turn; for(let i=0;i<ticks;i++) offlineStep(g); return {ticks,turns:g.turn-t0}; }

  API={ RES,GATHER_BASE,GATHER_HERO,ARMY_CAP,ECON_CAP,WOUND_RATE,HP_SCALE,UNIT_COST,CASTLE_UP_COST,BUILDINGS,ECON_BUILDINGS,UNIV_COST,GROUPS,STATNAME,AI,AI_UNIT_COST,RESEARCH,NODES,EDGES,ADJ,
    TIER_MAX,TIER_NAME,uk,baseOf,tierOf,unitLabel,costOf,UNIT_BLD,bUpCost,maxTierFor,heroEffect,
    GRADE_BUFF,GRADE_GATHER,HERO_NAMES,TAVERN_COST,TAVERN_GAP,POOL_CAP,RECRUIT_COST,SPECIAL_COST,SUBDUE_REWARD,cityHero,
    ARMY_SLOTS_BASE,pArmyCount,armySlots,armySlotsMax,wallMaxLv,canAddArmy,UPKEEP_RATE,totalTroops,foodUpkeep,XP_REWARD,PROMOTE_COST,wallCost,fortifyWall,promoteHero,
    computeMight,enemyMight,MILESTONES,milestoneTick,offlineTick,
    MONSTERS,RESPAWN_DELAY,mkMonster,setMap,DEFAULT_MAP,ECON_MAX,econCost,buildDur,
    dijkstra,pathTo,newGame,findArmy,armiesAt,heroById,troops,canAfford,hasR,pBaseMp,buildRate,castleBaseIncome,econIncome,gatherOf,income,researchMods,
    compArr,hasCombatHero,resolveBattle,defendCastle,checkVictory,raidTick,
    MOVE_TICKS,UNIT_GROUP,armyTicksPerTile,armySpeed,orderMove,stopMove,enterTile,moveTick,
    produce,construct,upgradeBuilding,levelUp,buildEcon,buildUniversity,startResearch,assignHero,draftAdjust,makeArmyFromDraft,deploy,deployTo,disband,
    buildTavern,rollCandidate,tavernTick,recruitHero,specialRecruit,
    playerCounterUnit,pickAIUnit,aiTurn,endTurn, QUESTS,questTick };
  if(typeof module!=="undefined"&&module.exports) module.exports=API; else global.Game=API;
})(typeof self!=="undefined"?self:this);
