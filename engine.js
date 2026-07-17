/* =====================================================================
   mini4x 전투 엔진 — 단일 캔노니컬 소스 (node + 브라우저 공용)
   - 규칙: 기획서 §7 (3병과×2클래스, 3열, 특수 확률, 특화 ×1.4,
           전열 피해 분산 ②, 창병 요격, 티어 배율)
   - node:    const E = require('./engine.js');  E.simulate(...)
   - 브라우저: <script>로 인라인되면 UNITS/simulate 등이 그대로 전역
   - 수치는 여기서만 고친다 → verify.js / 프로토타입이 함께 따라옴
   ===================================================================== */
'use strict';

const CONST = { FLOOR:0.15, FALLBACK:0.85, SPEC_MULT:1.4, SPLIT:0.6, COUNTER_MULT:2.0, HERO_BUFF:0.20,
  BATTLE_ROUNDS:40 };  // 게임·검증 공용 전투 라운드 캡. HP×1.0에서 전투는 ~30R에 결착 → 40R이면 무승부 소멸. game.js/verify.js가 이 값을 참조(드리프트 방지).

const UNITS = {
  "중갑보병":{hp:120,atk:8, df:12,proc:0.0, row:"front",kind:"tank",  desc:"방어 탱커"},
  "창병":   {hp:100,atk:12,df:6, proc:0.55,row:"front",kind:"spear", desc:"대기병 요격"},
  "장궁병": {hp:65, atk:16,df:3, proc:0.35,row:"back", kind:"gen_am",desc:"범용(앞+중)"},
  "석궁병": {hp:60, atk:16,df:3, proc:0.0, row:"back", kind:"spec",  desc:"대보병 특화"},
  "경기병": {hp:95, atk:17,df:5, proc:0.45,row:"mid",  kind:"gen_ab",desc:"범용(앞+뒤)"},
  "중기병": {hp:105,atk:12,df:8, proc:0.0, row:"mid",  kind:"spec",  desc:"대보병 돌격"},
  // ===== 몬스터 (PvE 전용, 밸런스 검증 대상 아님) =====
  "늑대":  {hp:70, atk:14,df:3, proc:0.0, row:"front",kind:"tank", desc:"기동형 야수", monster:true},
  "고블린":{hp:60, atk:10,df:4, proc:0.0, row:"front",kind:"tank", desc:"약한 몬스터", monster:true},
  "오크":  {hp:150,atk:16,df:10,proc:0.0, row:"front",kind:"tank", desc:"강력한 전위", monster:true},
  "하피":  {hp:70, atk:17,df:3, proc:0.0, row:"back", kind:"tank", desc:"후방 비행 위협", monster:true},
  "오우거":{hp:280,atk:26,df:12,proc:0.0, row:"front",kind:"tank", desc:"거대 보스", monster:true},
};
const NAMES = Object.keys(UNITS);
const ROWS  = ["front","mid","back"];
const ROWKO = {front:"앞 · 보병", mid:"중 · 기병", back:"뒤 · 궁병"};

const tierMult = t => 1 + (t-1)*0.15;
const dmg = (a,d) => Math.max(a*CONST.FLOOR, a-d);

function makeArmy(comp, hero, mods){    // mods: {유닛명:{atk,df,hp}} 병종별 스탯 배율(연구)
  const rows = {front:[], mid:[], back:[]};
  // hero: true → +HERO_BUFF, 숫자 → 그 비율만큼 버프(연구·성벽 등 합산용), false/0 → 없음
  const buff = hero===true ? CONST.HERO_BUFF : (typeof hero==="number" ? hero : 0);
  for(const c of comp){
    if(!c || c.count<=0) continue;
    const u=UNITS[c.name], tm=tierMult(c.tier||1), hb=1+buff;
    const m = mods && mods[c.name] ? mods[c.name] : null;
    const st={name:c.name,row:u.row,kind:u.kind,proc:u.proc,tier:c.tier||1,
      atk:u.atk*tm*hb*((m&&m.atk)||1), df:u.df*tm*hb*((m&&m.df)||1), maxhp:u.hp*tm*hb*((m&&m.hp)||1), init:c.count};
    st.pool=st.maxhp*c.count;
    rows[u.row].push(st);
  }
  return rows;
}
const aliveCount = s => s.pool>0 ? Math.ceil(s.pool/s.maxhp) : 0;
const dead = s => s.pool<=0;
function frontmost(r){ for(const x of ROWS){ const L=r[x].filter(s=>!dead(s)); if(L.length) return L[0]; } return null; }
function rowTarget(r,x){ const L=r[x].filter(s=>!dead(s)); return L.length?L[0]:null; }
function spearsFront(r){ return r.front.filter(s=>!dead(s)&&s.kind==="spear"); }
function allStacks(r){ return [...r.front,...r.mid,...r.back].filter(s=>!dead(s)); }
function wiped(r){ return frontmost(r)===null; }

