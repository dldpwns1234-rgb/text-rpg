/* =====================================================================
   mini4x 공유 UI — 자원바·성 내정 패널·이동/전투·저장/불러오기·턴 처리
   - 노드판(app_economy)·타일판(app_tilemap)이 이 하나를 공유(단일 UI 소스).
   - 맵별로 다른 부분(COORDS·renderMap)은 각 템플릿 head 에 있음.
   - build.js 가 //__UI__ 자리에 인라인.
   ===================================================================== */
// E2: 몬스터별 전투 역할 힌트(engine.js kind/proc 재배정과 짝 — 순수 표시용, 로직 없음).
const MONSTER_ROLE={하피:"기습형",오우거:"돌격형"};
function renderResBar(){
  const inc=income();
  document.getElementById('resbar').innerHTML=RES.map(r=>{
    const v=inc[r];
    return `<span class="res">${r} <b>${state.res[r]}</b> <span class="inc" style="${v<0?'color:#fca5a5':''}">${v>=0?'+':''}${v}</span></span>`;
  }).join("")
    +`<span class="res" style="border-color:#c4b5fd;color:#c4b5fd">🏵 토벌 <b>${state.subdue||0}</b></span>`
    +`<span class="res" style="border-color:#fbbf24;color:#fbbf24">📜 경험치 <b>${state.xpItems||0}</b></span>`
    +`<span class="res" style="border-color:var(--blue);color:var(--blue)">⚔ 국력 <b>${Game.computeMight(state)}</b> <span class="k">(적 ${Game.enemyMight(state)})</span></span>`
    +(Game.myRank?`<span class="res" style="border-color:var(--gold);color:var(--gold)">🏆 대륙 <b>#${Game.myRank(state)}</b><span class="k">/${(state.rivals?state.rivals.length:0)+1}</span></span>`:"")
    +`<span class="res" style="border-color:#c084fc;color:#c084fc">🐉 용린 <b>${state.dragonScale||0}</b></span>`;
  document.getElementById('turn').textContent=state.turn;
}
// 📱 모바일 하단 퀵바(3칸) — 유저 피드백: "탭해서 펼치기/접기"뿐인 손잡이 대신, 목표·내정·선택 대상을 바로 보여주고 탭하면 그 화면으로.
// 데스크톱은 .sheet-handle이 display:none이라 무해(렌더는 하되 안 보임).
function renderQuickBar(){
  const qq=document.getElementById('qcQuest'), qc=document.getElementById('qcCastle'), qd=document.getElementById('qcDeploy'), qs=document.getElementById('qcSel');
  if(!qq) return;   // 구버전 템플릿(마크업 없음) 방어
  const Q=Game.QUESTS, q=state.quests||{idx:0};
  qq.textContent = (Q&&q.idx<Q.length) ? `📋 목표 ${q.idx+1}/${Q.length}` : `🏆 대륙 #${Game.myRank?Game.myRank(state):"?"}`;
  qc.textContent = `🏰 내정 Lv.${state.castle.level}`;
  if(qd) qd.textContent = `⚔ 부대출전 ${Game.pArmyCount?Game.pArmyCount(state):""}`.trim();
  const s=state.selected;
  qs.textContent = !s ? "🗺 지도에서 선택"
    : s.kind==="army" ? `⚔ ${A(s.id)?.name||"부대"}`
    : `📍 ${NODES[s.id]?.name||"위치"}`;
}
// 🏅 다음 마일스톤(A2) — 국력 진행바. 전부 달성하면 숨김.
function renderMilestone(){
  const ms=state.milestones||{idx:0};
  const cur=Game.milestoneAt(ms.idx), might=Game.computeMight(state), pct=Math.min(100,Math.round(100*might/cur.need));
  const rw=cur.reward&&Object.keys(cur.reward).length?Object.entries(cur.reward).map(([r,v])=>`${r[0]}+${v}`).join(" "):"";
  return `<div style="background:var(--bg);border:1px solid var(--blue);border-radius:10px;padding:8px 10px;margin-bottom:10px">
    <div style="font-size:11px;color:var(--blue)">🏅 다음 마일스톤 <b>${cur.name}</b> <span class="k">(국력 ${might}/${cur.need})</span></div>
    <div class="k" style="font-size:12px;margin-top:2px">${cur.desc}</div>
    <div style="height:5px;background:var(--line);border-radius:3px;margin-top:5px"><div style="height:100%;width:${pct}%;background:var(--blue);border-radius:3px"></div></div>
    ${rw?`<div style="font-size:11px;color:var(--green);margin-top:3px">✦ 보상 ${rw}</div>`:""}
  </div>`;
}
// 🗓 시즌형 침공(B2) — 다음 대침공까지 남은 턴. 예고 상태면 붉게 강조.
function renderSeason(){
  const s=state.season; if(!s) return "";
  const left=Math.max(0,s.next-state.turn);
  const hint=s.warned&&s.previewUnit?` · 예상 주력 <b>${s.previewUnit}</b>`:"";
  // G-F: 예고 중 + 나가있는 부대가 있으면 "전군 소집" 버튼 — 사냥 나간 부대를 불러 방어 준비.
  const away=state.armies.filter(a=>a.side==="P"&&a.node!=="P").length;
  const rally=(s.warned&&away>0)?`<button class="minibtn" id="rallyBtn" style="margin-top:6px;border-color:var(--red);color:#fca5a5">⚔ 전군 소집 (${away}개 부대 귀환)</button>`:"";
  return `<div style="background:var(--bg);border:1px solid ${s.warned?'var(--red)':'var(--line)'};border-radius:10px;padding:8px 10px;margin-bottom:10px">
    <div style="font-size:11px;color:${s.warned?'#fca5a5':'#94a3b8'}">${s.warned?"⚠ 대침공 예고!":"🗓 다음 시즌"} <b>${s.count}차</b> <span class="k">— ${left}턴 후 도착</span>${hint}</div>
    ${rally}
  </div>`;
}
// 🏴 알려진 습격 세력 — 이름·주력 병종을 상시 표시(정보 없이 오는 위협이 아니게).
function renderFactionInfo(){
  if(!Game.FACTIONS||!Game.FACTIONS.length) return "";
  return `<div style="font-size:10px;color:#64748b;margin:-4px 0 10px 2px">🏴 알려진 습격 세력: ${Game.FACTIONS.map(f=>`${f.name}(${f.units.join("·")}${f.prey?" · 야외 부대 노림":""})`).join(" · ")}</div>`;
}
// 🎯 온보딩 퀘스트 — 현재 목표를 패널 최상단에 상시 표시(선택 상태 무관). 데이터는 Game.QUESTS.
function renderQuests(){
  const Q=Game.QUESTS, q=state.quests||{idx:0};
  if(!Q||q.idx>=Q.length) return "";   // 전부 완료 → 숨김
  const cur=Q[q.idx];
  const rw=[cur.reward?Object.entries(cur.reward).map(([r,v])=>`${r[0]}+${v}`).join(" "):"",
    cur.dragonScale?`용린+${cur.dragonScale}`:"", cur.xp?`경험치+${cur.xp}`:""].filter(Boolean).join(" ");
  return `<div style="background:var(--bg);border:1px solid var(--gold);border-radius:10px;padding:8px 10px;margin-bottom:10px">
    <div style="font-size:11px;color:var(--gold)">🎯 목표 <b>${q.idx+1} / ${Q.length}</b></div>
    <div style="font-weight:700;margin:2px 0">${cur.name}</div>
    <div class="k" style="font-size:12px">${cur.desc}</div>
    ${rw?`<div style="font-size:11px;color:var(--green);margin-top:3px">✦ 보상 ${rw}</div>`:""}
  </div>`;
}
// 🏆 대륙 랭킹(I1) — 내 국력 vs 라이벌 왕국. 방치하면 추월당하고 꺾으면 순위↑.
function renderRankings(){
  if(!Game.continentalRankings) return "";
  const list=Game.continentalRankings(state), max=Math.max(1,...list.map(x=>x.might));
  const rows=list.map((x,i)=>{
    const w=Math.round(100*x.might/max), col=x.me?"var(--gold)":"#94a3b8";
    return `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">
      <span style="width:16px;text-align:right;color:${col};font-size:11px">${i+1}</span>
      <span style="flex:1;min-width:0">
        <span style="font-size:11px;color:${col}">${x.me?"👑 ":""}${x.name}${x.bias?` <span class="k">·${x.bias}</span>`:""} <b>${x.might}</b></span>
        <div style="height:4px;background:var(--line);border-radius:2px;margin-top:1px"><div style="height:100%;width:${w}%;background:${x.me?'var(--gold)':'#475569'};border-radius:2px"></div></div>
      </span></div>`;
  }).join("");
  return `<div style="margin-bottom:8px">
    <div style="font-size:11px;color:var(--gold);margin-bottom:4px">🏆 대륙 랭킹 <span class="k">— 국력으로 겨루는 왕국들</span></div>
    ${rows}
  </div>`;
}
// 🏆 경쟁 시즌(I3) — 현재 시즌 점수·티어·남은 턴. 처치·방어·라이벌 격파로 점수를 쌓아 시즌 종료 시 랭크 보상.
function renderRankSeason(){
  const rs=state.rankSeason; if(!rs||!Game.tierForScore) return "";
  const tier=Game.tierForScore(rs.score||0), tiers=Game.RANK_TIERS, idx=tiers.findIndex(x=>x.id===tier.id), next=tiers[idx+1];
  const left=Math.max(0, rs.next-state.turn), score=Math.round(rs.score||0);
  const pct=next?Math.min(100,Math.round(100*(score-tier.min)/(next.min-tier.min))):100;
  const toNext=next?`${next.name}까지 ${Math.max(0,next.min-score)}점`:"최고 티어 도달";
  return `<div>
    <div style="font-size:11px;color:#c084fc">🏆 경쟁 시즌 <b>${rs.num}</b> · 현재 <b>${tier.name}</b> <span class="k">(${score}점 · ${left}턴 남음)</span></div>
    <div style="height:5px;background:var(--line);border-radius:3px;margin-top:5px"><div style="height:100%;width:${pct}%;background:#c084fc;border-radius:3px"></div></div>
    <div class="k" style="font-size:11px;margin-top:3px">${toNext} · 처치·방어·라이벌 격파로 점수↑</div>
  </div>`;
}
// 🏆 경쟁 요약(랭킹+시즌 통합, 기본 접힘) — I1~I3로 아코디언이 길어져 모바일 스크롤 부담 → 한 줄 요약+접이식으로.
function renderCompetition(){
  if(!Game.continentalRankings) return "";
  const open=state.compOpen===true;
  const rank=Game.myRank(state), total=(state.rivals?state.rivals.length:0)+1;
  const rs=state.rankSeason, tier=rs&&Game.tierForScore?Game.tierForScore(rs.score||0).name:"";
  return `<div style="background:var(--bg);border:1px solid var(--gold);border-radius:10px;padding:8px 10px;margin-bottom:10px">
    <div id="compToggle" style="cursor:pointer;font-size:11px;color:var(--gold);display:flex;justify-content:space-between;align-items:center">
      <span>🏆 대륙 #${rank}/${total} · 시즌${rs?rs.num:1} ${tier}</span><span>${open?"▲":"▼"}</span>
    </div>
    ${open?`<div style="margin-top:6px">${renderRankings()}${renderRankSeason()}</div>`:""}
  </div>`;
}
// ℹ️ 게임 설명 — 원래 지도 아래 항상 떠 있던 문단. 유저 피드백: 화면 공간을 잡아먹는다 → 접이식으로 이전(기본 접힘).
function renderAbout(){
  const open=state.aboutOpen===true;
  return `<div style="margin-bottom:10px">
    <div id="aboutToggle" style="cursor:pointer;font-size:11px;color:var(--dim);display:flex;justify-content:space-between;align-items:center">
      <span>ℹ️ 게임 설명</span><span>${open?"▲":"▼"}</span>
    </div>
    ${open?`<div class="k" style="font-size:12px;margin-top:4px">채집·생산으로 국력을 키우는 <b>지속형 왕국</b>. 적 성 함락·고대성 레이드는 게임오버가 아니라 보상+마일스톤으로 이어지는 사건 — 왕국은 계속 성장합니다. 부대가 적과 만나면 전투 엔진으로 교전하고, 성 수비는 성벽 보정을 받습니다.</div>`:""}
  </div>`;
}
// 📋 현황 아코디언(모바일 스크롤 절감) — 퀘스트/마일스톤/경쟁(랭킹+시즌)/시즌침공/세력정보/설명을 한 덩어리로 접고 펼침.
function renderInfoAccordion(){
  const body=renderQuests()+renderMilestone()+renderCompetition()+renderSeason()+renderFactionInfo()+renderAbout();
  if(!body) return "";
  const open=state.infoOpen!==false;
  return `<div style="margin-bottom:4px">
    <div id="infoToggle" style="cursor:pointer;font-size:12px;color:var(--gold);display:flex;justify-content:space-between;align-items:center;padding:2px 0 6px">
      <span>📋 현황 (목표·마일스톤·위협)</span><span>${open?"▲":"▼"}</span>
    </div>
    ${open?body:""}
  </div>`;
}
// 유저 피드백: 지도에서 타일/부대를 탭할 때마다 시트가 78vh로 펼쳐져 지도를 가림 → 탭만으로는 더 이상 자동 펼침 없음(접힌 18vh 안에서
// #panelBody가 자체 스크롤로 갱신됨). 큰 화면이 필요하면 퀵바(qcQuest/qcCastle)나 qcSel 토글을 사용자가 직접 눌러야 함(그쪽은 openSheet 유지).
function renderPanel(){
  let p=document.getElementById('panelBody'); const s=state.selected;
  // 유저 피드백: "목표·마일스톤·위협 현황판이 문제" — 뭔가 선택돼 있으면 그 화면이 우선이라, 아무것도 선택 안 됐을 때만 현황 아코디언 표시.
  // 목표/마일스톤/위협은 여전히 qcQuest 퀵바(selected=null로 세팅 후 열림)로 언제든 접근 가능.
  let h=s?"":renderInfoAccordion();
  // 유저 요청: 내정이 지도 옆(패널)에 끼어있지 않고, 실제 아발론처럼 별도의 전체화면으로 분리.
  // #castleScreen이 있으면(신버전 템플릿) 성 내정 콘텐츠를 거기로 돌린다 — 아래 로직/바인딩은 전부 동일, 변수 p가 가리키는 대상만 바뀜.
  const inCastle = s?.kind==="node" && NODES[s.id] && NODES[s.id].type==="castle" && NODES[s.id].owner==="P";
  const castleScreen=document.getElementById('castleScreen');
  if(castleScreen){
    castleScreen.classList.toggle('open', inCastle);
    // 유저 요청: 상단바(자원/저장/재생/한틱)는 내정 화면에서도 계속 보이고 눌려야 함 — .top이 castle-screen보다
    // 위 z-index로 남아있으므로(CSS), 겹치지 않게 castle-screen을 상단바 실측 높이만큼 아래로 내림(모바일 줄바꿈 등 가변 높이 대응).
    if(inCastle){ const topEl=document.querySelector('.top'); castleScreen.style.top=(topEl?topEl.getBoundingClientRect().height:0)+"px"; }
  }
  if(inCastle){
    const csBody=document.getElementById('castleScreenBody'); if(csBody) p=csBody;
    const c=state.castle, br=buildRate();
    const tab=state.castleTab||"건물"; const busy=!!c.build;
    // 유저 피드백: 헤더가 탭과 무관하게 항상 "성 내정"이라, 출전 탭으로 이미 전환됐는데도 "계속 내정 패널만 뜬다"고 오해하기 쉬움 → 탭별 아이콘/이름 반영.
    const CTAB_ICON={건물:"🏰",연구:"📚",선술집:"🍺",출전:"🚩",편성:"⭐",군주:"👑"};
    h+=`<h3>${CTAB_ICON[tab]||"🏰"} ${tab==="건물"?"성 내정":tab} <span class="k">Lv.${c.level}</span></h3>`;
    const upkeep=Game.foodUpkeep(state), tt=Game.totalTroops(state);
    h+=`<div class="k">생산 ${br}/턴${br>1?' <span style="color:var(--gold)">(내정영웅)</span>':''} · 부대 ${Game.pArmyCount(state)}/${Game.armySlots(state)} · 병력 ${tt}${c.wall?` · 🧱${c.wall}`:""}</div>`;
    if(upkeep>0) h+=`<div class="k" style="font-size:11px${state.starving?';color:#fca5a5':''}">🍞 식량 유지비 ${upkeep}/턴${state.starving?" · ⚠ 고갈! 생산 중단 — 농장 증설/병력 감축":""}</div>`;
    { const qAll=Object.values(c.queue).flat(); // F1: 건물별 대기열 합계(상세는 건물 탭에 병영별로 표시)
      h+=`<div class="queue" style="font-size:11px">대기열(${qAll.length}): ${qAll.length?qAll.map(unitLabel).join(", "):"—"}</div>`; }
    {const wnd=state.castle.wounded, wTot=Object.values(wnd).reduce((x,y)=>x+y,0);
     if(wTot>0) h+=`<div style="color:#fca5a5;font-size:12px">🩹 부상자 ${wTot} <span class="k">(병원 ${(state.castle.econ["병원"]||0)*3}/턴 치료)</span></div>`;}
    // 탭 바 — 유저 요청: 글자 탭 한 줄 대신 아이콘 그리드(전체화면이라 공간 여유 있음)
    h+=`<div class="ctabgrid">`;
    for(const t of ["건물","연구","선술집","출전","편성","군주"]) h+=`<button class="ctabcell" data-ctab="${t}" style="${tab===t?'border-color:var(--gold);color:var(--gold);':''}"><span class="ci">${CTAB_ICON[t]}</span><span class="cl">${t}</span></button>`;
    h+=`</div>`;
    if(tab==="건물"){
    if(busy){const pct=Math.round(100*(c.build.total-c.build.left)/c.build.total);
      h+=`<div style="background:var(--bg);border:1px solid var(--gold);border-radius:8px;padding:6px 8px;margin-bottom:8px;font-size:12px">
        🏗 건설 중: <b style="color:var(--gold)">${c.build.label}</b> — ${c.build.left}턴 남음
        <div style="height:5px;background:var(--line);border-radius:3px;margin-top:4px"><div style="height:100%;width:${pct}%;background:var(--gold);border-radius:3px"></div></div></div>`;}
    { const cuc=Game.castleUpCost(c.level);
      h+=`<div class="prodrow"><span class="nm">성 레벨업 <span class="k">Lv.${c.level} · ${Game.buildDur("castle",c.level)}턴</span></span>
      <span class="cost">목${cuc.목재} 석${cuc.석재} 철${cuc.철}</span>
      <button class="minibtn" id="levelup" ${canAfford(cuc)&&!busy?"":"disabled"}>▲</button></div>
      <div class="k" style="font-size:11px">→ 기본 수입 +1씩, 생산 속도 +1 · 부대 상한: Lv3→4, Lv5→5 (최대 5)</div><hr>`; }
    { const wl=c.wall||0, wc=Game.wallCost(wl), wMax=Game.wallMaxLv(state);
      h+=`<div class="prodrow"><span class="nm">🧱 성벽 보강 <span class="k">Lv.${wl}/${wMax} · 수성 +${Math.min(wMax*5,wl*5)}% · ${Game.buildDur("wall",wl)}턴</span></span>
        <span class="cost">${Object.entries(wc).map(([r,v])=>r[0]+v).join(" ")}</span>
        <button class="minibtn" data-wall="1" ${wl<wMax&&canAfford(wc)&&!busy?"":"disabled"}>▲</button></div><hr>`; }
    h+=`<div class="k" style="margin-bottom:4px">생산 건물 <span class="k">(탭해 열기 · 레벨 = 최대 티어)</span></div>`;
    // 유저 요청: 세로 리스트 대신 2열 카드 그리드(전체화면 안이라 넓게 써도 됨)
    h+=`<div class="bldgrid">`;
    for(const key in BUILDINGS){const b=BUILDINGS[key];
      if(c.buildings.includes(key)){
        const open=c.openBuilding===key, lv=c.blevel[key]||1;
        const cap=Game.tierCap(state);
        h+=`<div class="bldcard${open?' open':''}">
          <button class="bldcard-head" data-bld="${key}"><span class="bi">${b.icon}</span><span class="bn">${key}</span><span class="k" style="font-size:10px">Lv.${lv} · T${lv}</span></button>`;
        if(lv<cap){const uc=Game.bUpCost(key,lv);const cs=Object.entries(uc).map(([r,v])=>`${r[0]}${v}`).join(" ");
          h+=`<div class="k" style="font-size:10px;margin:3px 0">${cs}·${Game.buildDur("bld",lv)}T</div>
            <button class="minibtn bldcard-btn" data-bup="${key}" ${canAfford(uc)&&!busy?"":"disabled"}>▲T${lv+1}</button>`;
        } else h+=`<div class="k" style="font-size:10px;margin:3px 0">최대 T${cap}${cap<TIER_MAX?" (마일스톤 필요)":""}</div>`;
        // F1: 병영마다 독립 큐 — 이 건물 대기열만 따로 표시(동시 훈련 체감)
        const bq=c.queue[key]||[];
        if(bq.length) h+=`<div class="k" style="font-size:9px">⏳ ${bq.length}개 대기</div>`;
        h+=`</div>`;
      } else {
        const cs=Object.entries(b.cost).map(([r,v])=>`${r[0]}${v}`).join(" ");
        h+=`<div class="bldcard">
          <div class="bldcard-head" style="opacity:.7"><span class="bi">${b.icon}</span><span class="bn">${key}</span><span class="k" style="font-size:10px">미건설</span></div>
          <div class="k" style="font-size:10px;margin:3px 0">${cs}·${Game.buildDur("construct")}T</div>
          <button class="minibtn bldcard-btn" data-construct="${key}" ${canAfford(b.cost)&&!busy?"":"disabled"}>건설</button>
        </div>`;
      }
    }
    h+=`</div>`;
    const ob=c.openBuilding;
    if(ob && c.buildings.includes(ob)){
      const lv=c.blevel[ob]||1;
      h+=`<hr><div class="k" style="margin-bottom:4px">${BUILDINGS[ob].icon} ${ob} — 병종·티어·수량 <span class="k">(최대 T${lv} · ⏱=훈련시간, 고티어일수록 오래)</span></div>`;
      const ap=c.autoProduce&&c.autoProduce[ob];
      for(const u of BUILDINGS[ob].units){
        const selT=Math.min(lv,state.prodTier[u]||1);
        let topts="";
        for(let t=1;t<=lv;t++){const cc=costOf(u,t);const cs=Object.entries(cc).map(([r,v])=>`${r[0]}${v}`).join("");topts+=`<option value="${t}" ${t===selT?"selected":""}>T${t} ${TIER_NAME[t]} (${cs}·⏱${Game.TRAIN_TICKS[t]})</option>`;}
        const autoOn=ap&&ap.u===u;   // G-C: 이 병종이 반복생산 대상인지
        h+=`<div class="prodrow"><span class="nm">${u}${autoOn?` <span style="color:var(--green);font-size:10px">🔁T${ap.tier}</span>`:""}</span>
          <select id="tier_${u}" style="background:var(--bg);color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:3px;font-size:11px">${topts}</select>
          <input type="number" id="qty_${u}" value="1" min="1" style="width:36px;background:var(--bg);color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:3px;font-size:12px;text-align:center">
          <button class="minibtn" data-make="${u}">생산</button>
          <button class="minibtn" data-auto="${u}" style="${autoOn?'background:var(--line);border-color:var(--green);color:var(--green)':''}" title="반복 생산">🔁</button></div>`;
      }
      if(ap){
        // 유저 피드백: "T3 눌렀는데 T1이 생산되는 것 같다" — 티어 전환 전 이미 대기열에 있던(자원 지불 완료) 구 티어 주문이
        // 먼저 소진돼야 새 티어가 시작됨(정상 동작, 자원 손실 방지). 화면에 안내가 없어 혼란스러웠으므로 명시.
        const key=Game.uk(ap.u,ap.tier), bq=c.queue[ob]||[], hasOld=bq.some(k=>k!==key);
        h+=`<div class="k" style="font-size:11px;color:var(--green)">🔁 ${ap.u} T${ap.tier} 자동 반복 생산 중 — 자원 되는 한 계속 훈련${hasOld?' <span style="color:var(--gold)">· 이전 대기열(다른 티어) 소진 후 시작</span>':''}</div>`;
      }
    }
    // 🏗 자원 건물 — 레벨업(출력↑, 시간 소요). 병원은 레벨×3 치료
    h+=`<hr><div class="k" style="margin-bottom:4px">🏗 자원 건물 <span class="k">(레벨업 = 출력↑)</span></div>`;
    for(const k in ECON_BUILDINGS){ const b=ECON_BUILDINGS[k], lv=state.castle.econ[k]||0;
      const mult=b.res?(hasR("영농")?1.5:1)+(hasR("영농 II")?0.25:0):1;
      const cur = lv>0 ? (b.res?`+${Math.round(b.amt*lv*mult)} ${b.res}/턴`:`치료 +${lv*3}/턴`) : "미건설";
      if(lv>=Game.ECON_MAX){ h+=`<div class="prodrow"><span class="nm">${b.icon} ${k} <span class="k">Lv.${lv} 최대 · ${cur}</span></span></div>`; continue; }
      const cost=Game.econCost(k,lv); const cs=Object.entries(cost).map(([r,v])=>`${r[0]}${v}`).join(" ");
      h+=`<div class="prodrow"><span class="nm">${b.icon} ${k} <span class="k">Lv.${lv} · ${cur} · ${Game.buildDur("econ",lv)}T</span></span>
        <span class="cost">${cs}</span>
        <button class="minibtn" data-econ="${k}" ${canAfford(cost)&&!busy?"":"disabled"}>${lv?"▲":"건설"}</button></div>`;
    }
    } // ← 건물 탭 끝
    if(tab==="연구"){
    // 🎓 대학 / 연구
    if(!state.castle.buildings.includes("대학")){
      const cs=Object.entries(UNIV_COST).map(([r,v])=>`${r[0]}${v}`).join(" ");
      h+=`<hr><div class="prodrow"><span class="nm">🎓 대학 <span class="k">연구 해금</span></span>
        <span class="cost">${cs}</span><button class="minibtn" data-univ="1" ${canAfford(UNIV_COST)&&!busy?"":"disabled"}>건설 ${Game.buildDur("univ")}T</button></div>`;
    } else {
      h+=`<hr><div class="k" style="margin-bottom:4px">🎓 대학 — 연구 <span class="k">(전투와 병행)</span></div>`;
      h+=`<div style="display:flex;gap:5px;margin-bottom:6px">`;
      for(const cat of ["전투","내정"]) h+=`<button class="minibtn" data-rtab="${cat}" style="${state.research.tab===cat?'background:var(--line);border-color:var(--gold);color:var(--gold);':''}">${cat}</button>`;
      h+=`</div>`;
      const act=state.research.active;
      if(act) h+=`<div style="color:var(--gold);font-size:12px;margin-bottom:4px">🔬 진행 중: ${act.key} — ${act.left}턴</div>`;
      const subs = state.research.tab==="전투" ? ["공성·수성","보병","궁병","기병","드래곤"] : ["경제","행군"];
      for(const sub of subs){
        h+=`<div style="font-size:11px;margin:7px 0 2px;color:#cbd5e1">▸ ${sub}</div>`;
        for(const rk in RESEARCH){ const r=RESEARCH[rk]; if(r.cat!==state.research.tab||r.sub!==sub) continue;
          const pre=(r.req&&r.req.length)?"└ ":"";
          if(state.research.done[rk]){ h+=`<div class="prodrow"><span class="nm">${pre}✅ ${rk} <span class="k">${r.desc}</span></span></div>`; continue; }
          // E4(연구 갈림길): 상호 배타 노선 중 하나를 이미 선택했으면 나머지는 영구히 잠금 표시
          const excludedBy=(r.excludes||[]).find(ex=>state.research.done[ex]);
          if(excludedBy){ h+=`<div class="prodrow"><span class="nm" style="opacity:.4">${pre}🚫 ${rk} <span class="k">"${excludedBy}" 선택으로 불가</span></span></div>`; continue; }
          const reqOk=(r.req||[]).every(q=>state.research.done[q]);
          const cs=Object.entries(r.cost).map(([res,v])=>`${res[0]}${v}`).join(" ");
          if(!reqOk){ h+=`<div class="prodrow"><span class="nm" style="opacity:.5">${pre}🔒 ${rk} <span class="k">선행: ${r.req.join(", ")}</span></span></div>`; continue; }
          h+=`<div class="prodrow"><span class="nm">${pre}${rk} <span class="k">${r.desc}</span></span>
            <span class="cost">${cs}·${r.turns}T</span>
            <button class="minibtn" data-research="${rk}" ${(!act&&canAfford(r.cost))?"":"disabled"}>연구</button></div>`;
        }
      }
    }
    } // ← 연구 탭 끝
    if(tab==="선술집"){
    // 🍺 선술집 — 랜덤 영웅 영입 (★3은 토벌 점수)
    if(!state.tavern.built){
      const cs=Object.entries(Game.TAVERN_COST).map(([r,v])=>`${r[0]}${v}`).join(" ");
      h+=`<hr><div class="prodrow"><span class="nm">🍺 선술집 <span class="k">영웅 영입 해금</span></span>
        <span class="cost">${cs}</span><button class="minibtn" data-tavern="1" ${canAfford(Game.TAVERN_COST)&&!busy?"":"disabled"}>건설 ${Game.buildDur("tavern")}T</button></div>`;
    } else {
      const star=g=>"★".repeat(g);
      h+=`<hr><div class="k" style="margin-bottom:4px">🍺 선술집 — 영입 후보 <span class="k">(${state.tavern.pool.length}명 · ${Game.TAVERN_GAP||3}턴마다 등장)</span></div>`;
      if(state.tavern.pool.length===0) h+=`<div class="k" style="font-size:12px">대기 중 — 곧 새 후보가 등장합니다.</div>`;
      for(const c of state.tavern.pool){ const cost=Game.RECRUIT_COST[c.grade]; const cs=Object.entries(cost).map(([r,v])=>`${r[0]}${v}`).join(" ");
        h+=`<div class="prodrow" style="align-items:flex-start"><span class="nm">${star(c.grade)} ${c.name} <span class="k">(${c.type})</span>
            <br><span style="font-size:10px;color:var(--gold)">✦ ${heroEffect(c)}</span></span>
          <span class="cost">${cs}</span><button class="minibtn" data-recruit="${c.id}" ${canAfford(cost)?"":"disabled"}>영입</button></div>`;
      }
      const sp=Game.SPECIAL_COST, spRes={식량:sp.식량,철:sp.철}, spOk=(state.subdue||0)>=sp.토벌&&canAfford(spRes);
      h+=`<div class="prodrow" style="align-items:flex-start"><span class="nm">★★★ 특별 영입 <span class="k">(랜덤 계열)</span>
          <br><span style="font-size:10px;color:var(--gold)">✦ 전투 +28% / 내정 생산+2·채집×1.7</span></span>
        <span class="cost">🏵${sp.토벌} 식${sp.식량} 철${sp.철}</span><button class="minibtn" data-special="1" ${spOk?"":"disabled"}>영입</button></div>`;
    }
    } // ← 선술집 탭 끝
    if(tab==="출전"){
    h+=`<div class="k" style="font-size:11px;margin-bottom:4px">🛡 주둔군은 적의 성 공격 시 자동 수성 참전</div>`;
    { const sc=Game.SIEGE_COST, cs=Object.entries(sc).map(([r,v])=>`${r[0]}${v}`).join(" ");
      h+=`<div class="prodrow"><span class="nm">🏹 파성추 <span class="k">보유 ${c.siegeItems||0} · 공성 전투 1회 소모, 성벽 보정 추가 완화</span></span>
        <span class="cost">${cs}</span><button class="minibtn" id="craftSiege" ${canAfford(sc)?"":"disabled"}>제작</button></div><hr>`; }
    h+=composerHTML();
    { const dt=Object.values(state.castle.draft).reduce((x,y)=>x+y,0);
      h+=`<div style="display:flex;gap:6px;margin-top:6px">
        <button class="minibtn" id="deploy" style="border-color:var(--gold);color:var(--gold)" ${dt>0&&Game.canAddArmy(state)?"":"disabled"}>🚩 성에 출전</button>
        <button class="minibtn" id="draftClear" ${dt>0?"":"disabled"}>초기화</button></div>`; }
    } // ← 출전 탭 끝
    if(tab==="편성"){
    // ⭐ 편성 즐겨찾기(3슬롯) — 유저 요청: 자주 쓰는 편성을 저장해뒀다 출전 탭에서 바로 불러오기.
    const draftTotal=Object.values(state.castle.draft).reduce((x,y)=>x+y,0);
    h+=`<div class="k" style="font-size:11px;margin-bottom:6px">지금 출전 탭에서 편성 중인 병력을 슬롯에 저장해두면, 출전 탭 상단 ⭐버튼으로 바로 불러올 수 있습니다.</div>`;
    const presets=state.castle.presets||[null,null,null];
    presets.forEach((p,i)=>{
      if(p){ const label=Object.entries(p).map(([u,cnt])=>`${unitLabel(u)}×${cnt}`).join(" · ");
        h+=`<div class="prodrow"><span class="nm">⭐ 슬롯${i+1} <span class="k">${label}</span></span>
          <button class="minibtn" data-savepreset="${i}" ${draftTotal>0?"":"disabled"}>덮어쓰기</button>
          <button class="minibtn" data-clearpreset="${i}">삭제</button></div>`;
      } else {
        h+=`<div class="prodrow"><span class="nm">⭐ 슬롯${i+1} <span class="k">비어있음</span></span>
          <button class="minibtn" data-savepreset="${i}" ${draftTotal>0?"":"disabled"}>현재 편성 저장</button></div>`;
      }
    });
    if(draftTotal<=0) h+=`<div class="k" style="font-size:11px;margin-top:6px">저장하려면 먼저 "출전" 탭에서 편성을 만드세요.</div>`;
    // 🤖 자동 출전(온라인) — 유저 요청: 자동 사냥/채집은 있는데 부대를 출전시키는 것까지 자동으로.
    // 저장된 즐겨찾기 중 지금 갖춘 병력으로 채울 수 있는 걸 매턴 최대 1개씩 출전, 사냥·채집을 번갈아 배정.
    const hasAnyPreset=(state.castle.presets||[]).some(Boolean);
    h+=`<hr><div class="prodrow"><span class="nm">🤖 자동 출전 <span class="k">저장된 즐겨찾기로 매턴 자동 출전(사냥·채집 번갈아)</span></span>
      <button class="minibtn" id="autoDeployToggle" style="${state.castle.autoDeploy?'background:var(--line);border-color:var(--green);color:var(--green)':''}" ${hasAnyPreset||state.castle.autoDeploy?"":"disabled"}>${state.castle.autoDeploy?"ON":"OFF"}</button></div>`;
    if(!hasAnyPreset) h+=`<div class="k" style="font-size:11px">즐겨찾기 슬롯을 하나 이상 채워야 켤 수 있습니다.</div>`;
    } // ← 편성 탭 끝
    if(tab==="군주"){
    // F4: 군주(레벨/재능/장비) — 몬스터 처치로 얻은 경험치·재료·설계도로 성장.
    // 모바일 스크롤 절감: 재능/장비/제작을 서브탭으로 분리(연구 탭 전투·내정 패턴 재사용) — 한 번에 하나만 표시.
    const lord=state.lord||{level:1,xp:0,talentPoints:0,talents:{},equipment:{}};
    const xpNeed=Game.lordXPNeed(lord.level), pct=Math.min(100,Math.round(100*lord.xp/xpNeed));
    h+=`<div class="k">👑 군주 Lv.${lord.level} <span class="k">· 재능 포인트 ${lord.talentPoints||0}</span></div>
      <div style="height:5px;background:var(--line);border-radius:3px;margin-top:4px"><div style="height:100%;width:${pct}%;background:var(--gold);border-radius:3px"></div></div>
      <div class="k" style="font-size:10px;margin:2px 0 6px">경험치 ${lord.xp}/${xpNeed}</div>
      <div class="k" style="font-size:11px;margin-bottom:6px">🧱 재료 ${state.materials||0} · 📜 설계도 ${state.blueprints||0}</div>`;
    const ltab=state.lordTab||"재능";
    h+=`<div style="display:flex;gap:5px;margin-bottom:6px">`;
    for(const lt of ["재능","장비","제작"]) h+=`<button class="minibtn" data-ltab="${lt}" style="flex:1;${ltab===lt?'background:var(--line);border-color:var(--gold);color:var(--gold);':''}">${lt}</button>`;
    h+=`</div>`;
    if(ltab==="재능"){
    h+=`<div class="k" style="margin-bottom:4px">🌳 재능 트리</div>`;
    const trees=[...new Set(Game.LORD_TALENTS.map(t=>t.tree))];
    for(const tree of trees){
      h+=`<div style="font-size:11px;margin:6px 0 2px;color:#cbd5e1">▸ ${tree}</div>`;
      for(const t of Game.LORD_TALENTS.filter(x=>x.tree===tree)){
        const have=!!(lord.talents&&lord.talents[t.id]);
        if(have){ h+=`<div class="prodrow"><span class="nm" style="font-size:11px">✅ ${t.name} <span class="k">${t.desc}</span></span></div>`; continue; }
        const reqOk=(t.req||[]).every(r=>lord.talents&&lord.talents[r]);
        if(!reqOk){ h+=`<div class="prodrow"><span class="nm" style="font-size:11px;opacity:.5">🔒 ${t.name} <span class="k">선행 필요</span></span></div>`; continue; }
        h+=`<div class="prodrow"><span class="nm" style="font-size:11px">${t.name} <span class="k">${t.desc}</span></span>
          <button class="minibtn" data-investtalent="${t.id}" ${(lord.talentPoints||0)>=t.cost?"":"disabled"}>습득 (${t.cost})</button></div>`;
      }
    }
    } // ← 재능 서브탭 끝
    if(ltab==="장비"){
    h+=`<div class="k" style="margin-bottom:4px">⚔ 장비</div>`;
    const inv=state.lordInventory||[];
    for(const slot of Game.EQUIP_SLOTS){
      const itemId=lord.equipment&&lord.equipment[slot], item=itemId?inv.find(x=>x.id===itemId):null;
      if(item){ const cat=Game.EQUIPMENT[item.key];
        h+=`<div class="prodrow"><span class="nm">${slot}: ${item.key} <span class="k">+${item.enhance} · ${cat.desc}</span></span>
          <button class="minibtn" data-enhanceequip="${item.id}" ${item.enhance<5?"":"disabled"}>강화</button>
          <button class="minibtn" data-unequip="${slot}">해제</button></div>`;
      } else h+=`<div class="prodrow"><span class="nm">${slot}: <span class="k">비어있음</span></span></div>`;
    }
    const equipped=new Set(Object.values(lord.equipment||{}).filter(Boolean));
    const unworn=inv.filter(it=>!equipped.has(it.id));
    if(unworn.length){
      h+=`<div class="k" style="font-size:11px;margin:6px 0 2px">보유(미착용)</div>`;
      for(const it of unworn){ const cat=Game.EQUIPMENT[it.key];
        h+=`<div class="prodrow"><span class="nm">${it.key} <span class="k">+${it.enhance} · ${cat.desc}</span></span>
          <button class="minibtn" data-enhanceequip="${it.id}" ${it.enhance<5?"":"disabled"}>강화</button>
          <button class="minibtn" data-equipitem="${it.id}">장착</button></div>`;
      }
    }
    } // ← 장비 서브탭 끝
    if(ltab==="제작"){
    h+=`<div class="k" style="margin-bottom:4px">🔨 제작</div>`;
    for(const key in Game.EQUIPMENT){ const it=Game.EQUIPMENT[key];
      const cs=Object.entries(it.cost).map(([r,v])=>`${r[0]}${v}`).join(" ");
      const ok=(state.materials||0)>=it.need.material&&(state.blueprints||0)>=it.need.blueprint&&canAfford(it.cost);
      h+=`<div class="prodrow"><span class="nm">${it.slot}: ${key} <span class="k">${it.desc} · 재료${it.need.material}·설계도${it.need.blueprint}</span></span>
        <span class="cost">${cs}</span><button class="minibtn" data-craftequip="${key}" ${ok?"":"disabled"}>제작</button></div>`;
    }
    } // ← 제작 서브탭 끝
    } // ← 군주 탭 끝
  } else if(s?.kind==="army"){
    const a=A(s.id);
    h+=`<h3>${a.side==="P"?"⚔ ":"✕ "}${a.name}</h3>`;
    h+=`<div class="k">위치 ${NODES[a.node].name} · 속도 ${Game.armyTicksPerTile(a)}틱/타일 · 병력 ${troops(a)}${a.dest?` · 🚩 <span style="color:var(--gold)">${NODES[a.dest].name} 이동 중</span>`:""}</div>`;
    h+=`<div class="k" style="font-size:12px">편성: ${Object.entries(a.comp).map(([k,v])=>`${unitLabel(k)} ${v}`).join(", ")||"—"}</div>`;
    const g=gatherOf(a); if(g)h+=`<div style="color:var(--green)">⛏ 채집 중: ${g.res} +${g.amt}/턴</div>`;
    if(a.hero){const hero=heroById(a.hero);
      h+=`<div class="loc" style="color:var(--gold)">${"★".repeat(hero.grade)} ${hero.name} (${hero.type}) 참전 중 <span class="k">— ${heroEffect(hero)}</span></div>`;
    } else h+=`<div class="k">영웅 없음</div>`;
    if(a.side==="P"){
      h+=`<div style="font-size:12px;margin-top:6px;color:var(--gold)">▶ 이동/공격할 노드를 클릭 → 노드 옆 확정 버튼을 누르세요</div>`;
      // G-A/H1: 자동 사냥·자동 채집 토글(상호배타) — 켜면 스스로 근처 몬스터 사냥 / 부족한 자원지로 채집(느긋하게 걸어놓기)
      h+=`<div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap">
        <button class="minibtn" id="huntToggle" style="${a.hunt?'background:var(--line);border-color:var(--green);color:var(--green)':''}">⚔ 자동 사냥 ${a.hunt?"ON":"OFF"}</button>
        <button class="minibtn" id="gatherToggle" style="${a.gather?'background:var(--line);border-color:var(--gold);color:var(--gold)':''}">⛏ 자동 채집 ${a.gather?"ON":"OFF"}</button>`;
      if(a.node==="P") h+=`<button class="minibtn" id="disbandBtn">성에 귀환</button>`;
      h+=`</div>`;
      if(a.hunt) h+=`<div class="k" style="font-size:11px;color:var(--green)">이길 만한 근처 몬스터를 자동 사냥 중 — 없으면 대기</div>`;
      if(a.gather) h+=`<div class="k" style="font-size:11px;color:var(--gold)">가장 부족한 자원지로 자동 채집 중 — 도착하면 수입 발생</div>`;
    }
  } else if(s?.kind==="node"){
    const n=NODES[s.id], occ=armiesAt(s.id);
    h+=`<h3>${({castle:"🏰",ancient:"🏛",resource:"◆",den:"☠",plain:"·"})[n.type]||""} ${n.name}</h3>`;
    h+=`<div class="k">유형: ${({castle:"성",ancient:"고대성(중앙 레이드)",resource:"자원지",den:"몬스터 둥지",plain:"평지"})[n.type]}${n.res?` · 자원 ${n.res}`:""}</div>`;
    const mon=occ.find(a=>a.side==="M");
    if(n.type==="ancient"){ const R=state.raid;
      const ownTxt=n.owner==="P"?'<span style="color:var(--blue)">아군 점령</span>':n.owner==="E"?'<span style="color:var(--red)">적 점령</span>':"미점령";
      h+=`<div style="margin-top:5px;font-size:12px">🏛 고대성 — 승리 조건: 고대 생물 처치 → 점령 → <b>${R.need}턴 수성</b></div>`;
      h+=`<div class="k" style="font-size:11px">고대성 점령 중엔 방어 +20%. 비우면 수성 진행 리셋.</div>`;
      if(R.cleared) h+=`<div style="margin-top:4px;font-size:12px">현황: ${ownTxt} · 수성 ${R.holder?R.holdTurns:0}/${R.need}턴</div>`;
    }
    if(mon){ const sc=Game.monsterScale(state), genTag=(s.id==="ANCIENT"&&state.raidBossGen)?` <span class="k">· ${state.raidBossGen+1}세대</span>`:"";
      h+=`<div style="color:#c4b5fd;margin-top:5px">☠ ${mon.name} <b>[${mon.mtier}${mon.tier?" T"+mon.tier:""}]</b>${sc>1.05?` <span class="k">(강화 ×${sc.toFixed(1)})</span>`:""}${genTag}</div>
      <div class="k" style="font-size:12px">구성: ${Object.entries(mon.comp).map(([k,v])=>`${unitLabel(k)} ${v}${MONSTER_ROLE[baseOf(k)]?`(${MONSTER_ROLE[baseOf(k)]})`:""}`).join(", ")}</div>
      <div class="k" style="font-size:12px">처치 보상: ${Object.entries(mon.reward).map(([k,v])=>k+" "+v).join(", ")}</div>
      <div style="font-size:12px;margin-top:4px;color:var(--gold)">▶ ${mon.mtier==="레이드"?"대군+영웅을 갖춰 도전하세요":"부대로 공격해 소탕하세요"}</div>`;
    } else { h+=`<div class="k" style="font-size:12px;margin-top:4px">주둔: ${occ.map(a=>a.name).join(", ")||"없음"}</div>`; }
    // 여기로 바로 출전
    if(Object.values(state.castle.garrison).reduce((x,y)=>x+y,0)>0 || Object.values(state.castle.draft).reduce((x,y)=>x+y,0)>0){
      h+=`<hr>`+composerHTML();
      const dt=Object.values(state.castle.draft).reduce((x,y)=>x+y,0), atk=occ.some(x=>x.side!=="P");
      h+=`<div style="margin-top:6px;display:flex;gap:6px">
        <button class="minibtn" id="deployTo" data-target="${s.id}" style="border-color:${atk?'var(--red)':'var(--gold)'};color:${atk?'#fca5a5':'var(--gold)'}" ${dt>0&&Game.canAddArmy(state)?"":"disabled"}>🚩 여기로 출전${atk?" ⚔️":""}</button>
        <button class="minibtn" id="draftClear2" ${dt>0?"":"disabled"}>초기화</button></div>`;
    }
  } else {
    h+=`<h3>📋 안내</h3><div class="k">🏰 <b>성을 눌러</b> 병력을 생산·출전시키세요.<br>부대(⚔)를 누른 뒤 갈 노드를 클릭 → 확정.<br>☠ 둥지를 공격해 사냥·토벌하면 보상·경험치·토벌 점수를 얻습니다.</div>`;
  }
  // #1(패널 길이): 영웅·드래곤 관리를 접이식으로 — 기본 접힘, 요약 한 줄만. 부대 선택 시 '선택 부대에' 배치하려면 펼침.
  const mgmtOpen = state.mgmtOpen===true || !!state.pendingPromote;   // 승급 선택 대기 시 자동 펼침(놓침 방지)
  { const d0=state.dragon||{stage:0}, dcur=Game.DRAGON_STAGES[d0.stage||0], armed=(s?.kind==="army"&&A(s.id)?.side==="P");
    h+=`<hr><div id="mgmtToggle" style="cursor:pointer;font-size:12px;color:var(--gold);display:flex;justify-content:space-between;align-items:center;padding:3px 0">
      <span>🦸 영웅 ${state.heroes.length} · 🐉 ${dcur.name}${state.pendingPromote?' <span style="color:#fca5a5">· 승급 선택!</span>':''}${armed&&!mgmtOpen?' <span class="k">(펼쳐서 부대 배치)</span>':''}</span><span>${mgmtOpen?"▲":"▼"}</span></div>`; }
  if(mgmtOpen){
  h+=(function(){ const d=state.dragon||{stage:0}, st=Game.DRAGON_STAGES, cur=st[d.stage], next=st[d.stage+1];
    const loc=Game.dragonLoc(state), locTxt=loc==="idle"?"대기":(A(loc)?.name||"?")+" 배치";
    const pct=next?Math.min(100,Math.round(100*(state.dragonScale||0)/next.need)):100;
    const skillNames=(d.skills||[]).map(id=>Game.DRAGON_SKILLS.find(x=>x.id===id)).filter(Boolean);
    let dh=`<hr><h3>🐉 드래곤</h3>
      <div class="hero"><b><span style="color:#c084fc">${cur.name}</span></b> <span class="k">(${locTxt})</span>
        <div class="k" style="font-size:11px;color:#c084fc">${cur.buff>0?`✦ 전투 참여 시 부대 전투력 +${Math.round(cur.buff*100)}%`:cur.desc}</div>
        ${skillNames.length?`<div class="k" style="font-size:11px;color:#c084fc">${skillNames.map(sk=>`✦${sk.name}: ${sk.desc}`).join(" · ")}</div>`:""}`;
    if(next) dh+=`<div style="height:5px;background:var(--line);border-radius:3px;margin-top:5px"><div style="height:100%;width:${pct}%;background:#c084fc;border-radius:3px"></div></div>
        <div class="k" style="font-size:10px;margin-top:2px">다음 단계(${next.name}) — 용린 ${state.dragonScale||0}/${next.need}</div>`;
    dh+=`<div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">`;
    if(s?.kind==="army"&&A(s.id).side==="P") dh+=`<button class="minibtn" data-dragonarmy="1">선택 부대에</button>`;
    if(loc!=="idle") dh+=`<button class="minibtn" data-dragonidle="1">해제</button>`;
    dh+=`</div>`;
    // F3: 스킬 트리 — RESEARCH 리스트 UI 패턴 재사용(✅완료/🔒선행필요/습득 가능)
    dh+=`<div class="k" style="font-size:11px;margin-top:6px;color:#c084fc">🔮 스킬 포인트 ${d.skillPoints||0} <span class="k">(용린 30마다 +1)</span></div>`;
    const skillCats=[...new Set(Game.DRAGON_SKILLS.map(sk=>sk.cat))];
    for(const cat of skillCats){
      dh+=`<div style="font-size:10px;margin:5px 0 2px;color:#cbd5e1">▸ ${cat}</div>`;
      for(const sk of Game.DRAGON_SKILLS.filter(x=>x.cat===cat)){
        const have=(d.skills||[]).includes(sk.id);
        if(have){ dh+=`<div class="prodrow"><span class="nm" style="font-size:11px">✅ ${sk.name} <span class="k">${sk.desc}</span></span></div>`; continue; }
        const reqOk=(sk.req||[]).every(r=>(d.skills||[]).includes(r));
        if(!reqOk){ dh+=`<div class="prodrow"><span class="nm" style="font-size:11px;opacity:.5">🔒 ${sk.name} <span class="k">선행 필요</span></span></div>`; continue; }
        dh+=`<div class="prodrow"><span class="nm" style="font-size:11px">${sk.name} <span class="k">${sk.desc}</span></span>
          <button class="minibtn" data-investdragonskill="${sk.id}" ${(d.skillPoints||0)>=1?"":"disabled"}>습득</button></div>`;
      }
    }
    return dh+`</div>`; })();
  // 영웅 관리
  h+=`<hr><h3>🦸 영웅 <span class="k">· 경험치 아이템 ${state.xpItems||0}</span></h3>`;
  h+=`<div class="k" style="font-size:11px;margin-bottom:4px">몬스터 처치로 경험치 획득 → 영웅 승급(★↑)</div>`;
  // F2: 영웅 위원회 — 내정형 영웅 여러 명을 성에 배치해 버프를 합산(마일스톤으로 자리 확장)
  { const cc=Game.cityHeroes(state).length, cs=Game.councilSlots(state);
    h+=`<div class="k" style="font-size:11px;margin-bottom:6px">🏛 위원회 ${cc}/${cs}</div>`; }
  for(const hero of state.heroes){
    const locTxt = hero.loc==="idle"?"대기": hero.loc==="castle"?"성 배치": (A(hero.loc)?.name||"?")+" 배치";
    h+=`<div class="hero"><b><span style="color:var(--gold)">${"★".repeat(hero.grade)}</span> ${hero.name}</b> <span class="k">(${hero.type})</span>
      <div class="loc">${locTxt}</div>
      <div class="k" style="font-size:11px;color:var(--gold)">✦ ${heroEffect(hero)}</div>`;
    if(state.pendingPromote && state.pendingPromote.hid===hero.id){
      const pool=Game.HERO_TRAITS[hero.type]||[];
      h+=`<div style="background:var(--bg);border:1px solid var(--gold);border-radius:8px;padding:8px;margin-top:6px">
        <div style="font-size:12px;color:var(--gold);margin-bottom:5px">★${hero.grade+1} 승급 — 특성을 선택하세요</div>
        ${state.pendingPromote.options.map(tid=>{const t=pool.find(x=>x.id===tid);
          return t?`<button class="minibtn" data-choosetrait="${tid}" data-choosehero="${hero.id}" style="display:block;width:100%;text-align:left;margin-bottom:4px">✦${t.name}: ${t.desc}</button>`:"";}).join("")}
        <button class="minibtn" data-cancelpromote="1" style="font-size:10px">취소</button>
      </div>`;
    } else {
      h+=`<div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">`;
      if(hero.type==="내정"){ const full=hero.loc!=="castle" && Game.cityHeroes(state).length>=Game.councilSlots(state);
        h+=`<button class="minibtn" data-hcastle="${hero.id}" ${full?"disabled":""}>성에 배치${full?" (위원회 가득참)":""}</button>`; }
      if(s?.kind==="army"&&A(s.id).side==="P") h+=`<button class="minibtn" data-harmy="${hero.id}">선택 부대에</button>`;
      h+=`<button class="minibtn" data-hidle="${hero.id}">해제</button>`;
      if(hero.grade<3){const pc=Game.PROMOTE_COST[hero.grade];
        h+=`<button class="minibtn" data-promote="${hero.id}" style="border-color:var(--gold);color:var(--gold)" ${(!state.pendingPromote&&(state.xpItems||0)>=pc)?"":"disabled"}>승급 ★${hero.grade+1} (경험치 ${pc})</button>`;}
      h+=`</div>`;
    }
    h+=`</div>`;
  }
  } // ← 영웅·드래곤 관리 접이식 끝
  p.innerHTML=h;
  const closeCS=document.getElementById('closeCastleScreen'); if(closeCS) closeCS.onclick=()=>{state.selected=null;state.pendingMove=null;state.mode="normal";render();};
  // 핸들러
  const infoT=p.querySelector('#infoToggle'); if(infoT) infoT.onclick=()=>{state.infoOpen=!(state.infoOpen!==false);render();};
  const compT=p.querySelector('#compToggle'); if(compT) compT.onclick=()=>{state.compOpen=!(state.compOpen===true);render();};
  const aboutT=p.querySelector('#aboutToggle'); if(aboutT) aboutT.onclick=()=>{state.aboutOpen=!(state.aboutOpen===true);render();};
  const mgmtT=p.querySelector('#mgmtToggle'); if(mgmtT) mgmtT.onclick=()=>{state.mgmtOpen=!(state.mgmtOpen===true);render();};
  const rl=p.querySelector('#rallyBtn'); if(rl) rl.onclick=()=>{const n=Game.rallyToDefense(state); toast(n?`⚔ ${n}개 부대 소집 — 성으로 귀환 중`:"소집할 부대 없음"); render();};
  p.querySelectorAll('[data-bld]').forEach(b=>b.onclick=()=>{state.castle.openBuilding=b.dataset.bld;render();});
  p.querySelectorAll('[data-construct]').forEach(b=>b.onclick=()=>construct(b.dataset.construct));
  p.querySelectorAll('select[id^="tier_"]').forEach(s=>s.onchange=()=>{state.prodTier[s.id.slice(5)]=+s.value;});
  p.querySelectorAll('[data-make]').forEach(b=>b.onclick=()=>{const u=b.dataset.make;const t=+document.getElementById('tier_'+u).value;state.prodTier[u]=t;produce(u,+document.getElementById('qty_'+u).value,t);});
  p.querySelectorAll('[data-auto]').forEach(b=>b.onclick=()=>{const u=b.dataset.auto;const t=+document.getElementById('tier_'+u).value;const bld=Game.UNIT_BLD[u];Game.setAutoProduce(state,bld,u,t);const on=state.castle.autoProduce[bld];toast(on?`🔁 ${u} T${t} 반복 생산 켜짐`:"반복 생산 꺼짐");render();});
  p.querySelectorAll('[data-bup]').forEach(b=>b.onclick=()=>upgradeBuilding(b.dataset.bup));
  p.querySelectorAll('[data-ctab]').forEach(b=>b.onclick=()=>{state.castleTab=b.dataset.ctab;render();});
  p.querySelectorAll('[data-ltab]').forEach(b=>b.onclick=()=>{state.lordTab=b.dataset.ltab;render();});
  const wl=p.querySelector('[data-wall]'); if(wl) wl.onclick=fortifyWall;
  p.querySelectorAll('[data-promote]').forEach(b=>b.onclick=()=>promoteHero(b.dataset.promote));
  p.querySelectorAll('[data-choosetrait]').forEach(b=>b.onclick=()=>choosePromoteTrait(b.dataset.choosehero,b.dataset.choosetrait));
  const cp=p.querySelector('[data-cancelpromote]'); if(cp) cp.onclick=()=>{Game.cancelPromote(state);render();};
  const da=p.querySelector('[data-dragonarmy]'); if(da) da.onclick=()=>{Game.assignDragon(state,state.selected.id);toast("🐉 드래곤 배치");render();};
  const di=p.querySelector('[data-dragonidle]'); if(di) di.onclick=()=>{Game.assignDragon(state,"idle");toast("🐉 드래곤 해제");render();};
  p.querySelectorAll('[data-investdragonskill]').forEach(b=>b.onclick=()=>{const m=Game.investDragonSkill(state,b.dataset.investdragonskill); toast(m||"🐉 드래곤 스킬 습득!"); render();});
  // F4: 군주 재능/장비
  p.querySelectorAll('[data-investtalent]').forEach(b=>b.onclick=()=>{const m=Game.investTalent(state,b.dataset.investtalent); toast(m||"👑 재능 습득!"); render();});
  p.querySelectorAll('[data-craftequip]').forEach(b=>b.onclick=()=>{const m=Game.craftEquipment(state,b.dataset.craftequip); toast(m||"🔨 장비 제작!"); render();});
  p.querySelectorAll('[data-enhanceequip]').forEach(b=>b.onclick=()=>{const m=Game.enhanceEquipment(state,b.dataset.enhanceequip); toast(m||"✨ 강화 성공!"); render();});
  p.querySelectorAll('[data-equipitem]').forEach(b=>b.onclick=()=>{const m=Game.equipItem(state,b.dataset.equipitem); toast(m||"⚔ 장착!"); render();});
  p.querySelectorAll('[data-unequip]').forEach(b=>b.onclick=()=>{Game.unequipItem(state,b.dataset.unequip); render();});
  const lu=p.querySelector('#levelup'); if(lu) lu.onclick=levelUp;
  p.querySelectorAll('[data-hcastle]').forEach(b=>b.onclick=()=>assignHero(b.dataset.hcastle,"castle"));
  p.querySelectorAll('[data-harmy]').forEach(b=>b.onclick=()=>assignHero(b.dataset.harmy,state.selected.id));
  p.querySelectorAll('[data-hidle]').forEach(b=>b.onclick=()=>assignHero(b.dataset.hidle,"idle"));
  p.querySelectorAll('[data-draft]').forEach(b=>b.onclick=()=>draftAdjust(b.dataset.draft,+b.dataset.d));
  p.querySelectorAll('[data-loadpreset]').forEach(b=>b.onclick=()=>loadPreset(+b.dataset.loadpreset));
  p.querySelectorAll('[data-savepreset]').forEach(b=>b.onclick=()=>savePreset(+b.dataset.savepreset));
  p.querySelectorAll('[data-clearpreset]').forEach(b=>b.onclick=()=>clearPreset(+b.dataset.clearpreset));
  const adT=p.querySelector('#autoDeployToggle'); if(adT) adT.onclick=()=>{Game.setAutoDeploy(state,!state.castle.autoDeploy); toast(state.castle.autoDeploy?"🤖 자동 출전 켜짐":"자동 출전 꺼짐"); render();};
  const dep=p.querySelector('#deploy'); if(dep) dep.onclick=deploy;
  const cs=p.querySelector('#craftSiege'); if(cs) cs.onclick=craftSiege;
  const dcl=p.querySelector('#draftClear'); if(dcl) dcl.onclick=()=>{state.castle.draft={};render();};
  const dpt=p.querySelector('#deployTo'); if(dpt) dpt.onclick=()=>deployTo(dpt.dataset.target);
  const dc2=p.querySelector('#draftClear2'); if(dc2) dc2.onclick=()=>{state.castle.draft={};render();};
  const dsb=p.querySelector('#disbandBtn'); if(dsb) dsb.onclick=()=>disband(state.selected.id);
  const ht=p.querySelector('#huntToggle'); if(ht) ht.onclick=()=>{const a=A(state.selected.id); Game.setHunt(state,a.id,!a.hunt); toast(a.hunt?"⚔ 자동 사냥 켜짐":"자동 사냥 꺼짐"); render();};
  const gt=p.querySelector('#gatherToggle'); if(gt) gt.onclick=()=>{const a=A(state.selected.id); Game.setGather(state,a.id,!a.gather); toast(a.gather?"⛏ 자동 채집 켜짐":"자동 채집 꺼짐"); render();};
  p.querySelectorAll('[data-econ]').forEach(b=>b.onclick=()=>buildEcon(b.dataset.econ));
  const uv=p.querySelector('[data-univ]'); if(uv) uv.onclick=buildUniversity;
  const tv=p.querySelector('[data-tavern]'); if(tv) tv.onclick=buildTavern;
  p.querySelectorAll('[data-recruit]').forEach(b=>b.onclick=()=>recruitHero(b.dataset.recruit));
  const sp=p.querySelector('[data-special]'); if(sp) sp.onclick=specialRecruit;
  p.querySelectorAll('[data-research]').forEach(b=>b.onclick=()=>startResearch(b.dataset.research));
  p.querySelectorAll('[data-rtab]').forEach(b=>b.onclick=()=>{state.research.tab=b.dataset.rtab;render();});
}
function render(){renderMap();renderResBar();renderQuickBar();renderPanel();renderMoveConfirm();}

