/* =====================================================================
   mini4x 밸런스 자동 검증 하네스
   실행:  node verify.js
   engine.js 의 수치를 고친 뒤 이걸 돌리면 삼각·카운터가 유지되는지 즉시 확인.
   ===================================================================== */
const E = require("./engine.js");
const { winrate, simulate } = E;
const NAMES = E.NAMES.filter(n => !E.UNITS[n].monster); // 코어 6종만 밸런스 검증

let pass=0, fail=0;
function check(name, cond, detail){
  (cond?pass++:fail++);
  console.log(`  ${cond?"✅ PASS":"❌ FAIL"}  ${name}${detail?"  — "+detail:""}`);
  return cond;
}
const c1 = n => [{name:n,count:20,tier:1}];

console.log("\n[1] 병과 상성 삼각 (각 매치업 500회, 기대 A>0.5)");
const BO=[{name:"중갑보병",count:8,tier:1},{name:"창병",count:12,tier:1},{name:"장궁병",count:4,tier:1}];
const GI=[{name:"중갑보병",count:4,tier:1},{name:"경기병",count:12,tier:1},{name:"중기병",count:8,tier:1}];
const GG=[{name:"중갑보병",count:8,tier:1},{name:"장궁병",count:8,tier:1},{name:"석궁병",count:8,tier:1}];
const t1=winrate(BO,GI), t2=winrate(GI,GG), t3=winrate(GG,BO);
check("보병군 > 기병군", t1>0.5, t1.toFixed(2));
check("기병군 > 궁병군", t2>0.5, t2.toFixed(2));
check("궁병군 > 보병군", t3>0.5, t3.toFixed(2));

console.log("\n[2] 지배 유닛 없음 (모든 유닛이 최소 1개 카운터 보유)");
for(const a of NAMES){
  let losses=0, worst=1;
  for(const b of NAMES){ if(a===b) continue;
    const wr=winrate(c1(a),c1(b),{trials:300});
    if(wr<0.5) losses++; worst=Math.min(worst,wr);
  }
  check(`${a} 는 카운터 존재`, losses>=1, `최저 승률 ${worst.toFixed(2)} · 패배 상대 ${losses}종`);
}

console.log("\n[3] 적응형 편성 보상 (기병 적에게 창병 투입 시 승률 급상승)");
const cav=[{name:"중갑보병",count:6,tier:1},{name:"경기병",count:10,tier:1},{name:"중기병",count:8,tier:1}];
const noSpear=[{name:"중갑보병",count:16,tier:1},{name:"석궁병",count:8,tier:1}];
const wSpear=[{name:"중갑보병",count:6,tier:1},{name:"창병",count:10,tier:1},{name:"석궁병",count:8,tier:1}];
const wn=winrate(noSpear,cav), ws=winrate(wSpear,cav);
check("창병 투입이 승률을 크게 올림", ws-wn>0.4, `창병無 ${wn.toFixed(2)} → 창병有 ${ws.toFixed(2)}`);

console.log("\n[4] 전열 피해 분산(②): 보호받는 창병도 피해를 입음 (공짜 요격 방지)");
// 지속 교전에서 창병이 죽는지(마지막 프레임 창병 alive < init) 표본 측정
const protA=[{name:"중갑보병",count:6,tier:1},{name:"창병",count:10,tier:1}];
const protB=[{name:"중기병",count:20,tier:1}];
let sumLoss=0, N=200;
for(let i=0;i<N;i++){
  const last=simulate(protA,false,protB,false,100).frames.slice(-1)[0];
  const sp=last.A.find(s=>s.name==="창병");
  if(sp) sumLoss += (sp.init-sp.alive)/sp.init;
}
const avgLoss=100*sumLoss/N;
check("창병이 유의미하게 피해를 받음", avgLoss>10, `평균 창병 손실 ${avgLoss.toFixed(0)}%`);

console.log("\n[5] 티어 효과 (고티어가 저티어를 압도)");
const t1army=BO, t3army=BO.map(x=>({...x,tier:3}));
const lowVsHigh=winrate(t1army,t3army);
check("T1 이 T3 에 크게 밀림", lowVsHigh<0.2, `T1 승률 ${lowVsHigh.toFixed(2)}`);

console.log(`\n===== 결과: ${pass} PASS / ${fail} FAIL =====`);
if (typeof process!=="undefined") process.exit(fail?1:0);