function planAttacks(att, enemy, ev){
  const A=[];
  for(const s of allStacks(att)){
    const a=aliveCount(s), base=s.atk, k=s.kind;
    if(a<=0) continue;
    if(k==="tank"||k==="spear"){ const t=frontmost(enemy); if(t) A.push([t,base,a,s]); }
    else if(k==="spec"){ let t=rowTarget(enemy,"front");
      if(t) A.push([t,base*CONST.SPEC_MULT,a,s]);
      else { t=frontmost(enemy); if(t) A.push([t,base*CONST.FALLBACK,a,s]); } }
    else { const deep = k==="gen_am"?"mid":"back";
      if(Math.random()<s.proc){ const d=rowTarget(enemy,deep);
        if(d){ const ft=frontmost(enemy); A.push([ft,base*CONST.SPLIT,a,s]); A.push([d,base*CONST.SPLIT,a,s]); if(ev) ev.proc++; }
        else { const t=frontmost(enemy); if(t) A.push([t,base*CONST.FALLBACK,a,s]); } }
      else { const t=frontmost(enemy); if(t) A.push([t,base,a,s]); } }
  }
  return A;
}
function resolveRound(A,B,ev){
  const pa=planAttacks(A,B,ev), pb=planAttacks(B,A,ev);
  const dm=new Map(), add=(s,v)=>dm.set(s,(dm.get(s)||0)+v);
  function tally(plan, def){
    for(const [t,ap,cnt,src] of plan){
      if(!t||dead(t)) continue;
      const amount = cnt*dmg(ap,t.df);
      if(t.row==="front"){                       // ② 전열 피해 분산
        const fs=def.front.filter(s=>!dead(s));
        let tot=fs.reduce((x,s)=>x+aliveCount(s),0);
        if(tot<=0) add(t,amount); else for(const s of fs) add(s, amount*aliveCount(s)/tot);
      } else add(t, amount);
      if(src.row==="mid" && t.row==="front"){     // 창병 요격
        for(const sp of spearsFront(def)){
          let nc=0, eng=aliveCount(sp);
          for(let i=0;i<eng;i++) if(Math.random()<sp.proc) nc++;
          if(nc>0){ add(src, nc*dmg(sp.atk*CONST.COUNTER_MULT, src.df)); if(ev) ev.counter+=nc; }
        }
      }
    }
  }
  tally(pa,B); tally(pb,A);
  for(const [s,v] of dm) s.pool-=v;
}
function snapshot(r){
  const live=allStacks(r).map(s=>({name:s.name,row:s.row,tier:s.tier,alive:aliveCount(s),init:s.init}));
  const gone=[...r.front,...r.mid,...r.back].filter(s=>dead(s)).map(s=>({name:s.name,row:s.row,tier:s.tier,alive:0,init:s.init}));
  return live.concat(gone);
}

/* 관전용: 타임라인 프레임 포함 */
function simulate(compA,heroA,compB,heroB,maxRounds,modsA,modsB){
  const A=makeArmy(compA,heroA,modsA), B=makeArmy(compB,heroB,modsB);
  const hp=r=>allStacks(r).reduce((x,s)=>x+s.pool,0);
  const h0A=hp(A), h0B=hp(B);
  const frames=[{round:0,A:snapshot(A),B:snapshot(B),log:"전투 개시!"}];
  let r=0;
  for(let i=0;i<maxRounds;i++){
    if(wiped(A)||wiped(B)) break;
    const ev={proc:0,counter:0};
    const preA=allStacks(A).reduce((x,s)=>x+aliveCount(s),0), preB=allStacks(B).reduce((x,s)=>x+aliveCount(s),0);
    resolveRound(A,B,ev); r++;
    const postA=allStacks(A).reduce((x,s)=>x+aliveCount(s),0), postB=allStacks(B).reduce((x,s)=>x+aliveCount(s),0);
    let log=`R${r}: 아군 -${preA-postA}, 적 -${preB-postB}`;
    if(ev.proc) log+=` · 특수 ${ev.proc}회`;
    if(ev.counter) log+=` · 창병 요격 ${ev.counter}`;
    frames.push({round:r,A:snapshot(A),B:snapshot(B),log});
  }
  let w;
  if(wiped(A)&&!wiped(B)) w="B";
  else if(wiped(B)&&!wiped(A)) w="A";
  else if(wiped(A)&&wiped(B)) w="draw";
  else { const fa=h0A?hp(A)/h0A:0, fb=h0B?hp(B)/h0B:0; w=Math.abs(fa-fb)<0.05?"draw":(fa>fb?"A":"B"); }
  return {frames, w, rounds:r,
    survA:allStacks(A).reduce((x,s)=>x+aliveCount(s),0),
    survB:allStacks(B).reduce((x,s)=>x+aliveCount(s),0)};
}
/* 검증용: 가벼운 승패 + 승률 */
function battle(compA,heroA,compB,heroB,maxRounds){ return simulate(compA,heroA,compB,heroB,maxRounds).w; }
function winrate(compA,compB,opts){
  opts=opts||{}; const t=opts.trials||500, mr=opts.maxRounds||CONST.BATTLE_ROUNDS, hA=!!opts.heroA, hB=!!opts.heroB;
  let w=0; for(let i=0;i<t;i++) if(battle(compA,hA,compB,hB,mr)==="A") w++; return w/t;
}

const API = { CONST, UNITS, NAMES, ROWS, ROWKO, tierMult, dmg, makeArmy, simulate, battle, winrate };
if (typeof module !== "undefined" && module.exports) module.exports = API;   // node