function attach(){
  svg.querySelectorAll('[data-confirm]').forEach(g=>g.onclick=e=>{e.stopPropagation();confirmMove();});
  svg.querySelectorAll('[data-cancel]').forEach(g=>g.onclick=e=>{e.stopPropagation();cancelMove();});
  svg.querySelectorAll('[data-army]').forEach(g=>g.onclick=e=>{e.stopPropagation();
    const a=A(g.dataset.army), sel=state.selected?.kind==="army"?A(state.selected.id):null;
    // 아군 부대 선택 중 다른 노드 클릭(아군 토큰 포함) → 그 노드로 이동 예약
    if(sel && sel.side==="P" && a.node!==sel.node){
      const {dist}=dijkstra(sel.node,99);
      if(dist[a.node]!==undefined){ stageMove(a.node); return; }
    }
    state.pendingMove=null; state.selected={kind:"army",id:a.id}; render();});
  svg.querySelectorAll('[data-go]').forEach(c=>c.onclick=e=>{e.stopPropagation();stageMove(c.dataset.go);});
  svg.querySelectorAll('[data-node]').forEach(c=>c.onclick=e=>{e.stopPropagation();
    const sel=state.selected?.kind==="army"?A(state.selected.id):null;
    if(sel && sel.side==="P"){ const {dist}=dijkstra(sel.node,99);
      if(dist[c.dataset.node]!==undefined && c.dataset.node!==sel.node){ stageMove(c.dataset.node); return; } }
    state.pendingMove=null; state.selected={kind:"node",id:c.dataset.node};
    if(NODES[c.dataset.node].type==="castle"&&NODES[c.dataset.node].owner==="P") state.castleTab="출전";   // 유저 요청: 타일 탭 → 바로 출전 화면
    render();});
}
function stageMove(target){ // 1단계: 목적지 미리보기 (확정 전엔 명령 안 내림)
  if(state.over) return;
  const a=A(state.selected?.id); if(!a) return;
  const {dist,prev}=dijkstra(a.node,99);
  if(dist[target]===undefined||target===a.node){toast("도달 불가");return;}
  state.pendingMove={armyId:a.id,target,path:pathTo(target,prev),cost:dist[target],
    attack:armiesAt(target).some(x=>x.side!=="P")};
  render();
}
function confirmMove(){ // 2단계: 확정 → 진군 명령. 부대가 여러 틱에 걸쳐 스스로 이동(▶ 재생/한 틱).
  const pm=state.pendingMove; if(!pm||state.over) return;
  const m=Game.orderMove(state,pm.armyId,pm.target);
  state.pendingMove=null; state.mode="normal";
  if(!m) state.selected=null;   // 명령 성공 → 선택 해제(도달 타일 하이라이트 끔)
  toast(m||`🚩 ${NODES[pm.target].name} 방면 진군 — ▶ 재생으로 시간을 흘려 이동`);
  render();
}
function cancelMove(){ state.pendingMove=null; state.mode="normal"; render(); }
function renderMoveConfirm(){ // 상단엔 안내만, 확정 버튼은 지도 노드 옆 팝업
  const box=document.getElementById('moveConfirm'); const pm=state.pendingMove;
  box.innerHTML = pm
    ? `<span class="res" style="border-color:${pm.attack?'var(--red)':'var(--gold)'}">${pm.attack?'⚔️ 공격 준비':'이동 준비'}: <b>${NODES[pm.target].name}</b> — 지도의 확정 버튼</span>`
    : "";
}
function produce(u,qty,tier){const m=Game.produce(state,u,qty,tier); const lbl=(tier>1?u+" T"+tier:u); toast(m||`${lbl} ×${Math.max(1,qty|0)} 생산 대기열`); render();}
function construct(key){const m=Game.construct(state,key); toast(m||`🏗 ${key} 건설 시작`); render();}
function upgradeBuilding(key){const m=Game.upgradeBuilding(state,key); toast(m||`🏗 ${key} 레벨업 시작`); render();}
function fortifyWall(){const m=Game.fortifyWall(state); toast(m||`🏗 성벽 보강 시작`); render();}
function craftSiege(){const m=Game.craftSiege(state); toast(m||`🏹 파성추 제작 완료 (보유 ${state.castle.siegeItems})`); render();}
function promoteHero(hid){const m=Game.promoteHero(state,hid); toast(m||"승급 특성을 선택하세요"); render();}
function choosePromoteTrait(hid,traitId){const m=Game.choosePromoteTrait(state,hid,traitId); toast(m||`영웅 승급! ★${heroById(hid).grade}`); render();}
function draftAdjust(u,d){Game.draftAdjust(state,u,d); render();}
function savePreset(idx){const m=Game.savePreset(state,idx); toast(m||`⭐ 슬롯${idx+1} 저장됨`); render();}
function loadPreset(idx){const m=Game.loadPreset(state,idx); toast(m||`⭐ 슬롯${idx+1} 불러옴`); render();}
function clearPreset(idx){Game.clearPreset(state,idx); toast(`⭐ 슬롯${idx+1} 삭제됨`); render();}
const GROUP_ICON={보병:"🛡",궁병:"🏹",기병:"🐎"};
const SHORT_NAME={중갑보병:"중갑",창병:"창병",장궁병:"장궁",석궁병:"석궁",경기병:"경기",중기병:"중기"};   // 그리드 컬럼 헤더용 축약(6유닛 고정 로스터라 하드코딩 안전)
const ALL_UNITS=[].concat(...Object.values(GROUPS));   // 그룹 순서 보존한 6유닛 평탄화(그리드 열 순서)
// ⭐ 편성 즐겨찾기 퀵버튼 — 출전 탭·노드 패널 양쪽에서 composerHTML()이 공용이라 여기 한 곳에 추가하면 두 진입점에 자동 반영.
function renderPresetQuick(){
  const presets=state.castle.presets||[null,null,null];
  return `<div style="display:flex;gap:5px;margin-bottom:6px">`+presets.map((p,i)=>{
    const label=p?Object.entries(p).map(([u,c])=>`${SHORT_NAME[baseOf(u)]||baseOf(u)}${c}`).join("·"):"빈 슬롯";
    return `<button class="minibtn" data-loadpreset="${i}" style="flex:1;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" ${p?"":"disabled"}>⭐${i+1} ${label}</button>`;
  }).join("")+`</div>`;
}
// 🚩 출전 편성 — 유저 피드백: 세로 리스트가 길다 → 열=병종, 행=티어 그리드로 압축(접힌 바텀시트 안에서도 닿을 정도로 짧게).
function composerHTML(){
  const gar=state.castle.garrison, draft=state.castle.draft;
  const draftTotal=Object.values(draft).reduce((x,y)=>x+y,0), garTotal=Object.values(gar).reduce((x,y)=>x+y,0);
  const acap=Game.armySlots(state), acur=Game.pArmyCount(state), afull=!Game.canAddArmy(state);
  let h=`<div class="k" style="margin-bottom:4px">🚩 출전 편성 <span class="k">(주둔 ${garTotal} · 부대 <span style="color:${afull?'#fca5a5':'#cbd5e1'}">${acur}/${acap}</span>)</span></div>`;
  if(afull) h+=`<div class="k" style="font-size:11px;color:#fca5a5">부대 수 상한 도달 — 성 레벨업·군제 개편 연구로 확대</div>`;
  h+=renderPresetQuick();
  if(garTotal===0 && draftTotal===0) return h+`<div class="k" style="font-size:12px">주둔 병력 없음 — 성에서 생산하세요.</div>`;
  const tiersUsed=[]; for(let t=1;t<=TIER_MAX;t++){ if(ALL_UNITS.some(u=>(gar[Game.uk(u,t)]||0)+(draft[Game.uk(u,t)]||0)>0)) tiersUsed.push(t); }
  h+=`<div class="compgrid" style="grid-template-columns:26px repeat(${ALL_UNITS.length},1fr)">
    <div></div>${ALL_UNITS.map(u=>`<div class="gh" title="${u}">${GROUP_ICON[GROUPS.보병.includes(u)?"보병":GROUPS.궁병.includes(u)?"궁병":"기병"]}${SHORT_NAME[u]||u}</div>`).join("")}`;
  for(const t of tiersUsed){
    h+=`<div class="gh">T${t}</div>`;
    for(const u of ALL_UNITS){ const key=Game.uk(u,t), avail=gar[key]||0, d=draft[key]||0;
      if(avail<=0 && d<=0){ h+=`<div class="gcell empty">–</div>`; continue; }
      h+=`<div class="gcell">
        <button class="gbtn" data-draft="${key}" data-d="1" ${d>=avail||draftTotal>=Game.armyCapFor(state)?"disabled":""}>＋</button>
        <div class="gn">${d}<span class="k" style="font-size:8px">/${avail}</span></div>
        <button class="gbtn" data-draft="${key}" data-d="-1" ${d<=0?"disabled":""}>−</button>
      </div>`;
    }
  }
  h+=`</div>`;
  return h+`<div class="k" style="font-size:12px;margin-top:4px">편성 ${draftTotal}/${Game.armyCapFor(state)}</div>`;
}
function deploy(){if(!Game.canAddArmy(state)){toast("부대 수 상한 도달 — 성 레벨업·군제 개편 필요");return;} const army=Game.deploy(state); if(army){state.selected={kind:"army",id:army.id};state.mode="normal";toast(`${army.name} 성에 출전!`);} render();}
function deployTo(target){if(!Game.canAddArmy(state)){toast("부대 수 상한 도달 — 성 레벨업·군제 개편 필요");return;} const r=Game.deployTo(state,target); if(!r.army){toast("편성된 병력이 없습니다");return;}
  state.selected = r.target ? null : {kind:"army",id:r.army.id};   // 진군 명령이면 선택 해제
  toast(r.target?`${r.army.name} 출전 → ${NODES[target].name} 방면 진군 (▶ 재생으로 이동)`:`${r.army.name} 성에 출전!`); render();}
