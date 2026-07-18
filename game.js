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
  const GATHER_BASE=6, GATHER_HERO=1.5, ARMY_CAP=30, ECON_CAP=20, WOUND_RATE=0.35;   // ARMY_CAP: 부대당 최대 병력 기본값(성레벨·연구로 확장 — armyCapFor)
  const ARMY_SLOTS_BASE=3;  // 운용 부대 수 상한(§9): 기본 + 성 레벨 + 연구. 총군사력 = 부대수 × ARMY_CAP
  const UPKEEP_RATE=0.2, UPKEEP_FREE=20;  // 식량 유지비: FREE 초과 병력 1당 매턴 소모(대군 소프트 상한). 고갈 시 생산 중단
  const XP_REWARD={사냥:2,토벌:4,레이드:8};      // 몬스터 처치 → 경험치 아이템 (G-D: 승급이 느려 정체 → 상향)
  const PROMOTE_COST={1:2,2:4};                  // ★1→2 : 2, ★2→3 : 4 (경험치 아이템)
  const DRAGON_SCALE_REWARD={사냥:1,토벌:4,레이드:16};   // 몬스터 처치 → 용린(드래곤 전용 육성 자원, C1). G-D: 사냥이 0을 줘 초반 드래곤 정체 → 1+로. 레이드가 크게 줘 고대성 도전과 엮임.
  // 드래곤 단계(퀘스트/마일스톤과 같은 순차 idx 패턴). 알 단계는 buff:0 → 별도 조건문 없이 "전투 참여 못 함"과 동치.
  const DRAGON_STAGES=[
    {id:"egg",  name:"알",     need:0,  buff:0,    desc:"용린을 모아 부화시키자."},
    {id:"hatch",name:"새끼 용", need:20, buff:0.15, desc:"전투 참여 시 버프 +15%"},
    {id:"juv",  name:"어린 용", need:60, buff:0.35, desc:"전투 참여 시 버프 +35%"},
    {id:"adult",name:"성체 용", need:140,buff:0.65, desc:"전투 참여 시 버프 +65%"},
  ];
  // F3(드래곤 트리): 2択 누적 방식을 폐기하고 RESEARCH와 같은 req 체인 4갈래(공격/수비/경제/대몬스터)로 재설계.
  // 스킬 포인트는 단계 상승이 아니라 용린 누적량(dragonTick)에서 지급 — 만렙(성체) 이후에도 트리 성장 가능.
  const DRAGON_SKILLS=[
    {id:"flame1", name:"화염 숨결 I",  cat:"공격",  req:[],        desc:"전투 참여 시 공격 버프 +10%p",atkBonus:0.10},
    {id:"flame2", name:"화염 숨결 II", cat:"공격",  req:["flame1"],desc:"공격 버프 +10%p (누적)",atkBonus:0.10},
    {id:"scale1", name:"비늘 강화 I",  cat:"수비",  req:[],        desc:"전투 참여 시 수비 버프 +10%p",defBonus:0.10},
    {id:"scale2", name:"비늘 강화 II", cat:"수비",  req:["scale1"],desc:"수비 버프 +10%p (누적)",defBonus:0.10},
    {id:"hunter1",name:"괴수 사냥꾼 I", cat:"대몬스터",req:[],        desc:"몬스터 상대 버프 +15%p",vsMonsterBonus:0.15},
    {id:"hunter2",name:"괴수 사냥꾼 II",cat:"대몬스터",req:["hunter1"],desc:"몬스터 상대 버프 +10%p (누적)",vsMonsterBonus:0.10},
    {id:"roar1",  name:"위압의 포효 I", cat:"경제",  req:[],        desc:"습격 세력 규모 -10%",factionReduce:0.10},
    {id:"roar2",  name:"위압의 포효 II",cat:"경제",  req:["roar1"], desc:"습격 세력 규모 -5%p (누적)",factionReduce:0.05},
  ];
  const dragonSkillSum=(g,field)=>((g.dragon&&g.dragon.skills)||[]).reduce((s,id)=>{const sk=DRAGON_SKILLS.find(x=>x.id===id);return s+((sk&&sk[field])||0);},0);

  // ==== F4: 군주(Lord) + 군주 장비 ====================================================
  // 몬스터 처치 → 군주 경험치/재료/설계도(전부 몬스터 티어 기준 — 종류별이 아니라 XP_REWARD 등과 완전히 같은 패턴).
  // G-D(2026-07-18): 실제 플레이 진단 결과 킬당 "+1" 트리클로 군주·드래곤 시스템이 시동조차 안 걸림 → 상향.
  // 자동사냥(G-A)이 킬 빈도를 크게 올리므로 per-kill은 "초라해 보이지 않는" 선까지만, 나머지는 빈도로 해결.
  const LORD_XP_REWARD={사냥:2,토벌:6,레이드:16};
  const MATERIAL_REWARD={사냥:2,토벌:4,레이드:10};
  const BLUEPRINT_REWARD={사냥:1,토벌:2,레이드:4};
  const lordXPNeed=lv=>Math.round(15*Math.pow(1.35,lv-1));
  // 재능 3트리(전투/경제/개발) — RESEARCH와 같은 req 체인이지만 자원 대신 talentPoints 소모, 턴 대기 없이 즉시 적용.
  // 필드는 기존 4개 소비 지점(buildRate/econIncome/foodUpkeep/startResearch)+resolveBattle이 이미 아는 어휘만 사용 — 새 통합 지점 없음.
  const LORD_TALENTS=[
    {id:"lt_war1",name:"결의 I", tree:"전투",req:[],           cost:1,desc:"전군 공격 +5%p",field:"atkBonus",amount:0.05},
    {id:"lt_war2",name:"결의 II",tree:"전투",req:["lt_war1"],  cost:1,desc:"전군 공격 +5%p (누적)",field:"atkBonus",amount:0.05},
    {id:"lt_war3",name:"방벽 I", tree:"전투",req:[],           cost:1,desc:"전군 방어 +5%p",field:"defBonus",amount:0.05},
    {id:"lt_war4",name:"방벽 II",tree:"전투",req:["lt_war3"],  cost:1,desc:"전군 방어 +5%p (누적)",field:"defBonus",amount:0.05},
    {id:"lt_eco1",name:"번영 I", tree:"경제",req:[],           cost:1,desc:"자원 건물 산출 +10%",field:"econBonus",amount:0.10},
    {id:"lt_eco2",name:"번영 II",tree:"경제",req:["lt_eco1"],  cost:1,desc:"자원 건물 산출 +10% (누적)",field:"econBonus",amount:0.10},
    {id:"lt_eco3",name:"긴축 I", tree:"경제",req:[],           cost:1,desc:"식량 유지비 -8%",field:"upkeepReduce",amount:0.08},
    {id:"lt_eco4",name:"긴축 II",tree:"경제",req:["lt_eco3"],  cost:1,desc:"식량 유지비 -8%p (누적)",field:"upkeepReduce",amount:0.08},
    {id:"lt_dev1",name:"건축 I", tree:"개발",req:[],           cost:1,desc:"건설 속도 +1",field:"buildBonus",amount:1},
    {id:"lt_dev2",name:"건축 II",tree:"개발",req:["lt_dev1"],  cost:1,desc:"건설 속도 +1 (누적)",field:"buildBonus",amount:1},
    {id:"lt_dev3",name:"학문 I", tree:"개발",req:[],           cost:1,desc:"연구 소요 턴 -1",field:"researchBonus",amount:1},
    {id:"lt_dev4",name:"학문 II",tree:"개발",req:["lt_dev3"],  cost:1,desc:"연구 소요 턴 -1 (누적)",field:"researchBonus",amount:1},
  ];
  const lordTalentSum=(g,field)=>Object.keys((g.lord&&g.lord.talents)||{}).reduce((s,id)=>{const t=LORD_TALENTS.find(x=>x.id===id);return s+((t&&t.field===field)?t.amount:0);},0);
  // 군주 장비 — 슬롯 4개, 몬스터 처치로 얻은 재료·설계도로 제작 후 강화(1~5강, 아발론 방식: 1-2강 +5%p씩·3-4강 +10%p씩·5강 +20%p, 누적 +50%).
  const EQUIP_SLOTS=["무기","방어구","투구","장신구"];
  const ENHANCE_MULT=[0,0.05,0.10,0.20,0.30,0.50];
  const EQUIPMENT={
    "낡은 검":     {slot:"무기",  tier:1,need:{blueprint:1,material:4},cost:{철:20},         field:"atkBonus",amount:0.08,desc:"공격 +8%p"},
    "용살자의 검":  {slot:"무기",  tier:2,need:{blueprint:2,material:8},cost:{철:45,석재:20},  field:"atkBonus",amount:0.15,desc:"공격 +15%p"},
    "가죽 갑주":   {slot:"방어구", tier:1,need:{blueprint:1,material:4},cost:{목재:20},        field:"defBonus",amount:0.08,desc:"방어 +8%p"},
    "판금 갑주":   {slot:"방어구", tier:2,need:{blueprint:2,material:8},cost:{목재:45,철:20},   field:"defBonus",amount:0.15,desc:"방어 +15%p"},
    "감독관의 투구":{slot:"투구",  tier:1,need:{blueprint:1,material:4},cost:{목재:15,철:10},   field:"buildBonus",amount:1,  desc:"건설 속도 +1"},
    "총사의 투구": {slot:"투구",  tier:2,need:{blueprint:2,material:8},cost:{목재:30,철:25},   field:"buildBonus",amount:2,  desc:"건설 속도 +2"},
    "번영의 인장": {slot:"장신구", tier:1,need:{blueprint:1,material:4},cost:{식량:20,철:10},   field:"econBonus",amount:0.10,desc:"자원 건물 산출 +10%"},
    "왕관의 인장": {slot:"장신구", tier:2,need:{blueprint:2,material:8},cost:{식량:40,철:25},   field:"econBonus",amount:0.20,desc:"자원 건물 산출 +20%"},
  };
  const lordEquipSum=(g,field)=>{ let s=0; const eq=(g.lord&&g.lord.equipment)||{};
    for(const slot in eq){ const itemId=eq[slot]; if(!itemId) continue;
      const it=(g.lordInventory||[]).find(x=>x.id===itemId); if(!it) continue;
      const cat=EQUIPMENT[it.key]; if(!cat||cat.field!==field) continue;
      s+=cat.amount*(1+ENHANCE_MULT[it.enhance||0]); }
    return s; };
  const wallCost=lv=>({석재:25+lv*20,철:5+lv*4}); // 성벽 보강(반복형 석재 소비처) — 수성 방어↑
  const HERO_BUFF=0.20, HP_SCALE=1.0;  // HP 전역 배율. 1.4는 티어테스트 잔재로 삼각(기병>궁병)을 깨뜨려 1.0으로 정정(§7). 1.0=항등 → 실제 전투가 verify.js 검증 조건과 일치.
  // ---- 영웅 등급(★1~3): 등급이 버프 세기 결정 ----
  const GRADE_BUFF={1:0.15,2:0.20,3:0.28}, GRADE_GATHER={1:1.4,2:1.5,3:1.7};
  // 영웅 특성(trait): 등급 승급은 항상 "예"인 무결정이라, 대신 영입 시점에 특성이 붙어 "어느 후보를 뽑을까"가 진짜 결정이 되게 함.
  const HERO_TRAITS={
    전투:[ {id:"assault",  name:"돌격형", desc:"공격 시 버프 +5%p",atkBonus:0.05},
           {id:"guard",    name:"수호형", desc:"수비 시 버프 +8%p",defBonus:0.08},
           {id:"swift",    name:"기동형", desc:"부대 이동 1틱 단축(행군술과 중첩)",moveBonus:1},
           {id:"vsmonster",name:"사냥꾼", desc:"몬스터 상대 버프 +10%p",vsMonsterBonus:0.10},
           {id:"tough",    name:"인내형", desc:"부상 확률 -15%p",woundReduce:0.15} ],
    내정:[ {id:"builder",name:"건축가", desc:"건설 속도 +1",buildBonus:1},
           {id:"scholar",name:"학자",   desc:"연구 시작 시 소요 턴 −1",researchBonus:1},
           {id:"trader", name:"상인",   desc:"채집량 +0.2배",gatherBonus:0.2},
           {id:"overseer",name:"감독관", desc:"자원 건물 산출 +15%",econBonus:0.15},
           {id:"quartermaster",name:"보급관",desc:"식량 유지비 -20%",upkeepReduce:0.20} ],
  };
  // heroTraits: h.traits(배열, 신규)와 h.trait(단일, 구버전 세이브 잔재) 둘 다 허용 — 실제 배열 전환은 applySave에서.
  const heroTraits=h=>{ if(!h) return []; const ids=h.traits||(h.trait?[h.trait]:[]);
    return ids.map(id=>(HERO_TRAITS[h.type]||[]).find(t=>t.id===id)).filter(Boolean); };
  const traitSum=(h,field)=>heroTraits(h).reduce((s,t)=>s+(t[field]||0),0);
  const randomTrait=type=>{const pool=HERO_TRAITS[type]||[]; return pool.length?pool[Math.floor(Math.random()*pool.length)].id:null;};
  // ---- 선술집 · 토벌 점수 ----
  const HERO_NAMES=["기사 아론","현자 밀라","용병 카일","사제 리나","궁정관 세드","기공사 도라","방백 유리","척후장 벤","연금술사 나임","백부장 그렌"];
  const TAVERN_COST={목재:20,석재:15,철:10}, POOL_CAP=3, TAVERN_GAP=3;
  const RECRUIT_COST={1:{식량:30,목재:20},2:{식량:50,목재:35,철:20}};
  const SPECIAL_COST={토벌:15,식량:60,철:40};        // ★3 특별 영입(토벌 점수 소모)
  const SUBDUE_REWARD={토벌:3,레이드:10};             // 토벌·레이드 처치 시 토벌 점수
  const UNIT_COST={중갑보병:{식량:2,목재:2,철:2},창병:{식량:2,목재:3,철:2},장궁병:{식량:1,목재:3,철:1},석궁병:{식량:1,목재:2,철:2},경기병:{식량:4,목재:2,철:3},중기병:{식량:3,목재:1,철:4}};
  // ---- 티어 (T1 기본 · T2 정예 · T3 상급). 스탯 배율은 engine.tierMult, 여기선 비용/키 관리 ----
  // TIER_MAX=5는 절대 상한(플레이어). T4·T5는 마일스톤 해금 전엔 tierCap(g)이 3으로 묶어 못 올림(병종 정체 해소).
  // AI는 별도 AI_TIER_MAX=3으로 고정 — 마일스톤 해금과 무관하게 턴 기반 성장만 함(플레이어 해금 전에 AI가 T5를 먼저 찍는 불균형 방지).
  const TIER_MAX=5, AI_TIER_MAX=3, TIER_NAME={1:"기본",2:"정예",3:"상급",4:"전설",5:"신화"};
  // 유닛 훈련 소요(buildRate 1 기준 틱). 고티어일수록 오래 걸림 → 병력 폭증·식량 급감 완화, 고티어가 진짜 투자가 됨.
  const TRAIN_TICKS={1:2,2:4,3:7,4:11,5:16};
  // 복합 키: T1은 순수 이름, T2+는 "이름@T2" (기존 저장구조 하위호환)
  const uk=(name,tier)=>(tier&&tier>1)?name+"@T"+tier:name;
  const baseOf=k=>{const i=k.indexOf("@T");return i<0?k:k.slice(0,i);};
  const tierOf=k=>{const i=k.indexOf("@T");return i<0?1:(+k.slice(i+2)||1);};
  const unitLabel=k=>{const t=tierOf(k);return t>1?baseOf(k)+" T"+t:baseOf(k);};
  // 고티어 = 비용↑, 특히 철(기획서: 고티어 철 병목). T2 ×1.6, T3 ×2.4 + 티어당 철 추가
  function costOf(name,tier){tier=tier||1;const base=UNIT_COST[name],mul=1+0.6*(tier-1),c={};
    for(const r in base)c[r]=Math.round(base[r]*mul);c.철=(c.철||0)+2*(tier-1);return c;}
  const CASTLE_UP_COST={목재:20,석재:15,철:10};
  const SIEGE_COST={목재:30,철:40};   // 파성추(C3) — 신규 유닛 아닌 소모성 제작품. 공성 시 성벽 보정을 추가로 완화(엔진 밸런스 무영향).
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
  // 유저 피드백: "적이 초반부터 너무 많이 쳐들어온다"(실시간 2x/4x면 30턴이 순식간). 초반 유예(graceTurns) 동안은
  // 예산을 낮추고(graceBudget) 본대 비축을 waveSize로 제한해 첫 웨이브가 늦게·과대화 없이 오게 하고, waveGap으로 웨이브 간 최소 간격을 둠.
  const AI={budgetPerTurn:5,waveSize:38,homeCap:70,tierEvery:16,waveCap:2,waveFrac:0.85,graceTurns:30,graceBudget:2,waveGap:16}, AI_UNIT_COST={중갑보병:3,창병:3,장궁병:2,석궁병:3,경기병:4,중기병:5};
  // 시즌형 침공(B2): N턴마다 예고→도래하는 대규모 원정대. 도래마다 간격이 줄고(escalating) 규모가 커짐(횟수·국력 둘 다 반영).
  const SEASON_INTERVAL=60, SEASON_MIN_INTERVAL=30, SEASON_WARN_LEAD=12, SEASON_BASE=30, SEASON_GROWTH=0.35;
  // 다수 세력(B1, 성 없는 방식): 자기 성·영토 없이 야생 타일에서 등장해 독자적 주기로 습격하는 독립 세력들.
  // side는 여전히 "E"(정복/함락 판정을 그대로 재사용) — 이름·병종 편향·주기로만 서로 다른 위협처럼 느껴지게 함.
  // 주기(interval): 유저 피드백 "적 공격이 정신없이 계속 들어온다" → 3세력+시즌+AI원정대가 겹쳐 쏟아지던 걸 완화하려 주기를 크게 늘림(45/65/50 → 72/96/80).
  const FACTIONS=[
    {id:"raider",   name:"도적단",   units:["경기병","중기병"],interval:72,base:12,growth:0.22},
    {id:"horde",    name:"오크 군세", units:["중갑보병","창병"],interval:96,base:15,growth:0.25},
    // prey형: 성이 아니라 야외에 나가있는 아군 부대(채집대 등)를 노림 — "그냥 다 성으로 몰려온다"는 반복감을 깨고,
    // 채집·원정 나간 부대를 방치하면 위험하다는 새로운 판단(호위/철수)을 만듦.
    {id:"nightraid",name:"야습대",   units:["장궁병","석궁병"],interval:80,base:10,growth:0.2,prey:true},
  ];
  // 라이벌 왕국(I1, 끝없는 경쟁): 풀 맵 도시 없이 "국력이 자라는 추상 세력". side는 여전히 "E"(웨이브에 정체성 라벨만 얹음).
  // 각 라이벌은 플레이어 국력의 배수(factor)를 목표로 서서히 수렴 → 항상 경쟁권 유지(오프라인 폭주 없음). factor>1은 방치 시 추월.
  // 라이벌 원정대를 꺾으면 might가 깎여 순위↑(damageRival, I2), 방치하면 다시 목표로 회복.
  const RIVALS=[
    {id:"ironclad",  name:"강철왕 발트",   bias:"보병", factor:0.85, base:80},
    {id:"emberhold", name:"화염군주 카산", bias:"기병", factor:1.25, base:120},
    {id:"veilspire", name:"안개탑 셀레네", bias:"궁병", factor:0.70, base:60},
    {id:"frostqueen",name:"서리여왕 리안", bias:"혼합", factor:1.05, base:100},
  ];
  let threatMul=g=>1;   // 위협 등반 계수(I4에서 시즌 회차·랭크 기반으로 확장). I1~I3에선 1(무영향).
  // 경쟁 시즌(I3): 대침공 스케줄러 g.season과 별개. 성과 점수→티어→보상, 소프트리셋 후 새 시즌(비종결).
  const RANK_SEASON_LEN=180, RANK_SOFTRESET=0.35, THREAT_CAP=1.5;
  const RANK_TIERS=[
    {id:"bronze", name:"브론즈",   min:0},   {id:"silver", name:"실버",     min:120},
    {id:"gold",   name:"골드",     min:280}, {id:"plat",   name:"플래티넘", min:480},
    {id:"diamond",name:"다이아",   min:720}, {id:"legend", name:"전설",     min:1050},
  ];
  const tierForScore=s=>{ let t=RANK_TIERS[0]; for(const x of RANK_TIERS) if(s>=x.min) t=x; return t; };
  const rankTierIndex=g=>RANK_TIERS.findIndex(x=>x.id===tierForScore((g.rankSeason&&g.rankSeason.score)||0).id);
  const rankTierReward=idx=>{ const m=idx+1; return {식량:60*m, 철:35*m, 목재:35*m, 재료:2*m, 설계도:idx}; };
  function addSeasonScore(g,amt){ if(g.rankSeason&&amt>0) g.rankSeason.score=(g.rankSeason.score||0)+amt; }
  // I4: 위협 등반 계수 — 시즌 회차 위주 + 랭크 티어 소액 가중 + 상한(폭주·sim붕괴 방지). seasonTick/factionTick/rivalTick need에 곱해짐.
  threatMul=g=>{ const sn=(g.rankSeason&&g.rankSeason.num)||1, ti=Math.max(0,rankTierIndex(g)); return Math.min(THREAT_CAP, 1 + 0.06*(sn-1) + 0.03*ti); };

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
  // E4(연구 트리 갈림길): 병종별 공+수 II를 다 마치면 "결전(공+20%)" vs "철벽(방+20%)" 중 하나만 선택(상호 배타) —
  // 기존 mod/mul 파이프라인(researchMods) 그대로 재사용, excludes 필드 하나만 추가해 startResearch에서 차단.
  (function(){ for(const g in GROUPS){
    const atk2=`${g} ${STATNAME.atk} II`, df2=`${g} ${STATNAME.df} II`;
    const kAtk=`${g} 특화: 결전`, kDef=`${g} 특화: 철벽`;
    RESEARCH[kAtk]={cat:"전투",sub:g,req:[atk2,df2],excludes:[kDef],cost:{목재:35,철:45},turns:4,desc:`${g} 공격 +20% (철벽과 양자택일)`,mod:{group:g,stat:"atk",mul:1.20}};
    RESEARCH[kDef]={cat:"전투",sub:g,req:[atk2,df2],excludes:[kAtk],cost:{목재:35,철:45},turns:4,desc:`${g} 방어 +20% (결전과 양자택일)`,mod:{group:g,stat:"df",mul:1.20}};
  } })();
  // F5(연구 다양화): 내정 5종 중 채굴법만 2티어였던 걸 나머지도 맞춤 — 기존 키 이름을 안 바꾸고(리네임 시
  // hasR(g,"영농") 등 호출부 누락 위험이 커 E5에서 겪은 것과 같은 조용한 버그가 남) "영농 II"를 새로 얹어
  // 원 키(hasR(g,"영농"))는 그대로 두고 II만 있으면 보너스가 추가로 붙도록 소비 지점에서 개별 가산한다.
  RESEARCH["영농 II"]={cat:"내정",sub:"경제",req:["영농"],cost:{식량:25,목재:25},turns:3,desc:"자원 건물 수입 추가 +25%p"};
  RESEARCH["대장간 II"]={cat:"내정",sub:"경제",req:["대장간"],cost:{목재:25,철:30},turns:3,desc:"병력 생산 속도 +1 (누적)"};
  RESEARCH["행군술 II"]={cat:"내정",sub:"경제",req:["행군술"],cost:{식량:25,철:25},turns:3,desc:"모든 부대 이동력 +1 (누적)"};
  // 행군 편제 — 부대 1개당 최대 병력(ARMY_CAP) 확장. draftAdjust의 상한 체크에서 소비.
  RESEARCH["행군 편제 I"]={cat:"내정",sub:"행군",req:[],cost:{식량:20,목재:20,철:15},turns:3,desc:"부대당 최대 병력 +10"};
  RESEARCH["행군 편제 II"]={cat:"내정",sub:"행군",req:["행군 편제 I"],cost:{식량:30,목재:30,철:25},turns:4,desc:"부대당 최대 병력 +10 (누적)"};
  // 드래곤 연구 — 드래곤 스킬(선택형)과 별개로 드래곤 자체 스탯을 영구 강화. group 소속이 아니라 dragonMod로 격리.
  RESEARCH["용의 힘 I"]={cat:"전투",sub:"드래곤",req:[],cost:{철:30,석재:20},turns:3,desc:"드래곤 전투 참여 시 공격 +10%p",dragonMod:{stat:"atk",amount:0.10}};
  RESEARCH["용의 힘 II"]={cat:"전투",sub:"드래곤",req:["용의 힘 I"],cost:{철:45,석재:30},turns:4,desc:"드래곤 공격 +10%p (누적)",dragonMod:{stat:"atk",amount:0.10}};
  RESEARCH["용의 비늘 I"]={cat:"전투",sub:"드래곤",req:[],cost:{철:20,석재:30},turns:3,desc:"드래곤 전투 참여 시 방어 +10%p",dragonMod:{stat:"def",amount:0.10}};
  RESEARCH["용의 비늘 II"]={cat:"전투",sub:"드래곤",req:["용의 비늘 I"],cost:{철:30,석재:45},turns:4,desc:"드래곤 방어 +10%p (누적)",dragonMod:{stat:"def",amount:0.10}};
  // dragonMod 항목 전용 합산 헬퍼 — researchMods(group 기반)와 별개 소형 함수로 격리해 기존 로직을 안 건드림.
  function dragonResearchSum(g,field){ let s=0;
    for(const k in RESEARCH){ const r=RESEARCH[k]; if(r.dragonMod && r.dragonMod.stat===field && g.research.done[k]) s+=r.dragonMod.amount; }
    return s; }
  // 부대당 최대 병력: 기본 30 + 성 레벨당 +5(성이 크면 대군 운용 — "왕국이 자라면 부대도 커진다") + 행군 편제 연구 +10/+10.
  const armyCapFor=g=>ARMY_CAP+((g.castle.level||1)-1)*5+(hasR(g,"행군 편제 I")?10:0)+(hasR(g,"행군 편제 II")?10:0);

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
    const a={id:"MON"+(g._nid++),side:"M",node,mp:0,maxMp:0,name:tmpl.name,mtier:tmpl.mtier,comp:scaleComp(tmpl.comp,monsterScale(g)),hero:null,reward:{...tmpl.reward},roamer:true};
    g.armies.push(a); return a;}
  function dijkstra(start,maxCost){const dist={[start]:0},prev={},pq=[[0,start]];
    while(pq.length){pq.sort((x,y)=>x[0]-y[0]);const[d,u]=pq.shift();if(d>dist[u])continue;
      for(const{to,cost}of ADJ[u]){const nd=d+cost;if(nd<=maxCost&&(dist[to]===undefined||nd<dist[to])){dist[to]=nd;prev[to]=u;pq.push([nd,to]);}}}
    return{dist,prev};}
  function pathTo(t,prev){const p=[t];let c=t;while(prev[c]!==undefined){c=prev[c];p.unshift(c);}return p;}
  // 스케일링 PvE(B4): 몬스터 병력 수를 국력에 따라 증폭. engine.js 전투 수치는 무변경 — comp 카운트만 조정.
  const scaleComp=(comp,mult)=>{const c={};for(const k in comp)c[k]=Math.max(1,Math.round(comp[k]*mult));return c;};
  const monsterScale=g=>Math.min(3, 1+Math.max(0, computeMight(g)-100)/400);   // 국력100↓ 1.0배 · 국력900 3.0배 상한
  const mkMonster=(t,g,extraMult)=>({id:"MON_"+t.node,side:"M",node:t.node,mp:0,maxMp:0,name:t.name,mtier:t.mtier,
    comp:scaleComp(t.comp, (g?monsterScale(g):1)*(extraMult||1)), hero:null,reward:{...t.reward}});
  // ANCIENT 몬스터 템플릿: 타일맵(MSPAWN.raid)·노드맵(MONSTERS 배열) 양쪽 다 지원 — 월드 보스 재등장(B4)이 맵 종류와 무관하게 동작하도록.
  const ancientTemplate=()=>{ if(MSPAWN&&MSPAWN.raid) return {node:"ANCIENT",...MSPAWN.raid}; return MONSTERS.find(m=>m.node==="ANCIENT")||null; };

  // ---- 상태 ----
  function _baseGame(){ if(NODES.ANCIENT)NODES.ANCIENT.owner=null; return {
    turn:1, res:{식량:45,목재:45,석재:25,철:25},
    castle:{level:1,queue:{},autoProduce:{},trainProg:{},buildings:["병영"],blevel:{병영:1},openBuilding:"병영",garrison:{중갑보병:5,창병:5,경기병:6},draft:{},econ:{},wounded:{},wall:0,build:null,siegeItems:0},
    research:{done:{},active:null,tab:"전투"}, ai:{budget:0,lastWave:-99},
    raid:{need:4,holder:null,holdTurns:0,cleared:false,settled:false}, subdue:0, xpItems:0, tavern:{built:false,pool:[]}, respawns:[],
    quests:{done:[],idx:0},   // 온보딩 퀘스트 진행(선형 체인 인덱스)
    milestones:{done:[],idx:0,unlocked:[]},   // 마일스톤 진행(A2)
    conquests:0, defeats:0, raidWins:0, raidLosses:0,   // 지속형 왕국 지표(A3) — 게임오버 대신 누적 기록
    raidBossGen:0,   // 월드 보스(레이드) 재등장 세대(B4) — 재등장할 때마다 +1, 그만큼 강화
    season:{count:1,next:SEASON_INTERVAL,warnAt:SEASON_INTERVAL-SEASON_WARN_LEAD,warned:false},   // 시즌형 침공(B2)
    factions:FACTIONS.map(f=>({id:f.id,count:1,next:f.interval})),   // 다수 세력(B1)
    rivals:RIVALS.map(r=>({id:r.id,might:r.base})), rivalKills:0,   // 라이벌 왕국(I1) — 국력이 자라는 경쟁 세력, 격파 누적
    rankSeason:{num:1,next:1+RANK_SEASON_LEN,score:0,bestRank:99,tierHist:[]},   // 경쟁 시즌(I3)
    pendingPromote:null,   // 영웅 승급 특성 선택 대기(C2)
    dragon:{stage:0,skills:[],skillPoints:0,scaleSpent:0}, dragonScale:0,   // 드래곤(C1) — 게임 시작부터 알 보유(별도 획득 이벤트 없음). F3: 스킬은 req 트리+skillPoints로 획득(2択 폐기)
    lord:{level:1,xp:0,talentPoints:0,talents:{},equipment:{}}, lordInventory:[], materials:0, blueprints:0,   // 군주(F4) — 몬스터 처치로 성장, 재능 트리+장비
    heroes:[{id:"H1",name:"재상 로한",type:"내정",grade:2,loc:"idle"},{id:"H2",name:"장군 카이",type:"전투",grade:2,loc:"idle"}],
    armies:[
      {id:"E1",side:"E",node:"E",mp:0,maxMp:0,name:"적 1군",comp:{중기병:8},hero:null,role:"home"},
    ], over:false, winner:null, _nid:1000 };
  }
  function newGame(){ const g=_baseGame();
    if(MSPAWN){ for(let i=0;i<(MSPAWN.count||4);i++) spawnRoamer(g, MSPAWN.pool[i%MSPAWN.pool.length]);
      if(MSPAWN.raid && NODES.ANCIENT) g.armies.push(mkMonster({node:"ANCIENT",...MSPAWN.raid},g)); }
    else for(const m of MONSTERS) g.armies.push(mkMonster(m,g));
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
  const pBaseMp=g=>5+(hasR(g,"행군술")?1:0)+(hasR(g,"행군술 II")?1:0);   // 확장 맵 대응(회랑 P→E≈7)
  const cityHero=g=>g.heroes.find(h=>h.type==="내정"&&h.loc==="castle");
  // F2(영웅 위원회): "성 배치"가 1명 전용이던 걸 슬롯 N개로 일반화 — 내정형만, 마일스톤(m3)로 3번째 자리 해금.
  const cityHeroes=g=>g.heroes.filter(h=>h.type==="내정"&&h.loc==="castle");
  const councilSlots=g=>2+unlockCount(g,"council",1);
  const councilGradeSum=g=>cityHeroes(g).reduce((s,h)=>s+(h.grade>=3?2:1),0);
  const councilSum=(g,field)=>cityHeroes(g).reduce((s,h)=>s+traitSum(h,field),0);
  const buildRate=g=>1+(g.castle.level-1)+councilGradeSum(g)+(hasR(g,"대장간")?1:0)+(hasR(g,"대장간 II")?1:0)+councilSum(g,"buildBonus")+lordTalentSum(g,"buildBonus")+lordEquipSum(g,"buildBonus");
  const aiTierOf=g=>Math.min(AI_TIER_MAX,1+Math.floor(g.turn/(AI.tierEvery||14)));   // AI 티어 성장(플레이어 T4/T5 해금과 무관)
  const tierCap=g=>{const u=milestoneUnlocks(g); if(u.includes("tier5"))return 5; if(u.includes("tier4"))return 4; return 3;};   // 생산 건물이 오를 수 있는 실제 상한(마일스톤 해금 게이트)
  const aiCombatBuff=g=>0.06+0.03*(aiTierOf(g)-1);                                // AI 지휘관 정예화(영웅 대칭)
  const castleBaseIncome=g=>({식량:3+g.castle.level,목재:2+g.castle.level,석재:1+g.castle.level,철:g.castle.level+2});
  function econIncome(g){const inc={식량:0,목재:0,석재:0,철:0};
    const mult=((hasR(g,"영농")?1.5:1)+(hasR(g,"영농 II")?0.25:0))*(1+councilSum(g,"econBonus")+lordTalentSum(g,"econBonus")+lordEquipSum(g,"econBonus"));   // 감독관 특성+군주(위원회/재능/장비 전부 합산)
    for(const k in ECON_BUILDINGS){const b=ECON_BUILDINGS[k],n=g.castle.econ[k]||0;if(b.res&&n)inc[b.res]+=Math.round(b.amt*n*mult);}return inc;}
  function gatherOf(g,a){const n=NODES[a.node];if(a.side!=="P"||n.type!=="resource")return null;
    const hero=a.hero&&heroById(g,a.hero); const isCity=hero&&hero.type==="내정";
    const base=GATHER_BASE+(hasR(g,"채굴법")?2:0)+(hasR(g,"정밀 채굴")?2:0);
    const mult=isCity?GRADE_GATHER[hero.grade]+traitSum(hero,"gatherBonus"):1;
    return {res:n.res,amt:Math.round(base*mult)};}
  // 총 병력(주둔군 + 아군 부대) → 식량 유지비
  const totalTroops=g=>Object.values(g.castle.garrison).reduce((x,y)=>x+y,0)+g.armies.filter(a=>a.side==="P").reduce((x,a)=>x+troops(a),0);
  const foodUpkeep=g=>{const rate=Math.max(0,UPKEEP_RATE*(1-councilSum(g,"upkeepReduce")-lordTalentSum(g,"upkeepReduce")-lordEquipSum(g,"upkeepReduce")));   // 보급관 특성+군주 재능/장비: 유지비 완화(전부 합산)
    return Math.ceil(Math.max(0,totalTroops(g)-UPKEEP_FREE)*rate);};
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

  // ---- 대륙 랭킹(I1): 플레이어 국력 vs 라이벌 국력 정렬 → 순위 ----
  function rivalTick(g){ if(!g.rivals) return; const pm=computeMight(g), tm=threatMul(g);
    for(const r of g.rivals){ const t=RIVALS.find(x=>x.id===r.id); if(!t)continue;
      const target=Math.max(t.base, pm*t.factor)*tm;   // 플레이어 국력의 배수를 목표로 수렴 → 항상 경쟁권(오프라인 폭주 없음)
      r.might+=(target-r.might)*0.02;   // 느린 접근(반감기 ~35틱): 격파로 깎이면 서서히 회복, 방치 시 목표까지 성장
    } }
  function continentalRankings(g){ const list=[{name:"내 왕국",might:computeMight(g),me:true}];
    if(g.rivals) for(const r of g.rivals){ const t=RIVALS.find(x=>x.id===r.id); list.push({id:r.id,name:t?t.name:r.id,bias:t&&t.bias,might:Math.round(r.might)}); }
    list.sort((a,b)=>b.might-a.might); return list; }
  const myRank=g=>continentalRankings(g).findIndex(x=>x.me)+1;
  // I2: 웨이브 정체성 + 격파→순위. 강한 라이벌일수록 자주 공격, 그 원정대를 꺾으면 해당 라이벌 국력이 깎여 순위↑.
  const RIVAL_HIT=1.0;   // 격파한 웨이브 병력 1당 라이벌 국력 감소량
  const rivalName=rid=>{const t=RIVALS.find(x=>x.id===rid);return t?t.name:null;};
  function pickAggressorRival(g){ if(!g.rivals||!g.rivals.length) return null;
    const ranked=[...g.rivals].sort((a,b)=>b.might-a.might);
    const pool=ranked.slice(0, Math.max(1,Math.ceil(ranked.length/2)));   // 상위 절반(강한 라이벌)에서 선택
    return pool[Math.floor(Math.random()*pool.length)].id; }
  function damageRival(g,rid,amount){ if(!g.rivals) return null; const r=g.rivals.find(x=>x.id===rid); if(!r) return null;
    const dmg=amount*RIVAL_HIT; r.might=Math.max(0, r.might-dmg); g.rivalKills=(g.rivalKills||0)+1;
    addSeasonScore(g,25);   // I3: 라이벌 격파는 핵심 경쟁 행위 → 고배점
    return {name:rivalName(rid)||rid, amount:Math.round(dmg)}; }
  // I3: 경쟁 시즌 마감 — 순차 tick 패턴. turn>=next면 점수→티어→보상→소프트리셋→새 시즌. over 절대 안 켬(비종결).
  function rankSeasonTick(g){ const rs=g.rankSeason; if(!rs) return null;
    rs.bestRank=Math.min(rs.bestRank||99, myRank(g));   // 시즌 중 최고 순위 기록
    if(g.turn < rs.next) return null;
    const tier=tierForScore(rs.score||0), idx=RANK_TIERS.findIndex(x=>x.id===tier.id), reward=rankTierReward(idx);
    for(const r in reward){ if(RES.includes(r)) g.res[r]=(g.res[r]||0)+reward[r]; }
    if(reward.재료) g.materials=(g.materials||0)+reward.재료;
    if(reward.설계도) g.blueprints=(g.blueprints||0)+reward.설계도;
    const ev={type:"seasonEnd", num:rs.num, tier, score:Math.round(rs.score||0), bestRank:rs.bestRank, reward};
    rs.tierHist=rs.tierHist||[]; rs.tierHist.push(tier.id);
    rs.score=Math.floor((rs.score||0)*RANK_SOFTRESET); rs.num++; rs.next=g.turn+RANK_SEASON_LEN; rs.bestRank=99;   // 소프트리셋+다음 시즌(난도는 I4 threatMul가 회차 따라 상승)
    return ev; }

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
  // G-D: P가 적(E) 위협군(습격대·시즌침공·원정대)을 격파하면 병력 규모 비례 보상 — 방어/야전 승리가 남는 장사가 되게.
  // (적 수도 정복은 checkVictory가 별도 처리 — 여긴 야전 격파/수성 승리만.)
  function threatKillReward(g,foe,sum){ const n=troops(foe); if(n<=0) return "";
    const rw={식량:n, 철:Math.round(n*0.6), 목재:Math.round(n*0.4)};
    for(const r in rw) g.res[r]=(g.res[r]||0)+rw[r];
    const xp=Math.max(1,Math.floor(n/8)); g.xpItems=(g.xpItems||0)+xp; g.lord.xp=(g.lord.xp||0)+xp;
    addSeasonScore(g, Math.max(2,Math.floor(n/2)));   // I3: 위협군 격파/방어 승리 → 시즌 점수(규모 비례)
    sum.threatReward={...rw, 경험치:xp, 군주경험치:xp};
    return ` · 격퇴 보상 ${Object.entries(rw).map(([r,v])=>`${r}+${v}`).join(" ")} · 경험치+${xp} · 군주경험치+${xp}`; }
  // 몬스터 처치 보상 — resolveBattle(온라인)·offlineStep(오프라인 사냥) 공용. rw 문자열 반환, sum에 세부 기록.
  function grantMonsterReward(g,defender,node,sum){ let rw="";
    if(!(defender.side==="M"&&defender.reward)) return rw;
    for(const r in defender.reward)g.res[r]=(g.res[r]||0)+defender.reward[r];
    rw=" · 보상 "+Object.entries(defender.reward).map(([r,v])=>`${r} +${v}`).join(", ");sum.reward=defender.reward;
    const mt=defender.mtier;
    if(mt&&SUBDUE_REWARD[mt]){g.subdue=(g.subdue||0)+SUBDUE_REWARD[mt];sum.subdue=SUBDUE_REWARD[mt];rw+=` · 토벌점수 +${sum.subdue}`;}
    if(mt&&XP_REWARD[mt]){g.xpItems=(g.xpItems||0)+XP_REWARD[mt];sum.xp=XP_REWARD[mt];rw+=` · 경험치 +${sum.xp}`;}
    if(mt&&DRAGON_SCALE_REWARD[mt]){g.dragonScale=(g.dragonScale||0)+DRAGON_SCALE_REWARD[mt];sum.dragonScale=DRAGON_SCALE_REWARD[mt];rw+=` · 용린 +${sum.dragonScale}`;}
    if(mt&&LORD_XP_REWARD[mt]){g.lord.xp=(g.lord.xp||0)+LORD_XP_REWARD[mt];sum.lordXp=LORD_XP_REWARD[mt];rw+=` · 군주 경험치 +${sum.lordXp}`;}
    if(mt&&MATERIAL_REWARD[mt]){g.materials=(g.materials||0)+MATERIAL_REWARD[mt];sum.materials=MATERIAL_REWARD[mt];rw+=` · 재료 +${sum.materials}`;}
    if(mt&&BLUEPRINT_REWARD[mt]){g.blueprints=(g.blueprints||0)+BLUEPRINT_REWARD[mt];sum.blueprints=BLUEPRINT_REWARD[mt];rw+=` · 설계도 +${sum.blueprints}`;}
    addSeasonScore(g,{사냥:1,토벌:3,레이드:10}[mt]||0);   // I3: 몬스터 처치도 시즌 점수 소액 기여
    if(mt&&mt!=="레이드"){(g.respawns=g.respawns||[]).push(defender.roamer?{random:true,at:g.turn+RESPAWN_DELAY}:{node:node,at:g.turn+RESPAWN_DELAY});}
    else if(mt==="레이드"){ g.raidBossGen=(g.raidBossGen||0)+1; (g.respawns=g.respawns||[]).push({ancient:true,at:g.turn+RESPAWN_DELAY*3}); }
    return rw; }
  function resolveBattle(g,attacker,defender,node){
    const fort=NODES[node].type==="castle"&&NODES[node].owner===defender.side;
    const ancientHold=node==="ANCIENT"&&NODES.ANCIENT.owner===defender.side; // 고대성 방어 보정
    // 월드 보스 격노(E2): 재등장한 보스(raidBossGen>0)는 전투 시작과 동시에 선제 강타 — 세대당 8%(최대 30%),
    // 매번 같은 물량으로 zerg하는 걸 막아 "재도전은 더 준비해서 와야 한다"는 압박을 줌.
    let enrageLoss=0;
    if(defender.mtier==="레이드" && (g.raidBossGen||0)>0){
      enrageLoss=Math.min(0.30, 0.08*g.raidBossGen);
      for(const k in attacker.comp) attacker.comp[k]=Math.max(0,Math.round(attacker.comp[k]*(1-enrageLoss)));
    }
    const aHero=hasCombatHero(g,attacker)?heroById(g,attacker.hero):null;
    const dHero=hasCombatHero(g,defender)?heroById(g,defender.hero):null;
    let aB=(aHero?GRADE_BUFF[aHero.grade]+traitSum(aHero,"atkBonus"):0)+lordTalentSum(g,"atkBonus")+lordEquipSum(g,"atkBonus"),
        dB=(dHero?GRADE_BUFF[dHero.grade]+traitSum(dHero,"defBonus"):0)+lordTalentSum(g,"defBonus")+lordEquipSum(g,"defBonus");   // 군주(F4): 부대 지정 없이 항상 가산
    if(defender.side==="M") aB+=traitSum(aHero,"vsMonsterBonus");   // 사냥꾼 특성: 몬스터 상대 추가 버프
    if(attacker.side==="M") dB+=traitSum(dHero,"vsMonsterBonus");
    const dragonStageBuff=DRAGON_STAGES[(g.dragon&&g.dragon.stage)||0].buff;   // 드래곤(C1) — 영웅과 별개로 가산, 알 단계는 0이라 자동 무효
    if(attacker.dragon){ aB+=dragonStageBuff+dragonSkillSum(g,"atkBonus")+dragonResearchSum(g,"atk"); if(defender.side==="M") aB+=dragonSkillSum(g,"vsMonsterBonus"); }
    if(defender.dragon) dB+=dragonStageBuff+dragonSkillSum(g,"defBonus")+dragonResearchSum(g,"def");
    let siegeUsed=false;
    if(fort){ let fortDef=(attacker.side==="P"&&hasR(g,"공성술"))?0.05:0.22;
      if(attacker.side==="P" && (g.castle.siegeItems||0)>0){ g.castle.siegeItems--; fortDef=Math.max(0,fortDef-0.10); siegeUsed=true; }   // 파성추(C3) 소모
      dB+=fortDef; if(defender.side==="P"&&hasR(g,"축성술"))dB+=0.15; }
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
    const wound=(army,before,after,hero)=>{if(army.side!=="P")return 0;let t=0;
      const wr=Math.max(0,WOUND_RATE-(hero?traitSum(hero,"woundReduce"):0));   // 인내형 특성: 부상률 완화
      for(const u in before){const lost=(before[u]||0)-(after[u]||0);if(lost>0){const w=Math.round(lost*wr);if(w>0){g.castle.wounded[u]=(g.castle.wounded[u]||0)+w;t+=w;}}}return t;};
    // E3(전투 연출): 라운드 수·특수/요격 총계로 "어떤 전투였는지" 체감을 살림. 승자 측 생존율로 압승/신승/박빙 판정.
    const initA=Object.values(beforeA).reduce((x,v)=>x+v,0), initB=Object.values(beforeB).reduce((x,v)=>x+v,0);
    const survRate = res.w==="A"?(initA?res.survA/initA:0) : res.w==="B"?(initB?res.survB/initB:0) : null;
    const margin = survRate==null?null : survRate>=0.7?"압승":survRate>=0.35?"신승":"박빙";
    const sum={attacker:attacker.name,defender:defender.name,aSide:attacker.side,fort:fort||ancientHold,w:res.w,survA:res.survA,survB:res.survB,siegeUsed,
      rounds:res.rounds,totalProc:res.totalProc,totalCounter:res.totalCounter,margin,
      heroA:aHero?aHero.name:null,heroB:dHero?dHero.name:null,
      buffA:aHero?Math.round(aB*100):0, buffB:dHero?Math.round(dB*100):0,
      gradeA:aHero?aHero.grade:0, gradeB:dHero?dHero.grade:0,
      dragonA:!!attacker.dragon, dragonB:!!defender.dragon, dragonStage:DRAGON_STAGES[(g.dragon&&g.dragon.stage)||0].name,
      enrageLoss:enrageLoss>0?Math.round(enrageLoss*100):0};
    if(res.w==="A"){ attacker.comp=rA; const wd=wound(attacker,beforeA,rA,aHero);
      let rw=grantMonsterReward(g,defender,node,sum);   // 몬스터 처치 보상(추출 헬퍼 — 오프라인 사냥과 공용)
      if(attacker.side==="P"&&defender.side==="E") rw+=threatKillReward(g,defender,sum);   // G-D: 야전에서 적 위협군 격파
      if(attacker.side==="P"&&defender.rival){ const rh=damageRival(g,defender.rival,troops(defender)); if(rh){sum.rivalHit=rh;rw+=` · ${rh.name} 국력 -${rh.amount}`;} }   // I2: 라이벌 격파→순위
      sum.result=`${attacker.name} ${defender.side==="M"?"소탕 성공":"승리"} · ${defender.name} ${defender.side==="M"?"소멸":"전멸"}${rw}`+(wd?` · 부상 ${wd}`:"");
      removeArmy(g,defender); attacker.node=node; }
    else if(res.w==="B"){ defender.comp=rB; const wd=wound(defender,beforeB,rB,dHero);
      let rw2=""; if(defender.side==="P"&&attacker.side==="E") rw2=threatKillReward(g,attacker,sum);   // G-D: 수성/야전 수비 승리로 적 위협군 격퇴
      if(defender.side==="P"&&attacker.rival){ const rh=damageRival(g,attacker.rival,troops(attacker)); if(rh){sum.rivalHit=rh;rw2+=` · ${rh.name} 국력 -${rh.amount}`;} }   // I2: 라이벌 격파→순위
      sum.result=`${defender.name} 방어 · ${attacker.name} 전멸${rw2}`+(wd?` · 부상 ${wd}`:""); removeArmy(g,attacker); }
    else { attacker.comp=rA; defender.comp=rB; wound(attacker,beforeA,rA,aHero); wound(defender,beforeB,rB,dHero); sum.result="무승부 · 양측 생존"; }
    return sum;
  }
  function defendCastle(g,attacker){
    const defComp={...g.castle.garrison}; const pArmies=armiesAt(g,"P").filter(a=>a.side==="P"); let hero=null, dragon=false;
    for(const a of pArmies){for(const u in a.comp)defComp[u]=(defComp[u]||0)+a.comp[u]; if(a.hero&&heroById(g,a.hero)?.type==="전투")hero=a.hero; if(a.dragon)dragon=true;}
    const defender={side:"P",name:"수도 수비대",comp:defComp,hero,dragon};
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
    if(R&&R.holder&&R.holdTurns>=R.need&&!R.settled){   // settled: 같은 점거 스트릭당 1회만 발동(유저: 적이 고대성에 눌러앉으면 팝업 주기적 반복)
      const winnerSide=R.holder; let reward=null;
      if(winnerSide==="P"){ reward={철:80,석재:60,식량:60}; for(const r in reward) g.res[r]=(g.res[r]||0)+reward[r]; g.raidWins=(g.raidWins||0)+1; }
      else g.raidLosses=(g.raidLosses||0)+1;
      R.settled=true;   // 정착: 점거가 이어지는 한 재발동 금지. 점거 해제/보스 재등장 시 raidTick이 풀어줌(무한 보상 파밍도 차단).
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
      if(r.ancient){ const tmpl=ancientTemplate(); if(!tmpl)continue;               // 월드 보스(B4) 재등장(노드맵·타일맵 공용)
        const occ=armiesAt(g,"ANCIENT"); if(occ.some(a=>a.side==="M"))continue;     // 이미 있음 → 취소
        if(occ.length){keep.push({ancient:true,at:g.turn+2});continue;}            // 점거 중 → 지연
        g.armies.push(mkMonster(tmpl, g, 1+0.2*(g.raidBossGen||0))); continue; }
      if(r.random){ if(MSPAWN)spawnRoamer(g, MSPAWN.pool[Math.floor(Math.random()*MSPAWN.pool.length)]); continue; }  // 랜덤 타일 재등장
      const occ=armiesAt(g,r.node); if(occ.some(a=>a.side==="M"))continue;          // 이미 있음 → 취소
      if(occ.some(a=>a.side!=="M")){keep.push({node:r.node,at:g.turn+2});continue;} // 점거 중 → 지연
      const t=MONSTERS.find(m=>m.node===r.node); if(t)g.armies.push(mkMonster(t,g)); }
    g.respawns=keep; }
  // 레이드 수성 카운트: 보스 처치 후 ANCIENT를 한 세력이 점거하면 매턴 +1, 비거나 교전 중이면 리셋
  function raidTick(g){ const R=g.raid; if(!R)return;
    if(armiesAt(g,"ANCIENT").some(a=>a.side==="M")){R.holder=null;R.holdTurns=0;R.settled=false;return;}   // 보스 재등장 → 재도전 가능
    R.cleared=true;
    const sides=[...new Set(armiesAt(g,"ANCIENT").filter(a=>a.side==="P"||a.side==="E").map(a=>a.side))];
    if(sides.length===1){const s=sides[0];NODES.ANCIENT.owner=s; if(R.holder===s){ if(!R.settled)R.holdTurns++; } else {R.holder=s;R.holdTurns=1;R.settled=false;}}   // settled면 카운트 정지(재발동 금지). 점거자 교체 시 재무장.
    else{R.holder=null;R.holdTurns=0;R.settled=false;}   // 비거나 교전 중 → 재무장
  }
  // ---- 시간 기반 이동 (mp 대체) ----
  // 부대 속도: comp에 존재하는 병종 그룹들의 MOVE_TICKS 단순 평균 → 틱당 진행도(1/틱).
  function armyTicksPerTile(a){ const gs=new Set();
    for(const k in a.comp){ if(a.comp[k]>0){ const grp=UNIT_GROUP[baseOf(k)]; if(grp)gs.add(grp); } }
    if(!gs.size) return MOVE_TICKS.보병;
    let s=0; for(const grp of gs) s+=MOVE_TICKS[grp]; return s/gs.size; }
  function armySpeed(g,a){ let t=armyTicksPerTile(a);
    if(a.side==="P" && hasR(g,"행군술")) t=Math.max(1,t-1);   // 행군술: 통과 1틱 단축(구 이동력+1 재활용)
    if(a.side==="P" && hasR(g,"행군술 II")) t=Math.max(1,t-1);   // F5: 행군술 II 누적 단축
    const hero=a.hero&&heroById(g,a.hero); if(hero) t=Math.max(1,t-traitSum(hero,"moveBonus"));   // 기동형 특성(여러 개면 누적 단축)
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

  // ---- G-A: 부대 자동 사냥 — a.hunt 켠 부대가 유휴가 되면 '이길 만한' 최근접 몬스터로 스스로 진군(킬 후 다음 목표로 연쇄) ----
  const UNIT_TM=t=>1+((t||1)-1)*0.15;   // engine.tierMult 동일(엔진 미노출 대비 로컬)
  const unitScore=(name,tier)=>{const u=UNITS[name];return u?(u.hp+u.atk*4+u.df*2)*UNIT_TM(tier):0;};   // 전투 기여도 근사(공격 가중)
  const compPower=comp=>{let s=0;for(const k in comp){const n=comp[k];if(n>0)s+=n*unitScore(baseOf(k),tierOf(k));}return s;};
  function estCombatBuff(g,a){ let b=0; const h=a.hero&&heroById(g,a.hero); if(h&&h.type==="전투") b+=GRADE_BUFF[h.grade]+traitSum(h,"atkBonus");
    b+=lordTalentSum(g,"atkBonus")+lordEquipSum(g,"atkBonus");
    if(a.dragon) b+=DRAGON_STAGES[(g.dragon&&g.dragon.stage)||0].buff+dragonSkillSum(g,"atkBonus")+dragonResearchSum(g,"atk");
    return b; }
  const armyPower=(g,a)=>compPower(a.comp)*(1+estCombatBuff(g,a));
  // 승산 확정 판정: 전력 근사(compPower)는 공/방 감쇄(dmg=max(atk*0.15,atk-df))를 못 담아, 저공격·고방어 부대가
  // "압승"으로 오판되고 고방어 몬스터에 오히려 전멸한다. → 실제 전투 엔진으로 3판 시뮬해 전부 이겨야 사냥(온·오프 공용, 침묵 전멸 방지).
  function huntWinnable(g,a,m){ const aB=estCombatBuff(g,a), mods=mergeMods(researchMods(g),HP_MODS);
    for(let i=0;i<3;i++){ if(simulate(compArr(a),aB,compArr(m),0,BATTLE_ROUNDS,mods,HP_MODS).w!=="A") return false; }
    return true; }
  function nearestWinnableMonster(g,a){ const {dist}=dijkstra(a.node,99); const ap=armyPower(g,a);
    const cands=[];
    for(const m of g.armies){ if(m.side!=="M"||m.mtier==="레이드") continue;   // 레이드 보스는 자동 대상 제외(수동 도전 유지)
      const d=dist[m.node]; if(d===undefined) continue;
      if(ap < compPower(m.comp)*1.2) continue;   // 1차 싼 프리필터(명백히 약하면 스킵)
      cands.push([d,m]); }
    cands.sort((x,y)=>x[0]-y[0]);
    for(const [d,m] of cands){ if(huntWinnable(g,a,m)) return m; }   // 근접순으로 시뮬 확정 — 첫 확실 승리 대상 반환
    return null; }
  function assignHuntOrders(g){ for(const a of g.armies){ if(a.side!=="P"||!a.hunt) continue;
      if(a.dest && a.node!==a.dest) continue;   // 이미 이동 중이면 유지
      const m=nearestWinnableMonster(g,a); if(m && m.node!==a.node) orderMove(g,a.id,m.node); } }
  function setHunt(g,armyId,on){ const a=findArmy(g,armyId); if(a){ a.hunt=!!on; if(on)a.gather=false; } return null; }   // 사냥·채집 상호배타
  // ---- H1(방치형): 자동 채집 — a.gather 켠 부대가 유휴가 되면 가장 부족한 자원의 미점유 자원지로 스스로 진군. 도착하면 기존 주둔 채집(gatherOf)이 수입 발생. ----
  function bestGatherNode(g,a,taken){ const {dist}=dijkstra(a.node,99); let best=null,bs=Infinity;
    for(const nk in NODES){ const n=NODES[nk]; if(n.type!=="resource"||taken.has(nk)) continue;
      const d=dist[nk]; if(d===undefined) continue;
      const score=(g.res[n.res]||0)*100+d;   // 보유량 낮을수록·가까울수록 우선(자원 균형 채집)
      if(score<bs){bs=score;best=nk;} }
    return best; }
  function assignGatherOrders(g){
    const taken=new Set();   // 이미 점유/배정된 자원지(중복 파견 방지)
    for(const x of g.armies){ if(x.side==="P"){ const dn=(x.dest&&x.node!==x.dest)?x.dest:x.node; if(NODES[dn]&&NODES[dn].type==="resource")taken.add(dn); } }
    for(const a of g.armies){ if(a.side!=="P"||!a.gather) continue;
      if(a.dest && a.node!==a.dest) continue;   // 이동 중 유지
      if(NODES[a.node]&&NODES[a.node].type==="resource") continue;   // 이미 채집 중이면 유지
      const t=bestGatherNode(g,a,taken); if(t){ orderMove(g,a.id,t); taken.add(t); } } }
  function setGather(g,armyId,on){ const a=findArmy(g,armyId); if(a){ a.gather=!!on; if(on)a.hunt=false; } return null; }   // 채집·사냥 상호배타
  // G-F: 전군 소집 — 사냥/채집/원정 나간 모든 P부대를 성으로 귀환시켜 방어전 합류(defendCastle이 P의 pArmies를 수비에 포함).
  // 자동사냥·채집은 끄고 부름(안 그러면 도착 즉시 다시 나감). 시즌 예고에 능동 대응하는 "전쟁 준비" 순간.
  function rallyToDefense(g){ let n=0; for(const a of g.armies){ if(a.side==="P"&&a.node!=="P"){ a.hunt=false; a.gather=false; orderMove(g,a.id,"P"); n++; } } return n; }

  // ---- 액션 (g 변경, 실패 시 메시지 반환 / 성공 시 null) ----
  const maxTierFor=(g,u)=>{const b=UNIT_BLD[u];return b?(g.castle.blevel[b]||0):0;};
  function produce(g,u,qty,tier){qty=Math.max(1,qty|0);tier=Math.max(1,Math.min(TIER_MAX,tier||1));
    const b=UNIT_BLD[u]; if(!b||!g.castle.buildings.includes(b))return"건물 미건설";
    const lv=g.castle.blevel[b]||1; if(tier>lv)return`${b} Lv.${lv} — T${tier} 생산 불가(레벨업 필요)`;
    const c=costOf(u,tier),tot={};for(const r in c)tot[r]=c[r]*qty;
    if(!canAfford(g,tot))return"자원 부족"; pay(g,tot); const key=uk(u,tier);
    const q=g.castle.queue[b]=g.castle.queue[b]||[]; for(let i=0;i<qty;i++)q.push(key); return null;}
  // F1+생산시간: 병영별 독립 훈련. 각 건물이 매 틱 buildRate만큼 '훈련 진행도'를 쌓고, 큐 맨 앞 유닛의 소요(TRAIN_TICKS)를 채우면 완성.
  // 고티어일수록 오래 걸려 병력이 천천히 늘고 식량도 완만히 소모됨(유저 피드백: 매 틱 마구 생산되어 식량 급감).
  const trainCost=key=>TRAIN_TICKS[tierOf(key)]||2;
  function tickProduction(g){ if(g.starving) return; const rate=buildRate(g); g.castle.trainProg=g.castle.trainProg||{};
    for(const b in g.castle.queue){ const q=g.castle.queue[b]; if(!q||!q.length){ g.castle.trainProg[b]=0; continue; }
      let prog=(g.castle.trainProg[b]||0)+rate, guard=0;
      while(q.length && guard++<50){ const key=q[0], cost=trainCost(key); if(prog<cost) break; prog-=cost; q.shift(); g.castle.garrison[key]=(g.castle.garrison[key]||0)+1; }
      g.castle.trainProg[b]=q.length?prog:0; } }
  // G-C: 자동 생산 — 반복생산 건물의 큐를 얕게(≤2) 유지(자원이 되는 한). 생산시간 도입으로 큐가 천천히 소모되므로 선불 백로그를 얕게 둠.
  // 자원 부족 시 produce가 에러 반환 → 조용히 멈춤. offlineStep에도 연결(오프라인 성장은 경제/생산이라 OK).
  function autoProduceTick(g){ const ap=g.castle.autoProduce; if(!ap||g.starving) return;
    for(const b in ap){ const spec=ap[b]; if(!spec) continue;
      const q=g.castle.queue[b]=g.castle.queue[b]||[]; let guard=0;
      while(q.length<2 && guard++<5){ if(produce(g,spec.u,1,spec.tier)) break; } } }
  // 반복생산 토글: 같은 (건물,병종,티어) 재설정 시 해제. 다른 병종이면 교체.
  function setAutoProduce(g,building,u,tier){ g.castle.autoProduce=g.castle.autoProduce||{};
    const cur=g.castle.autoProduce[building];
    if(cur && cur.u===u && cur.tier===tier) delete g.castle.autoProduce[building];
    else g.castle.autoProduce[building]={u,tier:tier||1};
    return null; }
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
    const lv=g.castle.blevel[key]||1; if(lv>=tierCap(g))return"최대 레벨(마일스톤 해금 필요)"; return startBuild(g,"bld",key,bUpCost(key,lv),buildDur("bld"),`${key} → T${lv+1}`);}
  function fortifyWall(g){return startBuild(g,"wall",null,wallCost(g.castle.wall||0),buildDur("wall"),"성벽 보강");}
  // 파성추(C3): 건설 큐를 안 쓰는 즉시 제작 소모품 — 성/경제 업그레이드와 슬롯을 다투지 않음.
  function craftSiege(g){ if(!canAfford(g,SIEGE_COST))return"자원 부족"; pay(g,SIEGE_COST); g.castle.siegeItems=(g.castle.siegeItems||0)+1; return null; }
  // 승급(C2): 즉시 등급만 올리던 무결정을 "특성 2択" 결정으로 바꿈. promoteHero는 자원 확인 후 후보만 뽑고,
  // 실제 등급 상승·자원 차감은 choosePromoteTrait(선택 확정 시점)에서 일어남.
  function promoteHero(g,hid){const h=heroById(g,hid); if(!h)return"영웅 없음"; if(h.grade>=3)return"이미 최고 등급";
    if(g.pendingPromote)return"다른 영웅의 승급 선택이 대기 중";
    const c=PROMOTE_COST[h.grade]; if((g.xpItems||0)<c)return"경험치 아이템 부족";
    const pool=HERO_TRAITS[h.type]||[], have=new Set(h.traits||(h.trait?[h.trait]:[]));
    let cands=pool.filter(t=>!have.has(t.id)); if(cands.length<2) cands=pool;   // 후보 소진 시 중첩 강화 허용
    const src=[...cands], picks=[];
    while(picks.length<2 && src.length) picks.push(src.splice(Math.floor(Math.random()*src.length),1)[0]);
    while(picks.length<2 && cands.length) picks.push(cands[Math.floor(Math.random()*cands.length)]);
    g.pendingPromote={hid, options:picks.map(t=>t.id)}; return null;}
  function choosePromoteTrait(g,hid,traitId){const pp=g.pendingPromote; if(!pp||pp.hid!==hid)return"대기 중인 승급 없음";
    if(!pp.options.includes(traitId))return"잘못된 선택";
    const h=heroById(g,hid); if(!h){g.pendingPromote=null;return"영웅 없음";}
    const c=PROMOTE_COST[h.grade]; if((g.xpItems||0)<c){g.pendingPromote=null;return"경험치 아이템 부족";}
    g.xpItems-=c; h.grade++; h.traits=h.traits||(h.trait?[h.trait]:[]); delete h.trait; h.traits.push(traitId);
    g.pendingPromote=null; return null;}
  function cancelPromote(g){g.pendingPromote=null; return null;}
  function levelUp(g){return startBuild(g,"castle",null,CASTLE_UP_COST,buildDur("castle"),"성 레벨업");}
  function buildEcon(g,k){const lv=g.castle.econ[k]||0; if(lv>=ECON_MAX)return"최대 레벨"; return startBuild(g,"econ",k,econCost(k,lv),buildDur("econ",lv),`${k} Lv${lv+1}`);}
  function buildUniversity(g){if(g.castle.buildings.includes("대학"))return null; return startBuild(g,"univ",null,UNIV_COST,buildDur("univ"),"대학 건설");}
  function startResearch(g,k){if(g.research.active)return"이미 연구 중"; const r=RESEARCH[k]; if(g.research.done[k])return null;
    if(!(r.req||[]).every(q=>g.research.done[q]))return"선행 연구 필요";
    if((r.excludes||[]).some(ex=>g.research.done[ex]))return"상호 배타 연구 — 이미 다른 노선을 선택함";
    if(!canAfford(g,r.cost))return"자원 부족";
    pay(g,r.cost); const turns=Math.max(1,r.turns-councilSum(g,"researchBonus")-lordTalentSum(g,"researchBonus")-lordEquipSum(g,"researchBonus"));
    g.research.active={key:k,left:turns}; return null;}
  function assignHero(g,hid,loc){const h=heroById(g,hid); if(!h)return"영웅 없음";
    // F2: 위원회(성 배치)는 내정형 전용 + 슬롯 상한 — 이미 자리를 잡은 영웅의 재배치(같은 자리)는 허용.
    if(loc==="castle" && h.loc!=="castle" && cityHeroes(g).length>=councilSlots(g)) return"위원회 자리가 가득 찼습니다";
    h.loc=loc; return null;}
  // 드래곤(C1) 배치: 영웅과 달리 유일 개체라 army.dragon 불리언 플래그 하나로 위치 추적(loc: 부대 id | "idle").
  function assignDragon(g,loc){ for(const a of g.armies) if(a.dragon) delete a.dragon;
    if(loc!=="idle"){ const a=findArmy(g,loc); if(a) a.dragon=true; } return null; }
  const dragonLoc=g=>{const a=g.armies.find(x=>x.dragon); return a?a.id:"idle";};
  const heroEffect=h=>{const base=h.type==="전투"?`전투 참전 시 부대 전투력 +${Math.round(GRADE_BUFF[h.grade]*100)}%`
    :`성 배치: 생산 +${h.grade>=3?2:1} · 자원지 배치: 채집 ×${GRADE_GATHER[h.grade]}`;
    const trs=heroTraits(h); return trs.length?`${base} · ${trs.map(t=>`✦${t.name}: ${t.desc}`).join(" · ")}`:base;};
  // ---- 선술집: 랜덤 후보 등장 → 재화 영입 · ★3은 토벌 점수 특별 영입 ----
  function buildTavern(g){if(g.tavern.built)return null; return startBuild(g,"tavern",null,TAVERN_COST,buildDur("tavern"),"선술집 건설");}
  function rollCandidate(g){if(!g.tavern.built||g.tavern.pool.length>=POOL_CAP)return;
    const type=Math.random()<0.5?"내정":"전투", grade=Math.random()<0.6?1:2;
    const name=HERO_NAMES[Math.floor(Math.random()*HERO_NAMES.length)];
    g.tavern.pool.push({id:newId(g,"H"),name,type,grade,traits:[randomTrait(type)]}); }
  function tavernTick(g){ if(g.tavern.built && g.turn%TAVERN_GAP===0) rollCandidate(g); }
  function recruitHero(g,cid){const i=g.tavern.pool.findIndex(c=>c.id===cid);if(i<0)return"후보 없음";
    const c=g.tavern.pool[i],cost=RECRUIT_COST[c.grade]; if(!canAfford(g,cost))return"자원 부족";
    pay(g,cost); g.heroes.push({id:c.id,name:c.name,type:c.type,grade:c.grade,loc:"idle",traits:c.traits}); g.tavern.pool.splice(i,1); return null;}
  function specialRecruit(g){if(!g.tavern.built)return"선술집 필요";
    if((g.subdue||0)<SPECIAL_COST.토벌)return"토벌 점수 부족";
    const res={식량:SPECIAL_COST.식량,철:SPECIAL_COST.철}; if(!canAfford(g,res))return"자원 부족";
    pay(g,res); g.subdue-=SPECIAL_COST.토벌;
    const type=Math.random()<0.5?"내정":"전투", name=HERO_NAMES[Math.floor(Math.random()*HERO_NAMES.length)];
    g.heroes.push({id:newId(g,"H"),name:name,type,grade:3,loc:"idle",traits:[randomTrait(type)]}); return null;}
  function draftAdjust(g,u,d){const gar=g.castle.garrison,draft=g.castle.draft;const avail=gar[u]||0,cur=draft[u]||0,tot=Object.values(draft).reduce((x,y)=>x+y,0);
    if(d>0&&(cur>=avail||tot>=armyCapFor(g)))return; const nv=Math.max(0,Math.min(avail,cur+d)); if(nv===0)delete draft[u];else draft[u]=nv;}
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
    const grace=g.turn<(AI.graceTurns||0);   // 초반 유예: 예산 낮추고 비축 제한(첫 웨이브 지연·과대화 방지)
    g.ai.budget+=(grace?AI.graceBudget:AI.budgetPerTurn)+Math.min(3,Math.floor(g.turn/14));   // 후반 눈덩이 완화(긴 판 대응)
    let home=g.armies.find(a=>a.side==="E"&&a.node==="E"&&a.role!=="attack");
    if(!home){home={id:newId(g,"EH"),side:"E",node:"E",mp:0,maxMp:0,name:"적 본대",comp:{},hero:null,role:"home"};g.armies.push(home);}
    const cu=playerCounterUnit(g), t=aiTierOf(g); let guard=0;
    const buildCap=grace?Math.min(AI.homeCap,AI.waveSize):AI.homeCap;   // 유예 중엔 waveSize까지만 비축 → 유예 해제 직후 거대 웨이브 방지
    while(guard++<60&&troops(home)<buildCap){const u=pickAIUnit(cu),c=AI_UNIT_COST[u]*t;if(g.ai.budget<c)break;g.ai.budget-=c;const key=uk(u,t);home.comp[key]=(home.comp[key]||0)+1;}
    // 동시 원정대 수 제한(§9 부대 수 상한 대칭) — 무한 웨이브 방지 + waveGap으로 웨이브 간 최소 간격
    const waves=g.armies.filter(a=>a.side==="E"&&a.role==="attack").length;
    const bossAlive=armiesAt(g,"ANCIENT").some(a=>a.side==="M");
    const raiding=g.armies.some(a=>a.side==="E"&&a.target==="ANCIENT");
    const gapOk=(g.turn-(g.ai.lastWave??-99))>=(AI.waveGap||0);
    if(waves<(AI.waveCap||2)&&!grace&&gapOk){
      if(bossAlive&&!raiding&&troops(home)>=40){ detach(g,home,Math.floor(troops(home)*0.7),"적 레이드대","attack","ANCIENT"); g.ai.lastWave=g.turn; }
      else if(troops(home)>=AI.waveSize){ const rid=pickAggressorRival(g), nm=rivalName(rid); const e=detach(g,home,Math.floor(troops(home)*(AI.waveFrac||0.7)),nm?`${nm}의 원정대`:"적 원정대","attack",pickAITarget(g)); if(e)e.rival=rid; g.ai.lastWave=g.turn; }   // I2: 라이벌 스폰서
    }
    for(const e of g.armies.filter(a=>a.side==="E"&&a.role==="attack")){ orderMove(g,e.id,e.target||"P"); }   // 목적지만 지정, 이동은 moveTick
    return null;
  }

  // ---- 시즌형 침공(B2): 예고 → 도래. 기존 웨이브 예산 로직과 별개인 스크립트 이벤트 — 회귀 위험 최소화. ----
  function seasonTick(g){
    if(!g.season) g.season={count:1,next:SEASON_INTERVAL,warnAt:SEASON_INTERVAL-SEASON_WARN_LEAD,warned:false};
    const s=g.season;
    // 예고 시점에 예상 주력 병종을 미리 뽑아 저장 → 도래 때도 같은 값을 써서 예고와 실제가 일치하게(§6 핵심가설: 상성 맞춰 대비).
    if(!s.warned && g.turn>=s.warnAt){ s.warned=true; s.previewUnit=playerCounterUnit(g); return {type:"warning",count:s.count,arriveIn:s.next-g.turn,previewUnit:s.previewUnit}; }
    if(g.turn>=s.next){
      const need=Math.round(Math.max(SEASON_BASE*(1+SEASON_GROWTH*(s.count-1)), computeMight(g)*0.22)*threatMul(g));   // I4: 위협 등반
      const cu=s.previewUnit||playerCounterUnit(g), t=aiTierOf(g), comp={};
      for(let i=0;i<need;i++){ const u=pickAIUnit(cu), key=uk(u,t); comp[key]=(comp[key]||0)+1; }
      const target=pickAITarget(g);
      const rid=pickAggressorRival(g), nm=rivalName(rid);   // I2: 시즌 대침공도 라이벌이 주도
      const e={id:newId(g,"ES"),side:"E",node:"E",mp:0,maxMp:0,name:`${nm?nm+"의 ":""}시즌 대침공 ${s.count}차`,comp,hero:null,role:"attack",target,rival:rid};
      g.armies.push(e); orderMove(g,e.id,target);
      const done=s.count; s.count++;
      const interval=Math.max(SEASON_MIN_INTERVAL, SEASON_INTERVAL-3*(s.count-1));
      s.next=g.turn+interval; s.warnAt=s.next-SEASON_WARN_LEAD; s.warned=false; delete s.previewUnit;
      return {type:"arrived",count:done,troops:need};
    }
    return null;
  }

  // ---- 다수 세력(B1): 성 없이 야생에서 등장하는 독립 습격대. 각자 고유 주기·병종 편향. ----
  function factionTick(g){
    if(!g.factions) g.factions=FACTIONS.map(f=>({id:f.id,count:1,next:f.interval}));
    const events=[];
    for(const fs of g.factions){
      const f=FACTIONS.find(x=>x.id===fs.id); if(!f||g.turn<fs.next) continue;
      const need=Math.round(f.base*(1+f.growth*(fs.count-1))*(1-dragonSkillSum(g,"factionReduce"))*threatMul(g));   // 위압의 포효(드래곤) + I4 위협 등반
      const t=aiTierOf(g), comp={};
      for(let i=0;i<need;i++){ const u=f.units[Math.floor(Math.random()*f.units.length)], key=uk(u,t); comp[key]=(comp[key]||0)+1; }
      const node=randomTile(g)||"E";
      let target="P";
      if(f.prey){ const exposed=g.armies.filter(a=>a.side==="P"&&a.node!=="P"); if(exposed.length) target=exposed[Math.floor(Math.random()*exposed.length)].node; }
      const e={id:newId(g,"F"),side:"E",node,mp:0,maxMp:0,name:`${f.name} 습격대`,comp,hero:null,role:"attack",target};
      g.armies.push(e); orderMove(g,e.id,target);
      events.push({type:"faction",faction:f.name,troops:need,target});
      fs.count++; fs.next=g.turn+f.interval;
    }
    return events;
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
    // E5(중후반 온보딩): 초반 8단계 이후 드래곤·승급·공성·레이드·시즌은 게임 안에서 발견하기 어려워 방치되기 쉬움 —
    // 같은 순차 체인 패턴을 그대로 이어붙여 "다음엔 뭘 해야 하나"를 계속 제시(새 UI 없이 renderQuests 재사용).
    {id:"dragon",name:"용의 동행",   desc:"🐉 드래곤을 부대에 배치해 함께 출전하자.",            reward:{},              dragonScale:10, done:g=>g.armies.some(a=>a.side==="P"&&a.dragon)},
    {id:"promote",name:"영웅 승급",  desc:"⭐ 영웅을 승급시켜 특성을 하나 더 선택하자.",          reward:{},              xp:5,           done:g=>g.heroes.some(h=>h.grade>=3)},
    {id:"siege",name:"공성 준비",    desc:"🏹 파성추를 제작해 성 공략을 준비하자.",              reward:{},              done:g=>(g.castle.siegeItems||0)>=1},
    {id:"raid",name:"고대성 도전",   desc:"🏛 고대성 레이드에 도전해 수성에 성공하자.",           reward:{철:30,석재:30}, done:g=>(g.raidWins||0)>=1},
    {id:"season",name:"시즌 대침공", desc:"🌪 시즌 대침공 예고에 대비해 첫 침공을 막아내자.",      reward:{식량:30,목재:30},done:g=>!!(g.season&&g.season.count>1)},
  ];
  function questTick(g){
    if(!g.quests) g.quests={done:[],idx:0};
    const completed=[];
    while(g.quests.idx<QUESTS.length){
      const q=QUESTS[g.quests.idx];
      if(!q.done(g)) break;
      g.quests.done.push(q.id);
      if(q.reward) for(const r in q.reward) g.res[r]=(g.res[r]||0)+q.reward[r];
      if(q.dragonScale) g.dragonScale=(g.dragonScale||0)+q.dragonScale;   // E5: 자원 종류가 다른 보상(용린/경험치)도 같은 체인에서 지급
      if(q.xp) g.xpItems=(g.xpItems||0)+q.xp;
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
    {id:"m3",name:"무장한 왕국",   need:450, reward:{철:50,석재:40},               unlock:["wall","council"],  desc:"국력 450 — 성벽 보강 상한 +1, 영웅 위원회 자리 +1."},
    {id:"m4",name:"지역의 패자",   need:650, reward:{식량:100,목재:80,철:60},           unlock:"tier4", desc:"국력 650 — 생산 건물 T4(전설) 해금."},
    {id:"m5",name:"왕국의 전설",   need:900, reward:{식량:150,목재:120,석재:100,철:100}, unlock:["slot","tier5"], desc:"국력 900 — 운용 부대 수 상한 +1, 생산 건물 T5(신화) 해금."},
  ];
  // 5단계 이후엔 "왕국 칭호" 순환으로 무한히 이어짐 — 마일스톤이 끝나 "다음 목표"가 사라지는 엔드게임 절벽 방지.
  // need는 직전 값에서 ×1.4씩(지수 성장, 국력 증가 속도를 앞질러 자연히 간격이 벌어짐), 보상도 회차만큼 커짐.
  const TITLES=["남작","자작","백작","후작","공작","대공","왕"];
  function proceduralMilestone(idx){
    const n=idx-MILESTONES.length, last=MILESTONES[MILESTONES.length-1];
    const need=Math.round(last.need*Math.pow(1.4,n+1));
    const cycle=Math.floor(n/TITLES.length)+1, title=TITLES[n%TITLES.length]+(cycle>1?` ${cycle}기`:"");
    const amt=Math.round(40*(1+n*0.5)), reward=Object.fromEntries(RES.map(r=>[r,amt]));
    return {id:"title"+idx, name:`${title} 즉위`, need, reward, desc:`국력 ${need} — 왕국이 ${title}의 반열에 올랐다.`};
  }
  const milestoneAt=idx=>idx<MILESTONES.length ? MILESTONES[idx] : proceduralMilestone(idx);
  function milestoneTick(g){
    if(!g.milestones) g.milestones={done:[],idx:0,unlocked:[]};
    const completed=[], might=computeMight(g);
    while(true){
      const m=milestoneAt(g.milestones.idx); if(might<m.need) break;
      g.milestones.done.push(m.id);
      if(m.reward) for(const r in m.reward) g.res[r]=(g.res[r]||0)+m.reward[r];
      if(m.unlock) for(const u of (Array.isArray(m.unlock)?m.unlock:[m.unlock])) g.milestones.unlocked.push(u);
      addSeasonScore(g,40);   // I3: 성장(마일스톤 달성)도 시즌 점수
      g.milestones.idx++; completed.push(m);
    }
    return completed;
  }

  // ---- 드래곤(C1) 단계 진행: 용린 누적에 따라 순차 성장(퀘스트/마일스톤과 같은 패턴) ----
  // F3: 스킬은 더 이상 단계 상승에 묶이지 않음 — 용린이 SKILL_POINT_GAP만큼 쌓일 때마다 포인트 지급(성체 도달 후에도 계속 성장 가능).
  const SKILL_POINT_GAP=30;
  function dragonTick(g){
    if(!g.dragon) g.dragon={stage:0,skills:[],skillPoints:0,scaleSpent:0};
    if(g.dragon.skillPoints===undefined) g.dragon.skillPoints=0;
    if(g.dragon.scaleSpent===undefined) g.dragon.scaleSpent=0;
    const completed=[];
    while(g.dragon.stage<DRAGON_STAGES.length-1 && (g.dragonScale||0)>=DRAGON_STAGES[g.dragon.stage+1].need){
      g.dragon.stage++; completed.push(DRAGON_STAGES[g.dragon.stage]);
    }
    while((g.dragonScale||0)-g.dragon.scaleSpent>=SKILL_POINT_GAP){ g.dragon.scaleSpent+=SKILL_POINT_GAP; g.dragon.skillPoints++; }
    return completed;
  }
  // F3: RESEARCH의 req 체크와 동일한 모양 — 자원 대신 skillPoints 1점 소모, 턴 대기 없이 즉시 습득.
  function investDragonSkill(g,skillId){ const sk=DRAGON_SKILLS.find(s=>s.id===skillId); if(!sk)return"잘못된 스킬";
    g.dragon.skills=g.dragon.skills||[]; if(g.dragon.skills.includes(skillId))return null;
    if(!(sk.req||[]).every(r=>g.dragon.skills.includes(r)))return"선행 스킬 필요";
    if((g.dragon.skillPoints||0)<1)return"스킬 포인트 부족";
    g.dragon.skillPoints--; g.dragon.skills.push(skillId); return null; }

  // ---- 군주(F4): 몬스터 처치 경험치로 레벨업(순차 절차적 문턱, 마일스톤과 같은 패턴) → 레벨당 재능 포인트 2 ----
  function lordTick(g){ if(!g.lord) g.lord={level:1,xp:0,talentPoints:0,talents:{},equipment:{}};
    let leveled=false;
    while(g.lord.xp>=lordXPNeed(g.lord.level)){ g.lord.xp-=lordXPNeed(g.lord.level); g.lord.level++; g.lord.talentPoints+=2; leveled=true; }
    return leveled; }
  function investTalent(g,key){ const t=LORD_TALENTS.find(x=>x.id===key); if(!t)return"잘못된 재능";
    g.lord.talents=g.lord.talents||{}; if(g.lord.talents[key])return null;
    if(!(t.req||[]).every(r=>g.lord.talents[r]))return"선행 재능 필요";
    if((g.lord.talentPoints||0)<t.cost)return"재능 포인트 부족";
    g.lord.talentPoints-=t.cost; g.lord.talents[key]=true; return null; }
  function craftEquipment(g,key){ const it=EQUIPMENT[key]; if(!it)return"잘못된 장비";
    if((g.blueprints||0)<it.need.blueprint)return"설계도 부족";
    if((g.materials||0)<it.need.material)return"재료 부족";
    if(!canAfford(g,it.cost))return"자원 부족";
    g.blueprints-=it.need.blueprint; g.materials-=it.need.material; pay(g,it.cost);
    g.lordInventory=g.lordInventory||[]; g.lordInventory.push({id:newId(g,"EQ"),key,enhance:0}); return null; }
  const enhanceCost=lv=>({materials:5+lv*3, res:{철:10+lv*10}});   // lv=강화 전 현재 레벨(0~4)
  function enhanceEquipment(g,itemId){ const it=(g.lordInventory||[]).find(x=>x.id===itemId); if(!it)return"장비 없음";
    if(it.enhance>=5)return"최대 강화";
    const c=enhanceCost(it.enhance);
    if((g.materials||0)<c.materials)return"재료 부족"; if(!canAfford(g,c.res))return"자원 부족";
    g.materials-=c.materials; pay(g,c.res); it.enhance++; return null; }
  function equipItem(g,itemId){ const it=(g.lordInventory||[]).find(x=>x.id===itemId); if(!it)return"장비 없음";
    const cat=EQUIPMENT[it.key]; if(!cat)return"잘못된 장비";
    g.lord.equipment=g.lord.equipment||{}; g.lord.equipment[cat.slot]=itemId; return null; }
  function unequipItem(g,slot){ if(g.lord&&g.lord.equipment) g.lord.equipment[slot]=null; return null; }

  // ---- 턴 종료 (income → 생산 → 연구 → 병원 → AI → mp회복 → turn++ → 승패 → 퀘스트) ----
  function endTurn(g){
    if(g.over)return{enemyBattle:null};
    const inc=income(g); for(const r of RES)g.res[r]+=inc[r];
    g.starving = g.res.식량<0; if(g.starving) g.res.식량=0;   // 식량 고갈 → 이번 턴 생산 중단
    autoProduceTick(g); tickProduction(g);
    if(g.research.active){g.research.active.left--;if(g.research.active.left<=0){const k=g.research.active.key;g.research.done[k]=true;g.research.active=null;if(k==="행군술")g.armies.forEach(a=>{if(a.side==="P")a.maxMp=pBaseMp(g);});}}
    let built=null;
    if(g.castle.build){g.castle.build.left--;if(g.castle.build.left<=0){built=g.castle.build.label;completeBuild(g,g.castle.build);g.castle.build=null;}}   // 건설 진행
    let heal=(g.castle.econ["병원"]||0)*3;
    for(const u in g.castle.wounded){if(heal<=0)break;const take=Math.min(g.castle.wounded[u],heal);g.castle.wounded[u]-=take;if(g.castle.wounded[u]<=0)delete g.castle.wounded[u];g.castle.garrison[u]=(g.castle.garrison[u]||0)+take;heal-=take;}
    aiTurn(g);                       // AI 생산 + 원정대 목적지 지정
    rivalTick(g);                    // I1: 라이벌 왕국 국력 성장(방치 시 추월)
    const seasonEvent=seasonTick(g); // 시즌형 침공(B2) — 예고/도래
    const factionEvents=factionTick(g);   // 다수 세력(B1) — 야생에서 습격대 등장
    assignGatherOrders(g);          // H1: 자동채집 부대에 자원지 지정
    assignHuntOrders(g);            // G-A: 자동사냥 부대에 목표 지정(이동 전에 — 같은 틱에 출발)
    const mt=moveTick(g);            // 모든 부대(플레이어·AI) 한 틱 이동 + 접촉 전투(+세계이벤트)
    raidTick(g);
    g.turn++; tavernTick(g); processRespawns(g);
    const raidEvent=checkVictory(g);          // 턴 경계 이벤트(레이드 수성 완료 등)
    const worldEvent=mt.event||raidEvent;
    const questsCompleted=questTick(g);
    const msCompleted=milestoneTick(g);
    const dragonCompleted=dragonTick(g);
    lordTick(g);
    const rankEvent=rankSeasonTick(g);   // I3: 경쟁 시즌 마감 판정
    return {enemyBattle:mt.battle, built, questsCompleted, msCompleted, dragonCompleted, worldEvent, seasonEvent, factionEvents, rankEvent};
  }

  // ---- 오프라인 누적(A4/H2): 실시각 계산은 ui.js 몫(Date.now()) — 여긴 "틱 수"만 받아 진행.
  // 경제·생산·연구·건설 + PvE 자동사냥(H2) + 밖에 나간 부대 확률적 견제 전투(H2)까지 돌린다.
  // 단 대규모 전쟁(AI 원정대·시즌 침공)과 수도 공방은 오프라인에서 스킵 — 자리 비운 사이 왕국이 함락되진 않게(전쟁은 접속해서 즐기는 몫).
  const OFFLINE_MAX_TICKS=20000, OFF_HUNT_EVERY=3, OFF_HUNT_COOLDOWN=600, OFF_HARASS_CHANCE=0.00012;   // 사냥 판정 간격 + 부대당 사냥 쿨다운(장시간 방치 무한 파밍 방지, ~시간당 2~3회), 견제 발생 확률
  // 견제 습격대: 기회주의적 약탈대(맞춤 카운터 아님 → pickAIUnit(null)). 목표 부대 전력의 25~55%로 편성 →
  // 잘 갖춘 부대는 대체로 방어 성공, 구성이 나쁘거나 운 나쁠 때만 짐(간헐적 손실 — 방치 긴장감).
  function makeHarassForce(g,target){ const t=aiTierOf(g);
    let budget=compPower(target.comp)*(0.2+Math.random()*0.3), comp={}, guard=0;
    while(budget>0&&guard++<300){ const u=pickAIUnit(null), key=uk(u,t); comp[key]=(comp[key]||0)+1; budget-=unitScore(u,t)||30; }
    return {id:newId(g,"EH"),side:"E",node:target.node,name:"견제 습격대",comp,hero:null,role:"attack",target:target.node}; }
  function offlineStep(g,rep){
    const inc=income(g); for(const r of RES)g.res[r]+=inc[r];
    g.starving=g.res.식량<0; if(g.starving)g.res.식량=0;
    autoProduceTick(g); tickProduction(g); rivalTick(g);   // I1: 방치 중에도 라이벌 국력 성장(추월 긴장감)
    if(g.research.active){g.research.active.left--;if(g.research.active.left<=0){const k=g.research.active.key;g.research.done[k]=true;g.research.active=null;if(k==="행군술")g.armies.forEach(a=>{if(a.side==="P")a.maxMp=pBaseMp(g);});if(rep)rep.research.push(k);}}
    if(g.castle.build){g.castle.build.left--;if(g.castle.build.left<=0){if(rep)rep.built.push(g.castle.build.label);completeBuild(g,g.castle.build);g.castle.build=null;}}
    let heal=(g.castle.econ["병원"]||0)*3;
    for(const u in g.castle.wounded){if(heal<=0)break;const take=Math.min(g.castle.wounded[u],heal);g.castle.wounded[u]-=take;if(g.castle.wounded[u]<=0)delete g.castle.wounded[u];g.castle.garrison[u]=(g.castle.garrison[u]||0)+take;heal-=take;}
    // H2: 오프라인 사냥 — a.hunt 부대가 이길 만한 몬스터를 쿨다운 간격으로 처치(보상·부상은 온라인과 동일한 grantMonsterReward 경로).
    if(rep && g.turn%OFF_HUNT_EVERY===0){ rep._huntCd=rep._huntCd||{};
      for(const a of g.armies){ if(a.side!=="P"||!a.hunt||troops(a)<=0) continue;
        if(g.turn-(rep._huntCd[a.id]||-99999) < OFF_HUNT_COOLDOWN) continue;   // 쿨다운 — 무한 파밍 방지
        const m=nearestWinnableMonster(g,a); if(!m) continue;
        const s=resolveBattle(g,a,m,m.node);
        if(s.w==="A"){ rep._huntCd[a.id]=g.turn; rep.hunts++;
          if(s.reward)for(const r in s.reward)rep.huntRewards[r]=(rep.huntRewards[r]||0)+s.reward[r];
          for(const [k,lab] of [["xp","경험치"],["dragonScale","용린"],["materials","재료"],["blueprints","설계도"],["subdue","토벌"],["lordXp","군주경험치"]]) if(s[k])rep.huntRewards[lab]=(rep.huntRewards[lab]||0)+s[k]; } }
    }
    // H2: 오프라인 견제 — 밖에 나가있는(채집·사냥) 부대가 확률적으로 습격받음. 병력 구성으로 승패가 갈림(수도 수비대는 오프라인 안전).
    if(rep){ const out=g.armies.filter(a=>a.side==="P"&&a.node!=="P"&&troops(a)>0);
      if(out.length && Math.random()<OFF_HARASS_CHANCE*out.length){
        const target=out[Math.floor(Math.random()*out.length)];
        const s=resolveBattle(g,makeHarassForce(g,target),target,target.node);
        rep.skirmishes++;
        if(s.w==="B") rep.skirmishWins++;                          // 부대가 견제 격퇴
        else if(s.w==="A"){ rep.skirmishLosses++; rep.lostArmies++; } } }   // 부대 전멸
    g.turn++; tavernTick(g); processRespawns(g); questTick(g); milestoneTick(g); dragonTick(g); lordTick(g);
    if(rep){ const re=rankSeasonTick(g); if(re){ rep.seasonEnds=(rep.seasonEnds||0)+1; rep.lastTier=re.tier.name; } }   // I3: 오프라인에도 시즌 마감 진행
  }
  function offlineTick(g,ticks){ ticks=Math.max(0,Math.min(ticks|0,OFFLINE_MAX_TICKS));
    const rep={hunts:0,huntRewards:{},skirmishes:0,skirmishWins:0,skirmishLosses:0,lostArmies:0,built:[],research:[]};
    const res0={...g.res}, might0=computeMight(g), t0=g.turn, rank0=myRank(g);
    for(let i=0;i<ticks;i++) offlineStep(g,rep);
    rep.ticks=ticks; rep.turns=g.turn-t0; rep.mightGain=computeMight(g)-might0;
    rep.rankBefore=rank0; rep.rankAfter=myRank(g);   // I5: 방치 사이 대륙 순위 변동
    rep.resGain={}; for(const r of RES){ const d=Math.round(g.res[r]-res0[r]); if(d)rep.resGain[r]=d; }
    return rep; }

  API={ RES,GATHER_BASE,GATHER_HERO,ARMY_CAP,ECON_CAP,WOUND_RATE,HP_SCALE,UNIT_COST,CASTLE_UP_COST,BUILDINGS,ECON_BUILDINGS,UNIV_COST,GROUPS,STATNAME,AI,AI_UNIT_COST,RESEARCH,NODES,EDGES,ADJ,
    TIER_MAX,TIER_NAME,tierCap,uk,baseOf,tierOf,unitLabel,costOf,UNIT_BLD,bUpCost,maxTierFor,heroEffect,
    GRADE_BUFF,GRADE_GATHER,HERO_NAMES,HERO_TRAITS,heroTraits,TAVERN_COST,TAVERN_GAP,POOL_CAP,RECRUIT_COST,SPECIAL_COST,SUBDUE_REWARD,cityHero,cityHeroes,councilSlots,councilSum,
    ARMY_SLOTS_BASE,pArmyCount,armySlots,armySlotsMax,wallMaxLv,canAddArmy,UPKEEP_RATE,totalTroops,foodUpkeep,XP_REWARD,PROMOTE_COST,wallCost,fortifyWall,promoteHero,choosePromoteTrait,cancelPromote,armyCapFor,
    SIEGE_COST,craftSiege,
    computeMight,enemyMight,MILESTONES,milestoneTick,milestoneAt,offlineTick,monsterScale,FACTIONS,
    RIVALS,rivalTick,continentalRankings,myRank,threatMul,pickAggressorRival,damageRival,
    RANK_TIERS,RANK_SEASON_LEN,rankSeasonTick,addSeasonScore,tierForScore,rankTierIndex,
    DRAGON_STAGES,DRAGON_SKILLS,dragonTick,investDragonSkill,assignDragon,dragonLoc,
    LORD_TALENTS,EQUIPMENT,EQUIP_SLOTS,ENHANCE_MULT,lordTick,investTalent,craftEquipment,enhanceEquipment,equipItem,unequipItem,lordXPNeed,enhanceCost,
    MONSTERS,RESPAWN_DELAY,mkMonster,setMap,DEFAULT_MAP,ECON_MAX,econCost,buildDur,
    dijkstra,pathTo,newGame,findArmy,armiesAt,heroById,troops,canAfford,hasR,pBaseMp,buildRate,castleBaseIncome,econIncome,gatherOf,income,researchMods,
    compArr,hasCombatHero,resolveBattle,defendCastle,checkVictory,raidTick,
    MOVE_TICKS,UNIT_GROUP,armyTicksPerTile,armySpeed,orderMove,stopMove,enterTile,moveTick,setHunt,armyPower,assignHuntOrders,assignGatherOrders,setGather,rallyToDefense,
    produce,setAutoProduce,TRAIN_TICKS,construct,upgradeBuilding,levelUp,buildEcon,buildUniversity,startResearch,assignHero,draftAdjust,makeArmyFromDraft,deploy,deployTo,disband,
    buildTavern,rollCandidate,tavernTick,recruitHero,specialRecruit,
    playerCounterUnit,pickAIUnit,aiTurn,endTurn, QUESTS,questTick };
  if(typeof module!=="undefined"&&module.exports) module.exports=API; else global.Game=API;
})(typeof self!=="undefined"?self:this);