function disband(id){const m=Game.disband(state,id); if(m){toast(m);return;} state.selected={kind:"node",id:"P"}; toast("부대 귀환 — 병력이 주둔군에 합류"); render();}
function buildEcon(k){const m=Game.buildEcon(state,k); toast(m||`🏗 ${k} 레벨업 시작`); render();}
function buildUniversity(){const m=Game.buildUniversity(state); toast(m||"🏗 대학 건설 시작"); render();}
function buildTavern(){const m=Game.buildTavern(state); toast(m||"🏗 선술집 건설 시작"); render();}
function recruitHero(cid){const m=Game.recruitHero(state,cid); toast(m||"영웅 영입 완료 — 대기 상태로 합류"); render();}
function specialRecruit(){const m=Game.specialRecruit(state); toast(m||"★3 영웅 특별 영입 성공!"); render();}
function startResearch(k){const m=Game.startResearch(state,k); toast(m||`${k} 연구 시작`); render();}
function levelUp(){const m=Game.levelUp(state); toast(m||"🏗 성 레벨업 시작"); render();}
function assignHero(hid,loc){Game.assignHero(state,hid,loc); toast(`${heroById(hid).name} → ${loc==="castle"?"성":loc==="idle"?"대기":A(loc)?.name}`); render();}

function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');
  clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),1600);}
// 🚨 위협 알림 배너 — 시즌/습격대 예고·도래를 일반 토스트보다 눈에 띄게(더 크고, 더 오래, 색으로 위험도 구분).
// 템플릿 수정 없이 동작하도록 엘리먼트를 JS에서 직접 생성(노드판·타일판 공용).
function showThreatBanner(text,level){   // level: "warn"(예고,주황) | "danger"(도래,빨강)
  let b=document.getElementById('threatBanner');
  if(!b){ b=document.createElement('div'); b.id='threatBanner';
    b.style.cssText="position:fixed;left:50%;top:14px;transform:translateX(-50%) translateY(-14px);"
      +"min-width:240px;max-width:92vw;padding:12px 20px;border-radius:12px;color:#fff;font-size:14px;"
      +"font-weight:700;text-align:center;box-shadow:0 10px 28px rgba(0,0,0,.55);opacity:0;"
      +"transition:opacity .25s,transform .25s;pointer-events:none;z-index:25;border:1px solid;";
    document.body.appendChild(b); }
  const danger=level==="danger";
  b.style.background=danger?"linear-gradient(135deg,#7f1d1d,#b91c1c)":"linear-gradient(135deg,#78350f,#d97706)";
  b.style.borderColor=danger?"#ef4444":"var(--gold)";
  b.textContent=text; b.style.opacity="1"; b.style.transform="translateX(-50%) translateY(0)";
  clearTimeout(b._t); b._t=setTimeout(()=>{ b.style.opacity="0"; b.style.transform="translateX(-50%) translateY(-14px)"; },4200);
}

/* 전투·AI·규칙은 game.js 담당 (Game.*). UI만 아래에. */
function showModal(html){document.getElementById('modalBody').innerHTML=html;
  document.getElementById('modal').classList.remove('hidden');
  const c=document.getElementById('modalClose'); if(c)c.onclick=hideModal;}
function hideModal(){document.getElementById('modal').classList.add('hidden');}
const MARGIN_TAG={압승:"🟢 압승",신승:"🟡 신승",박빙:"🟠 박빙"};
function showBattleModal(sum){
  const pWon=(sum.w==="A"&&sum.aSide==="P")||(sum.w==="B"&&sum.aSide==="E");
  const tag=sum.w==="draw"?'<span class="k">무승부</span>':(pWon?'<span style="color:var(--blue)">🔵 아군 우세</span>':'<span style="color:var(--red)">🔴 적 우세</span>');
  const stars=g=>"★".repeat(g);
  const heroLine=(sum.heroA||sum.heroB)?`<div class="res-line" style="color:var(--gold);font-size:12px">${[sum.heroA?`공격 ${stars(sum.gradeA)} ${sum.heroA}(+${sum.buffA}%)`:"",sum.heroB?`수비 ${stars(sum.gradeB)} ${sum.heroB}(+${sum.buffB}%)`:""].filter(Boolean).join(" · ")}</div>`:"";
  const dragonLine=(sum.dragonA||sum.dragonB)?`<div class="res-line" style="color:#c084fc;font-size:12px">🐉 ${sum.dragonA?"공격":"수비"} 참전 · ${sum.dragonStage}</div>`:"";
  const enrageLine=sum.enrageLoss?`<div class="res-line" style="color:#f87171;font-size:12px">💢 고대 생물이 포효하며 선제 강타! 공격측 병력 -${sum.enrageLoss}%</div>`:"";
  // E3(전투 연출): 라운드 수·특수 발동·창병 요격 총계 + 승패 마진 태그로 "어떤 전투였는지" 체감 강화
  const marginTag=sum.margin?` · ${MARGIN_TAG[sum.margin]}`:"";
  const detailBits=[sum.rounds!=null?`${sum.rounds}R 만에 결판`:"",sum.totalProc?`특수 ${sum.totalProc}회`:"",sum.totalCounter?`창병 요격 ${sum.totalCounter}회`:""].filter(Boolean).join(" · ");
  const detailLine=detailBits?`<div class="res-line k" style="font-size:12px">${detailBits}${marginTag}</div>`:"";
  showModal(`<h2>⚔️ 전투</h2>
    <div class="res-line">${sum.attacker} <span class="k">→</span> ${sum.defender}${sum.fort?' <span class="k">(방어 보정)</span>':''}</div>
    ${enrageLine}${heroLine}${dragonLine}
    <div class="res-line">${tag}</div><div class="res-line"><b>${sum.result}</b></div>
    ${detailLine}
    <div class="res-line k">생존 — 공격 ${sum.survA} · 수비 ${sum.survB}</div>
    <button class="minibtn" id="modalClose">확인</button>`);
}
// 🌍 세계 이벤트(A3, 정복·함락·레이드)는 stepTurn에서 배너/토스트로 직접 처리 — 재생을 끊지 않으려 모달을 쓰지 않는다(유저 요청).

/* ===== 저장/불러오기 ===== */
const SAVE_KEY="mini4x_save_v1", UI_FIELDS=["selected","pendingMove","mode","castleTab","prodTier","infoOpen","lordTab","compOpen","aboutOpen"];
function saveSnapshot(){const o={...state,ancientOwner:NODES.ANCIENT.owner,savedAt:Date.now()};for(const f of UI_FIELDS)delete o[f];return JSON.parse(JSON.stringify(o));}
function applySave(data){
  if(typeof rtStop==="function")rtStop();   // 로드/새게임 시 실시간 루프 정지
  hideModal();                              // 열려있던 전투/종료 모달 닫기
  if(typeof resetMapPan==="function")resetMapPan();   // 새 판/불러오기 시 지도 팬 위치 초기화
  closeSheet();
  for(const k in state){if(!UI_FIELDS.includes(k))delete state[k];}
  Object.assign(state,data); NODES.ANCIENT.owner=data.ancientOwner!==undefined?data.ancientOwner:null; delete state.ancientOwner;
  state.selected=null;state.pendingMove=null;state.mode="normal"; state.castleTab=state.castleTab||"건물"; state.prodTier=state.prodTier||{};
  state.infoOpen=state.infoOpen!==false;
  state.quests=state.quests||{done:[],idx:0};   // 구버전 세이브 호환
  state.milestones=state.milestones||{done:[],idx:0,unlocked:[]};   // 구버전 세이브 호환(A2)
  state.raidBossGen=state.raidBossGen||0;
  if(state.raid) state.raid.settled=state.raid.settled||false;   // 구버전 세이브 호환 — 고대성 점거 1회 발동 플래그
  state.ai=state.ai||{budget:0}; if(state.ai.lastWave==null)state.ai.lastWave=-99;   // 구버전 세이브 호환 — 웨이브 간격 추적
  state.castle.presets=state.castle.presets||[null,null,null];   // 구버전 세이브 호환 — 편성 즐겨찾기 3슬롯
  if(state.castle.autoDeploy==null)state.castle.autoDeploy=false; state.castle.autoDeployNext=state.castle.autoDeployNext||"hunt";   // 구버전 세이브 호환 — 자동 출전
  state.rivals=state.rivals||Game.RIVALS.map(r=>({id:r.id,might:r.base})); state.rivalKills=state.rivalKills||0;   // 구버전 세이브 호환 — 라이벌 왕국(I1)
  state.rankSeason=state.rankSeason||{num:1,next:state.turn+Game.RANK_SEASON_LEN,score:0,bestRank:99,tierHist:[]};   // 구버전 세이브 호환 — 경쟁 시즌(I3)
  state.season=state.season||{count:1,next:state.turn+60,warnAt:state.turn+48,warned:false};   // 구버전 세이브 호환(B2)
  state.factions=state.factions||Game.FACTIONS.map(f=>({id:f.id,count:1,next:state.turn+f.interval}));   // 구버전 세이브 호환(B1)
  state.pendingPromote=state.pendingPromote||null;   // 구버전 세이브 호환(C2)
  state.dragon=state.dragon||{stage:0}; state.dragon.skills=state.dragon.skills||[]; state.dragonScale=state.dragonScale||0;   // 구버전 세이브 호환(C1)
  state.dragon.skillPoints=state.dragon.skillPoints||0; state.dragon.scaleSpent=state.dragon.scaleSpent||0;   // 구버전 세이브 호환(F3)
  delete state.pendingDragonSkill;   // F3: 2択 폐기 — 남아있던 필드 정리
  // F3: 구 스킬 id(단일명)→신 id(Ⅰ접미사) 1회 이관 — 안 하면 구 세이브의 스킬이 조용히 무효화됨
  { const MIG={flame:"flame1",scale:"scale1",hunter:"hunter1",roar:"roar1"};
    state.dragon.skills=state.dragon.skills.map(id=>MIG[id]||id); }
  // F4: 구버전 세이브 호환 — 군주 필드가 없으면 기본값 채움
  state.lord=state.lord||{level:1,xp:0,talentPoints:0,talents:{},equipment:{}};
  state.lord.talents=state.lord.talents||{}; state.lord.equipment=state.lord.equipment||{};
  state.lordInventory=state.lordInventory||[]; state.materials=state.materials||0; state.blueprints=state.blueprints||0;
  (state.heroes||[]).forEach(h=>{ if(h.trait&&!h.traits) h.traits=[h.trait]; delete h.trait; if(!h.traits) h.traits=[]; });   // hero.trait(단일)→traits(배열) 1회 이관(C2)
  // F1: castle.queue가 구버전 단일 배열이면 건물별 오브젝트로 재분배(유닛 유실 방지)
  if(Array.isArray(state.castle.queue)){ const old=state.castle.queue; state.castle.queue={};
    for(const u of old){ const b=Game.UNIT_BLD[Game.baseOf(u)]; if(b) (state.castle.queue[b]=state.castle.queue[b]||[]).push(u); } }
  state.castle.autoProduce=state.castle.autoProduce||{};   // G-C: 구버전 세이브 호환
  state.castle.trainProg=state.castle.trainProg||{};   // 생산시간: 구버전 세이브 호환
  document.getElementById('endturn').disabled=!!state.over; render();
}
function saveLocal(silent){try{localStorage.setItem(SAVE_KEY,JSON.stringify(saveSnapshot()));if(!silent)toast("💾 저장됨 (이 브라우저)");return true;}catch(e){if(!silent)toast("⚠ 브라우저 저장 불가 — ⬇ 파일로 내보내세요");return false;}}
function loadLocal(){try{const s=localStorage.getItem(SAVE_KEY);if(!s){toast("저장된 판이 없습니다");return;}
  const data=JSON.parse(s); applySave(data); toast("📂 불러왔습니다 — 턴 "+state.turn); offlineCatchup(data);
}catch(e){toast("⚠ 불러오기 실패");}}
function exportFile(){const blob=new Blob([JSON.stringify(saveSnapshot())],{type:"application/json"});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download="mini4x_턴"+state.turn+".json";a.click();URL.revokeObjectURL(a.href);toast("⬇ 세이브 파일 내보냄");}
function importFile(file){const r=new FileReader();r.onload=()=>{try{const data=JSON.parse(r.result);
  applySave(data); toast("⬆ 가져왔습니다 — 턴 "+state.turn); offlineCatchup(data);
}catch(e){toast("⚠ 파일 형식 오류");}};r.readAsText(file);}
// ---- 오프라인 누적(A4) — 실시각(Date.now())은 여기(ui.js)에서만 다룸. 계산 자체는 game.js의 순수 offlineTick.
const OFFLINE_MAX_HOURS=24;   // 방치형: 한 번에 인정하는 오프라인 시간 상한(스태미나 없음, 상한만 조정)
function offlineCatchup(data){
  if(!data.savedAt||state.over) return;
  const elapsedMs=Date.now()-data.savedAt;
  const ticks=Math.floor(Math.min(elapsedMs,OFFLINE_MAX_HOURS*3600*1000)/RT_BASE);
  if(ticks<1) return;
  const r=Game.offlineTick(state,ticks);   // H2/H4: 경제+자동사냥+견제까지 정산, 리포트 반환
  render(); saveLocal(true);
  const hrs=elapsedMs/3600000;
  const resLine=Game.RES.map(k=>(r.resGain&&r.resGain[k])?`${k} ${r.resGain[k]>0?"+":""}${r.resGain[k]}`:null).filter(Boolean).join(" · ")||"변동 없음";
  const rw=r.huntRewards?Object.entries(r.huntRewards).map(([k,v])=>`${k}+${v}`).join(" · "):"";
  let h=`<div class="res-line">약 ${hrs<1?Math.round(hrs*60)+"분":hrs.toFixed(1)+"시간"} 동안 <b>${r.turns}틱</b> 자동 진행.</div>`;
  h+=`<div class="res-line k">📦 자원 ${resLine}</div>`;
  if(r.hunts) h+=`<div class="res-line" style="color:var(--green)">⚔ 자동 사냥 ${r.hunts}회${rw?` — ${rw}`:""}</div>`;
  if(r.skirmishes) h+=`<div class="res-line" style="color:${r.lostArmies?'var(--red)':'var(--blue)'}">🛡 견제 전투 ${r.skirmishes}회 · 방어 성공 ${r.skirmishWins}${r.lostArmies?` · 부대 손실 ${r.lostArmies} ⚠`:""}</div>`;
  if(r.built&&r.built.length) h+=`<div class="res-line">🏗 건설 완료 — ${r.built.join(", ")}</div>`;
  if(r.research&&r.research.length) h+=`<div class="res-line">🔬 연구 완료 — ${r.research.join(", ")}</div>`;
  if(r.seasonEnds) h+=`<div class="res-line" style="color:#c084fc">🏆 경쟁 시즌 ${r.seasonEnds}회 마감${r.lastTier?` — 최근 ${r.lastTier}`:""}</div>`;
  if(r.rankBefore&&r.rankAfter&&r.rankBefore!==r.rankAfter) h+=`<div class="res-line" style="color:${r.rankAfter<r.rankBefore?'var(--gold)':'#fca5a5'}">🏆 대륙 순위 #${r.rankBefore} → #${r.rankAfter}${r.rankAfter>r.rankBefore?" (추월당함!)":" ↑"}</div>`;
  h+=`<div class="res-line k">국력 ${r.mightGain>=0?"+":""}${r.mightGain}</div>`;
  showModal(`<h2>🌙 자리를 비운 사이…</h2>${h}<button class="minibtn" id="modalClose">확인</button>`);
}
function newGameReset(){if(!confirm("새 게임을 시작할까요? 저장 안 한 진행은 사라집니다."))return;applySave({...Game.newGame(),ancientOwner:null});toast("🆕 새 게임");}
document.getElementById('saveBtn').onclick=()=>saveLocal(false);
document.getElementById('loadBtn').onclick=loadLocal;
document.getElementById('exportBtn').onclick=exportFile;
document.getElementById('importBtn').onclick=()=>document.getElementById('importFile').click();
document.getElementById('importFile').onchange=e=>{if(e.target.files[0])importFile(e.target.files[0]);e.target.value="";};
document.getElementById('newBtn').onclick=newGameReset;
// ☰ 메뉴(모바일) — 저장/불러오기 등 5개 버튼을 드롭다운으로. 데스크톱 CSS는 이 클래스를 무시(항상 인라인).
(function(){ const mb=document.getElementById('menuBtn'), md=document.getElementById('menuDrop'); if(!mb||!md)return;
  mb.onclick=e=>{e.stopPropagation();md.classList.toggle('hidden');};
  md.addEventListener('click',e=>{ if(e.target.tagName==='BUTTON') md.classList.add('hidden'); });
  document.addEventListener('click',e=>{ if(!md.contains(e.target)&&e.target!==mb) md.classList.add('hidden'); });
})();

/* ===== 턴 / 실시간 루프 (일시정지 가능) ===== */
// 한 틱 = endTurn + 렌더 + 저장 + 사건 처리. 수동 버튼과 실시간 루프가 공유(단일 소스).
function stepTurn(){
  if(state.over) return;
  const r=Game.endTurn(state);
  render(); saveLocal(true);   // 매 틱 자동 저장
  // 전투 알림: 유저 피드백 "적 공격이 정신없다" → 이긴 전투(자동사냥 킬·수성 승리)는 토스트만, 진 전투만 일시정지+모달.
  if(r.enemyBattle){ const b=r.enemyBattle;
    const pWon=(b.w==="A"&&b.aSide==="P")||(b.w==="B"&&b.aSide==="E");
    if(pWon||b.w==="draw"){ toast(`⚔ ${b.result.split('·').slice(0,2).join('·').trim()}`); }   // 승리·무승부 → 흐름 안 끊고 토스트
    else { rtPause(); showBattleModal(b); }   // 패배(부대 전멸/수도 위기)만 멈추고 모달로 확인
  }
  if(r.rankEvent){ const e=r.rankEvent; const rw=e.reward?Object.entries(e.reward).filter(([k,v])=>v).map(([k,v])=>`${k}+${v}`).join(" "):"";   // I3: 경쟁 시즌 마감 — 배너로만(재생 안 끊음)
    showThreatBanner(`🏆 경쟁 시즌 ${e.num} 종료 — <b>${e.tier.name}</b> 달성! (최고 순위 #${e.bestRank}) 보상 ${rw} · 새 시즌 시작`, "warn"); }
  if(r.worldEvent){ const ev=r.worldEvent;   // 정복/함락/레이드(A3) — 진행 이벤트. 유저 요청: 팝업이 재생을 끊는 게 불편 → 정지·모달 없이 배너/토스트로만 안내(게임은 계속).
    const rw=ev.reward?Object.entries(ev.reward).map(([k,v])=>`${k} +${v}`).join(", "):"";
    if(ev.type==="conquest") toast(`🏰 정복! 적 수도 함락${rw?` — ${rw}`:""}`);
    else if(ev.type==="raid"){ if(ev.winner==="P") toast(`🏛 레이드 성공!${rw?` — ${rw}`:""}`); else showThreatBanner("🏛 레이드 실패 — 고대성을 놓쳤습니다. 재도전 가능", "warn"); }
    else if(ev.type==="defeat") showThreatBanner("💥 수도 함락 — 자원 절반 손실·성벽 손상. 주둔군을 재건하세요", "danger");
  }
  else if(r.seasonEvent) showThreatBanner(r.seasonEvent.type==="warning"
    ? `⚠ ${r.seasonEvent.arriveIn}턴 후 시즌 대침공(${r.seasonEvent.count}차) 예고!${r.seasonEvent.previewUnit?` 예상 주력: ${r.seasonEvent.previewUnit}`:""}`
    : `⚔ 시즌 대침공 ${r.seasonEvent.count}차 도착! 병력 ${r.seasonEvent.troops}`, r.seasonEvent.type==="warning"?"warn":"danger");
  else if(r.factionEvents&&r.factionEvents.length) showThreatBanner(`⚔ ${r.factionEvents.map(e=>`${e.faction} 습격대 등장(병력 ${e.troops})${e.target&&e.target!=="P"?` — ${NODES[e.target]?.name||e.target} 노림!`:""}`).join(" · ")}`, "danger");
  else if(r.dragonCompleted&&r.dragonCompleted.length) toast(`🐉 드래곤 성장: ${r.dragonCompleted[r.dragonCompleted.length-1].name}!`);
  else if(r.msCompleted&&r.msCompleted.length) toast(`🏅 마일스톤 달성: ${r.msCompleted[r.msCompleted.length-1].name}!`);
  else if(r.questsCompleted&&r.questsCompleted.length) toast(`🎯 목표 달성: ${r.questsCompleted[r.questsCompleted.length-1].name}!`);
  else if(r.built) toast(`🏗 ${r.built} 완성!`);
  else if(!r.enemyBattle) toast("⏱ 시간 경과 — 수입·생산 정산");
}
// 실시간 상태(UI 전용, 저장 안 함). 기본 일시정지 — 플레이어가 첫 수를 두고 ▶ 재생.
let rtPaused=true, rtSpeed=1, rtTimer=null;
// 유저 피드백: "몇 분 안 됐는데 턴이 몇백 쌓여 T5·수천 자원·수백 병력까지 순식간" — 건설/연구/생산 durations은 전부
// "턴 수"로 정의돼 있는데(예: 건물 3턴), 그 턴이 실시간 2.5초마다 자동으로 흐르니 몇 분이면 수백 턴이 지나가 버림.
// game.js의 개별 상수(TRAIN_TICKS·buildDur·RESEARCH turns 등)를 전부 손대는 대신, 틱 간격 하나만 4배 늦춰
// 건설·연구·생산·수입·AI 위협까지 전부 같은 비율로 느려지게(단일 레버). sim.js는 턴 수 기반이라 이 상수와 무관 — 영향 없음.
const RT_BASE=10000;   // 1x 틱 간격(ms, 기존 2500→10000). 배속 2x=5s·4x=2.5s(구 1x와 동일한 체감).
// 유저 피드백: "10초 동안 게임이 멈춘 것처럼 보인다" — RT_BASE를 4배 늦추니(위) 한 틱 사이에 화면이 전혀
// 안 바뀌는 구간이 길어져 정지처럼 느껴짐. 게임 로직은 그대로 두고, 다음 틱까지 남은 시간을 CSS transition으로
// 채워지는 얇은 진행바로 보여줘 "멈춘 게 아니라 흘러가고 있다"를 시각적으로 알려준다.
// CSS transition(강제 리플로우) 방식은 백그라운드/비포커스 탭에서 컴포지터가 늦게 반영해 안 움직이는 경우가 있어,
// 대신 경과 시간을 직접 계산해 매 프레임 폭을 갱신(requestAnimationFrame) — 더 견고함.
let tickBarSince=0, tickBarRAF=null;
// 유저 피드백(2차): "진행바 말고 화면 전체가 조금씩 움직여야" — 같은 rAF 루프에서 지도도 매 프레임 다시 그려
// 부대 토큰이 틱 사이에도 실제 시간만큼 미리 부드럽게 전진해 보이게(renderMap의 보간식이 tickBarSince를 읽음).
// 패널/자원바는 비용이 커서 매 프레임 안 건드리고 실제 틱(stepTurn)에만 갱신.
function tickBarLoop(){ const f=document.getElementById('tickBarFill');
  if(!f||rtPaused){ tickBarRAF=null; return; }
  const pct=Math.min(100,(Date.now()-tickBarSince)/(RT_BASE/rtSpeed)*100);
  f.style.width=pct+"%";
  if(typeof renderMap==="function") renderMap();
  tickBarRAF=requestAnimationFrame(tickBarLoop); }
function tickBarReset(){ const f=document.getElementById('tickBarFill'); if(f)f.style.width="0%"; if(tickBarRAF){cancelAnimationFrame(tickBarRAF);tickBarRAF=null;} }
function tickBarStart(){ tickBarSince=Date.now(); if(!tickBarRAF) tickBarRAF=requestAnimationFrame(tickBarLoop); }
function rtStop(){ rtPaused=true; if(rtTimer){clearInterval(rtTimer);rtTimer=null;} tickBarReset(); rtSync(); }
function rtPause(){ rtStop(); }
function rtPlay(){ if(state.over)return; rtPaused=false; if(rtTimer)clearInterval(rtTimer);
  tickBarStart();
  rtTimer=setInterval(()=>{ if(!rtPaused&&!state.over){ stepTurn(); tickBarStart(); } }, RT_BASE/rtSpeed); rtSync(); }
function rtToggle(){ rtPaused?rtPlay():rtPause(); }
function rtSetSpeed(s){ rtSpeed=s; if(!rtPaused)rtPlay(); rtSync(); }   // 재생 중이면 재시작으로 간격 반영
function rtSync(){ const pb=document.getElementById('rtPlay'); if(!pb)return;
  pb.textContent=rtPaused?"▶ 재생":"⏸ 일시정지";
  pb.style.background=rtPaused?"":"var(--green)"; pb.style.color=rtPaused?"":"#04240f";
  const tb=document.getElementById('tickBar'); if(tb) tb.style.opacity=rtPaused?"0.25":"1";
  document.querySelectorAll('.rtspeed').forEach(b=>{const on=+b.dataset.spd===rtSpeed;
    b.style.background=on?'var(--gold)':''; b.style.color=on?'#04240f':''; b.style.borderColor=on?'var(--gold)':'';});
}
// 컨트롤 주입 (템플릿 무수정): #endturn 앞에 ▶재생/배속 삽입, #endturn 은 "수동 한 틱".
(function(){ const et=document.getElementById('endturn'); if(!et)return;
  et.textContent="⏭ 한 틱"; et.title="수동으로 한 틱 진행(일시정지 중 유용)";
  const w=document.createElement('span'); w.style.cssText="display:flex;gap:3px;align-items:center";
  w.innerHTML=`<button id="rtPlay" title="시간 재생/일시정지">▶ 재생</button>`
    +[1,2,4].map(s=>`<button class="rtspeed minibtn" data-spd="${s}" title="배속 ${s}x">${s}x</button>`).join("")
    +`<span id="tickBar" title="다음 턴까지" style="display:inline-block;width:34px;height:6px;background:var(--line);border-radius:3px;overflow:hidden;opacity:.25"><span id="tickBarFill" style="display:block;height:100%;width:0%;background:var(--green)"></span></span>`;
  et.parentNode.insertBefore(w, et);
  document.getElementById('rtPlay').onclick=rtToggle;
  w.querySelectorAll('[data-spd]').forEach(b=>b.onclick=()=>rtSetSpeed(+b.dataset.spd));
})();
document.getElementById('endturn').onclick=stepTurn;
document.getElementById('castleBtn').onclick=()=>{state.pendingMove=null;state.selected={kind:"node",id:"P"};render();};
svg.addEventListener('click',()=>{state.selected=null;state.pendingMove=null;state.mode="normal";closeSheet();render();});
// ---- 바텀시트(모바일) — 부대/성 선택 시 자동으로 펼침, 지도 배경 탭·손잡이 탭으로 접음. 데스크톱은 CSS가 무시(항상 펼침 레이아웃).
function openSheet(){ document.getElementById('panel')?.classList.add('sheetOpen'); }
function closeSheet(){ document.getElementById('panel')?.classList.remove('sheetOpen'); }
const isSheetOpen=()=>!!document.getElementById('panel')?.classList.contains('sheetOpen');
(function(){   // 퀵바 4칸(목표/내정/부대출전/선택) — 이미 그 화면이 열려 있으면 탭해서 닫고, 아니면 그 컨텍스트로 열기.
  const qq=document.getElementById('qcQuest'), qc=document.getElementById('qcCastle'), qd=document.getElementById('qcDeploy'), qs=document.getElementById('qcSel'), qm=document.getElementById('qcMap');
  if(!qq) return;   // 구버전 템플릿 방어
  // 유저 피드백: 내정 시트(78vh)가 열리면 지도가 완전히 가려져 타일을 탭할 수 없음(시트가 위에서 다 가로챔) —
  // 스크롤 깊이·탭과 무관하게 항상 닿는 손잡이(sticky)에 "지도로" 전용 버튼을 둬서 즉시 지도로 복귀 가능하게.
  if(qm) qm.onclick=()=>{ state.selected=null; state.pendingMove=null; state.mode="normal"; closeSheet(); render(); };
  qq.onclick=()=>{ if(!state.selected && isSheetOpen()) closeSheet();
    else { state.selected=null; state.infoOpen=true; openSheet(); } render(); };
  qc.onclick=()=>{ const active=state.selected?.kind==="node"&&state.selected.id==="P"&&state.castleTab!=="출전";
    if(active && isSheetOpen()) closeSheet();
    else { state.pendingMove=null; state.selected={kind:"node",id:"P"}; if(state.castleTab==="출전")state.castleTab="건물"; openSheet(); } render(); };
  if(qd) qd.onclick=()=>{ const active=state.selected?.kind==="node"&&state.selected.id==="P"&&state.castleTab==="출전";   // 유저 요청: '⚔부대출전' 고정 칸 — 항상 성 출전 화면으로 직행
    if(active && isSheetOpen()) closeSheet();
    else { state.pendingMove=null; state.selected={kind:"node",id:"P"}; state.castleTab="출전"; openSheet(); } render(); };
  qs.onclick=()=>{ isSheetOpen()?closeSheet():openSheet(); render(); };   // 현재 선택 대상은 바꾸지 않고 열기/닫기만
})();
// ---- 지도 드래그 팬(모바일) — .mapbox가 svg보다 작을 때만 의미 있음(데스크톱은 콘텐츠가 꽉 차 사실상 무동작).
let resetMapPan=()=>{};
(function(){ const box=svg.parentElement; if(!box) return;
  let pan={x:0,y:0}, drag=null;
  const apply=()=>{svg.style.transform=`translate(${pan.x}px,${pan.y}px)`;};
  const clamp=()=>{ const bw=box.clientWidth,bh=box.clientHeight, r=svg.getBoundingClientRect(), sw=r.width||bw, sh=r.height||bh;
    const minX=Math.min(0,bw-sw), minY=Math.min(0,bh-sh);
    pan.x=Math.max(minX,Math.min(0,pan.x)); pan.y=Math.max(minY,Math.min(0,pan.y)); };
  resetMapPan=()=>{ pan={x:0,y:0}; apply(); };
  const startDrag=(id,x,y,pid)=>{ drag={id,x,y,ox:pan.x,oy:pan.y,moved:false,pid}; };
  // 실제로 임계 이상 움직였을 때만 setPointerCapture — 즉시 잡으면 순수 탭(드래그 없음)의 click이
  // 항상 box로 리다이렉트되어 타일/부대 클릭이 전부 씹히는 버그가 됐었음(포인터 캡처 사양상 부작용).
  const moveDrag=(id,x,y)=>{ if(!drag||drag.id!==id) return;
    const dx=x-drag.x, dy=y-drag.y;
    if(!drag.moved && (Math.abs(dx)>4||Math.abs(dy)>4)){ drag.moved=true;
      if(drag.pid!=null){ try{box.setPointerCapture(drag.pid);}catch(err){} } }
    if(drag.moved){ pan.x=drag.ox+dx; pan.y=drag.oy+dy; clamp(); apply(); } };
  const endDrag=id=>{ if(drag&&drag.id===id&&drag.moved){ const swallow=ev=>{ev.stopPropagation();ev.preventDefault();box.removeEventListener('click',swallow,true);};
    box.addEventListener('click',swallow,true); } if(!drag||drag.id===id) drag=null; };
  // 포인터 이벤트(실제 터치·마우스 — 대부분의 브라우저가 여기로 통합) + 레거시 마우스 이벤트(구형/일부 자동화 환경 폴백).
  box.addEventListener('pointerdown',e=>{ startDrag('p',e.clientX,e.clientY,e.pointerId); });
  box.addEventListener('pointermove',e=>moveDrag('p',e.clientX,e.clientY));
  box.addEventListener('pointerup',()=>endDrag('p')); box.addEventListener('pointercancel',()=>endDrag('p'));
  box.addEventListener('mousedown',e=>{ if(!drag) startDrag('m',e.clientX,e.clientY); });
  window.addEventListener('mousemove',e=>{ if(drag&&drag.id==='m') moveDrag('m',e.clientX,e.clientY); });
  window.addEventListener('mouseup',()=>{ if(drag&&drag.id==='m') endDrag('m'); });
})();
render(); rtSync();
try{ if(localStorage.getItem(SAVE_KEY)) toast("이전 저장 있음 — 📂 눌러 이어하기 · ▶ 재생으로 시간 시작"); }catch(e){}
