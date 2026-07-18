# 실행 로드맵 — 지속형 왕국 (KoA-like 솔로)

> 방향·원칙은 [기획서 §13](기획서.md). 이 문서는 **실행 단위**로 쪼갠 작업 목록(하나씩 구현→검증→커밋).
> 작업 방식: 단일 소스 원칙 유지 · 각 단계 `node build.js && node verify.js`(+ 필요시 sim/브라우저) 통과 후 커밋 · game.js/engine.js 순수 유지(실시각·DOM은 ui 레이어).

범례: `[ ]` 예정 · `[~]` 진행 중 · `[x]` 완료

---

## Milestone A — 지속형 성장 루프 (기반) ✅ **완료** (2026-07-18)

"매치 → 지속 왕국" 전환의 토대. 나머지(B·C)가 전부 이 위에 얹힘.

### A1. 국력(Might) 점수 — 성장 척추 ✅
왕국의 강함을 단일 수치로 요약, 상단 상시 표시. 모든 성장이 이 숫자를 올린다(KoA의 중심 감각).
- [x] `game.js computeMight(g)` — 가중합: 성 레벨×20 · 성벽×10 · 건물레벨×8 · 경제건물×4 · 완료연구×10 · 병력(티어가중 1/1.6/2.4)×0.6 · 영웅등급×15.
- [x] API export(`computeMight`) + node 스모크로 각 요소 증가 시 단조 상승 확인.
- [x] `ui.js`: 자원바에 `⚔ 국력 N (적 M)` 배지.
- [x] `enemyMight(g)` — 적 병력 규모 기반 단순 위협 지표(선택 사항, 구현 완료).
- **크기**: 실측 소(반나절). 의존성 없음.

### A2. 마일스톤 사다리 — 장기 목표·해금 ✅
국력 문턱마다 보상·해금. "다음 목표"가 항상 존재.
- [x] `game.js MILESTONES` = [{id,name,need(might),reward,unlock,desc}] 5단계(150/280/450/650/900) — 봇 하한선 플레이테스트로 보정(§ sim.js).
- [x] `milestoneTick(g)` (endTurn·offlineTick 공통) — 순차 완료·보상·해금 플래그(`g.milestones.unlocked`). 저장에 포함.
- [x] **해금 게이팅**: `armySlotsMax(g)`/`wallMaxLv(g)` — "slot"/"wall" 해금 시 각각 +1(최대 +2)로 상한 확장. `resolveBattle`/`ui.js` 성벽 UI 연동.
- [x] `ui.js renderMilestone()`: 다음 마일스톤 진행바(국력 X/Y) — 온보딩 퀘스트 박스 바로 아래.
- **크기**: 실측 중(반나절). A1 의존.
- **후속 수정(2026-07-18)**: 완성도 리뷰에서 "국력 900(m5) 이후 다음 목표가 사라지는 엔드게임 절벽" 발견 — `milestoneAt(idx)`로 5단계 이후엔 `proceduralMilestone(idx)`이 "왕국 칭호"(남작→자작→백작→후작→공작→대공→왕, 이후 "N기"로 순환)를 무한 생성하도록 확장. need는 직전값×1.4(지수), 보상도 회차만큼 증가. `ui.js renderMilestone()`도 배열 끝에서 숨는 대신 항상 다음 목표를 표시하도록 변경.

### A3. 비종결 플레이 — 지속 왕국 전환 ✅
적 함락·레이드가 "게임오버"가 아니라 진행 이벤트. 왕국은 계속.
- [x] `game.js checkVictory` 재설계: `g.over` 더 이상 true로 설정 안 함(레거시 필드만 남김). 정복(P가 무방비 E점거)/함락(E가 무방비 P점거)/레이드완수 모두 **edge-trigger**(`g._eArmed`/`g._pArmed`)로 1회만 이벤트 발동 → 상대가 재정비하면 재무장.
  - 정복: 보상 지급 + `g.conquests++` + 적 잔여 세력 정리(본대 재건은 다음 aiTurn에서 자동).
  - 함락(패배): 자원 절반 손실 + 성벽 −2 + `g.defeats++` + 침공군 물러남. 즉시 종료 없음.
  - 레이드 완수: 승/패측 보상·카운트(`raidWins`/`raidLosses`) 후 리셋 → 재도전 가능.
- [x] `ui.js showWorldEventModal(ev)` — 정복/함락/레이드를 "게임오버 모달" 대신 사건 안내 모달로 표시, `rtPause()`로 관전 시간 확보. 구 `endGame()`(승패 모달) 제거 — 도달 불가능해진 코드.
- [x] `sim.js` 지표 전환: 승/패/시간초과 → 400턴 종료 시 평균 국력·정복/함락/레이드 횟수.
- **검증**: 브라우저에서 idle 방치 → `defeat` 이벤트 edge-trigger 1회만 발동·게임 지속 확인(over:false, turn 계속 증가, 적 본대 재건됨). 봇 시뮬 400판 정상.
- **크기**: 실측 중(반나절).

### A4. 오프라인 누적 — "돌아오면 자라있음" ✅
자리 비운 실시간만큼 자원·생산·연구·건설이 상한 내 진행(결제벽 아닌 재미 훅).
- [x] 저장에 `savedAt`(`Date.now()`) 기록 — `ui.js saveSnapshot()`만. game.js는 여전히 순수(시각 개념 없음).
- [x] `game.js offlineTick(g,ticks)`(순수, ticks만 받음) — income/생산/연구/건설/치료/퀘스트/마일스톤 진행, **전투·AI 원정은 스킵**(불공정 기습 방지). 하드 안전상한 20000틱.
- [x] `ui.js offlineCatchup(data)`: 경과ms/`RT_BASE`(1x 기준)로 틱수 계산, **12시간 상한** clamp → `Game.offlineTick` 호출 → "🌙 자리를 비운 사이…" 요약 모달(경과시간·틱수·자원 증감).
- **검증**: 브라우저에서 `savedAt`을 3시간·48시간 전으로 조작 후 `loadLocal()` → 3시간=4320틱 정상 정산, 48시간=12시간 상한(17280틱)에서 clamp 확인.
- **크기**: 실측 중(반나절). A1~A2 위에서 의미. **실시각은 ui.js에서만** 유지.

---

## Milestone B — 위협 & 세계 (escalating + 탐험)

성장 루프 위에 "다음 위험"과 탐험. (A 완료 후 상세화)

### B1. 다수 세력 ✅ (2026-07-18, "성 없는 세력" 방식으로 축소 구현)
사용자와 논의 후 방향 조정: 세력별 전용 성/영토를 두는 정공법은 노드맵·타일맵 두 템플릿을 동시에 확장해야 하고 `checkVictory`/`pickAITarget`/`resolveBattle`의 `node==="P"/"E"` 하드코딩을 전부 일반화해야 해 파급이 큼. 대신 **성 없는 독립 습격 세력**으로 구현 — `side`는 여전히 "E"라 기존 정복/함락 판정을 그대로 재사용(엔진·판정 로직 무변경), 이름·병종 편향·주기로만 서로 다른 위협처럼 느껴지게 함.
- [x] `game.js FACTIONS`=[도적단(경기병·중기병 편향, 45턴 주기), 오크 군세(중갑보병·창병 편향, 65턴 주기)] — `factionTick(g)`이 `randomTile(g)`(야생 타일)에서 등장시켜 곧장 P로 진군(`orderMove`).
- [x] `endTurn`에서 `seasonTick` 다음에 실행, `offlineTick`엔 미연결(오프라인 기습 방지 원칙 동일 적용).
- [x] `ui.js` — 습격대 등장 토스트, 구버전 세이브 호환.
- **검증**: `sim.js` 400턴 기준 습격대 14회 발생, 함락 3.46회(B2/B4 이전 0.35 → 이번 누적 3.46, 트레이스로 자원 회복 패턴 재확인 — 비종결 설계 덕에 안정적).
- **미룬 것**: 세력별 영웅 라인업 차별화(§4-B)는 성 없는 방식과 어울리지 않아 보류. 필요해지면 "습격대 지휘관" 개념으로 재검토.

### B2. 시즌형 침공 (escalating) ✅ (2026-07-18)
- [x] `game.js seasonTick(g)` — 60턴 간격(회차마다 최소 30턴까지 단축)으로 예고(12턴 전)→도래. 규모는 `max(기본30×1.35^(n-1), 국력×0.22)`로 횟수와 국력 둘 다에 연동. 기존 AI 예산/웨이브 로직과 독립된 스크립트 이벤트라 회귀 위험 없음. `endTurn`에서 `aiTurn` 다음·`moveTick` 전에 실행, `offlineTick`에는 미연결(자리 비운 사이 기습 방지).
- [x] `ui.js renderSeason()` — 다음 시즌까지 남은 턴 패널(예고 시 붉게), `stepTurn()`에서 예고/도래 토스트.
- **검증**: 브라우저에서 `stepTurn()` 반복 → 턴48 예고, 턴61 도래(1차 30병)·다음 창구 60→57턴으로 단축 확인. `sim.js` 400턴 8회 발생.

### B3. 안개·탐험·영토 확장 — ❌ **폐기 확정** (2026-07-18, 사용자 결정 — 더 이상 검토 안 함)
- [~~fog of war ON(§10에서 껐던 것 복원). 정찰/시야로 맵 개방.~~]
- [~~노드/타일 점령 = 영토. 영토가 국력·수입에 기여.~~]
- 처음엔 "보류"였으나 재검토 결과 불필요하다고 판단 — 향후 이 방향으로 다시 제안하지 않는다.

### B4. 스케일링 PvE ✅ (2026-07-18)
- [x] `game.js monsterScale(g)` = `min(3, 1+max(0,국력-100)/400)` — 국력100↓ 1.0배, 국력900(마지막 마일스톤) 3.0배 상한. `mkMonster`/`spawnRoamer`(스폰·재등장 시점)에 적용 — engine.js 전투 수치는 무변경, 몬스터 **병력 수**만 스케일.
- [x] **월드 보스(ANCIENT 레이드 보스) 재등장** — 기존엔 `mtier==="레이드"`가 respawn 대상에서 제외돼 한 번 죽으면 다시 안 나타나는 갭이 있었음(A3에서 "다시 나타나 재도전 가능"이라 이미 안내했는데 미구현이었던 부분). `resolveBattle` 킬 시점에 `g.raidBossGen++` 후 24턴 뒤 재등장 예약, `processRespawns`가 `ancientTemplate()`(타일맵 MSPAWN.raid·노드맵 MONSTERS 배열 양쪽 지원)로 세대(`gen`)당 +20%씩 강화해 재소환.
- [x] `ui.js` — 노드 패널에 `(강화 ×N.N)`, ANCIENT는 `N세대` 태그.
- **검증**: node 스크립트로 보스 처치→24턴 후 재등장(오우거6→7·오크12→14·하피8→10, ×1.2) 확인. `sim.js` 400턴 시점 평균 스케일 ×1.91(국력 462 기준, 공식과 일치).

---

## Milestone C — 정체성 (드래곤·영웅 깊이·병종 확장) ✅ **완료** (2026-07-18)

작동하는 왕국 위에 얹는 훅. 실행 순서(크기·리스크 작은 것부터): **C2(영웅 특성 확장) → C1(드래곤) → C3(공성 소모품)** — 계획대로 진행, 사용자가 "1부터 3까지 꼼꼼하게" 지시해 한 세션에 전부 반영.

### C2. 영웅 깊이 — 승급을 특성 2択 결정으로 ✅
- [x] `hero.trait`(단일) → `hero.traits`(배열). `heroTraits(h)`(복수)+`traitSum(h,field)`로 일반화 — 동일 필드는 합산(예: atkBonus 2개면 +10%p). 적용 지점 5곳(`resolveBattle`/`buildRate`/`gatherOf`/`armySpeed`/`startResearch`) 전부 갱신.
- [x] `promoteHero(g,hid)`: 자원 확인 후 `g.pendingPromote={hid,options:[2개]}`만 세팅(즉시 승급 안 함) — 미보유 특성 우선, 3회째부터 후보 소진되면 중첩 강화 허용. `choosePromoteTrait(g,hid,traitId)`가 실제 등급+자원 차감+특성 추가. `cancelPromote(g)`로 취소 가능.
- [x] `ui.js`: 영웅 카드에 특성 2択 버튼(대기 중엔 기존 액션 버튼 대신 표시). `heroEffect()`가 traits 배열 전부 나열. 구버전 세이브(`hero.trait` 단일)를 `applySave()`에서 1회 이관.
- **검증**: node 스모크로 grade1→3 두 번 승급 시 특성 3개(풀 소진 시 중첩) 확인, 브라우저 승급→2択→적용 흐름 확인. `verify.js` 12 PASS.

### C1. 드래곤 — KoA 상징, 성장 축 ✅
독립적인 신규 시스템 — engine.js 6유닛 체계·verify.js 밸런스에 손대지 않고 **영웅과 같은 "버프 제공자" 패턴**으로 격리 구현.
- [x] **획득**: 게임 시작부터 알 보유(`_baseGame() dragon:{stage:0}` — 별도 획득 이벤트 없음, 사용자 결정).
- [x] **육성**: 전용 자원 **"용린"**(`g.dragonScale`, 영웅 xpItems와 완전 분리) — 몬스터 처치 시 지급(사냥0/토벌2/레이드8). `DRAGON_STAGES`(알→새끼 용→어린 용→성체 용, buff 0/15/35/65%)를 퀘스트/마일스톤과 같은 순차 idx 패턴(`dragonTick`)으로 자동 승급.
- [x] **전투 참여**: `army.dragon=true` 불리언 플래그(유일 개체라 영웅처럼 id 참조 불필요)로 위치 추적. `assignDragon(g,loc)`. `resolveBattle`의 aB/dB에 가산, `defendCastle`도 수비 부대에 드래곤 있으면 전파. 전투 모달에 참전 표시.
- [x] **스킬**: 범위 밖으로 보류(단계별 buff만으로 충분, 필요성 낮음 판단).
- **검증**: `verify.js` 12 PASS(엔진 무변경), `sim.js` 지표 불변(봇은 드래곤 안 씀), 브라우저에서 드래곤 있음/없음 전투 생존자 수 비교로 버프 실효 확인.

### C3. 병종·공성 확장 — 공성 소모품만 ✅ (병종 다양화는 보류)
티어 확장(T3→T5)은 완성도 개선 라운드에서 이미 완료(`TIER_MAX`,`tierCap`).
- [x] **파성추**: 신규 유닛 아닌 소모성 제작품(`SIEGE_COST`, `g.castle.siegeItems`, `craftSiege(g)` — 건설 큐 밖 즉시 제작). 공성 전투 시 P가 보유하면 1개 소모해 `fort` 방어 보정을 추가 완화(공성술 有 0.05→0, 無 0.22→0.12).
- [x] **병종 다양화 — 보류 확정(2026-07-18, 사용자 결정)**: 진짜 7번째 유닛 추가는 `engine.js UNITS`·`verify.js NAMES`·6유닛 삼각 밸런스 전체에 영향이 커서, 사용자가 "이 이상 늘리지 않아도 될듯"이라 결정 — **더 이상 검토하지 않음**. 6유닛 체계로 확정.
- **검증**: `verify.js` 12 PASS(6유닛 수치 무변경), node 스모크로 파성추 사용 시 공성 전투 생존자 수가 유의미하게 개선됨 확인(예: survA 1→6, survB 5→4).

---

## Milestone D — 리텐션·폴리시 (후순위)
데일리·이벤트·선택지 + UI·아트·PWA 오프라인. (핵심 루프 검증 후)

---

## 완성도 리뷰 후속 조치 (2026-07-18)

Milestone A·B(B1·B2·B4) 완료 후 게임 전체 완성도를 리뷰해 5개 개선점을 찾고, 1(엔드게임 절벽)은 위 A2에 반영. 나머지 4개도 순서대로 처리:

- **영웅 특성(trait)**: 승급이 "항상 예"인 무결정이라, 대신 **영입 시점에 무작위 특성**이 붙어 "어느 후보를 뽑을까"가 진짜 결정이 되게 함. `game.js HERO_TRAITS`(전투: 돌격형·수호형·기동형 / 내정: 건축가·학자·상인) — `resolveBattle`(공/수비 버프) · `buildRate`(건설속도) · `startResearch`(연구기간) · `gatherOf`(채집량) · `armySpeed`(이동속도)에 각각 반영. `heroEffect()` 툴팁에 자동 표시(UI 추가 작업 없이 기존 표시 지점 재사용).
- **위협 예고 정보**: 시즌 예고 시점에 `playerCounterUnit(g)` 스냅샷을 `s.previewUnit`으로 저장해 예고·도래에 같은 값을 씀(예고가 거짓말 안 함) — "예상 주력: OO" 표시. 습격 세력 목록(이름·병종)을 패널에 상시 표시(`renderFactionInfo`)해 정보 없이 오는 위협을 없앰.
- **티어 확장(T3→T5)**: `TIER_MAX`=5로 확장, T4(전설)·T5(신화)는 `tierCap(g)`이 마일스톤 해금(m4="tier4", m5 unlock 배열에 "tier5" 추가) 전엔 3으로 묶어둠. AI는 별도 `AI_TIER_MAX=3`로 고정해 플레이어 해금과 무관하게 성장(불균형 방지). `unlock` 필드가 배열도 받도록 `milestoneTick` 일반화.
- **위협 다양성**: 3번째 세력 **야습대**(prey형) 추가 — 성이 아니라 **야외에 나가있는 아군 부대**(채집대 등)를 무작위로 노림. "다 성으로만 몰려온다"는 반복감을 깨고 "원정 나간 부대를 방치하면 위험하다"는 새 판단을 만듦.

**검증**: `node verify.js` 12 PASS, `node sim.js`(습격대 3종 22회/400턴, 함락 4.27회 · 레이드패 12.6회로 상승 — 레이드패는 페널티 없는 카운터라 문제 아니고, ANCIENT가 보스 재등장 전 24턴간 상시 경합 오브젝트가 되는 자연스러운 현상. 자원 회복 패턴은 여전히 유지), 브라우저에서 특성 표시·티어 게이팅 문구·습격 세력 정보·prey 타겟팅(야외 부대 있을 때 그쪽으로 진군) 확인.

## 모바일 UX/UI 개선 (2026-07-18)

375px 실기기 뷰포트로 직접 열어 문제를 실측: 맵이 가로 스크롤 필요(672~780px 고정폭) + 패널이 맵 아래(세로 스크롤도 필요) → **두 방향 스크롤**이 동시에 필요해 방향감각을 잃는 게 핵심 문제. 2단계로 개선(전부 CSS 미디어쿼리·JS 로직으로만, 데스크톱은 무변화):

- **정보 아코디언**: 퀘스트·마일스톤·시즌·세력정보 4개 박스를 `renderInfoAccordion()` 하나로 묶어 접고 펼침(기본 펼침, `state.infoOpen`).
- **☰ 메뉴**: 저장/불러오기/내보내기/가져오기/새게임 5버튼을 모바일에서만 드롭다운 뒤로 숨김(`#menuDrop`+`#menuBtn`, `.menu-drop`이 데스크톱 기본은 `display:flex`라 무변화, 820px 이하에서만 `position:absolute`+숨김 토글).
- **지도 드래그 팬**: `.mapbox{height:52vh;overflow:hidden;touch-action:none}` + JS로 `svg`에 `transform:translate()` 적용, pointerdown/move/up(+마우스 폴백)으로 드래그, 경계 clamp. **함정**: `svg.offsetWidth`는 SVG 루트 엘리먼트에서 `undefined`(HTMLElement 전용 속성이라 SVGElement엔 없음) → `getBoundingClientRect().width`로 교체해야 함. 드래그 후 릴리스 시 바로 아래 노드가 클릭되지 않도록 캡처 단계에서 다음 클릭 1회를 삼킴.
- **패널 → 바텀시트**: `.panel{position:fixed;bottom:0;max-height:18vh(접힘)/78vh(펼침)}`, `#sheetHandle` 탭이나 부대/성 선택 시(`openSheet()`) 자동으로 펼쳐짐, 지도 배경 탭이나 손잡이 재탭으로 접힘(`closeSheet()`). 템플릿에 `#panel > #sheetHandle + #panelBody` 구조 추가, `renderPanel()`의 렌더 타깃을 `#panel`→`#panelBody`로 변경.

**검증**: 375×812 뷰포트에서 CSS 계산값(52vh/18vh/78vh) 확인, `PointerEvent` 직접 디스패치로 팬·클램프·리셋 동작 확인, `sheetHandle`/`menuBtn` 프로그래매틱 클릭으로 토글 확인, 1280px 데스크톱에서 기존 사이드바이사이드 레이아웃 무변화 확인. (참고: 이 세션의 브라우저 자동화 `left_click_drag`는 중간 move 이벤트를 안 쏘는 것으로 보여 실제 드래그 제스처 자동화 검증엔 한계가 있었음 — 실기기 확인 필요.)

## Milestone E — 볼륨업 (프로토타입 → "정식 출시" 체감)

Milestone A~C로 시스템 가짓수는 갖췄지만 "다 얇게 존재만 한다"는 사용자 피드백(2026-07-18) — 항목별로 깊이를 채우는 단계. 순서: **엔진 밸런스 리스크 없는 것부터, 매 판 체감이 바뀌는 것부터**.

### E1. 영웅·드래곤 깊이 확장 ✅ (2026-07-18)
- [x] `HERO_TRAITS` 전투/내정 각 3→5종 확장 — 신규: 사냥꾼(몬스터 상대 버프)·인내형(부상률 감소) / 감독관(자원 건물 산출)·보급관(식량 유지비 감소). `resolveBattle`(vsMonsterBonus를 `defender.side==="M"` 조건부 가산, `wound()`에 `woundReduce` 반영)·`econIncome`(econBonus)·`foodUpkeep`(upkeepReduce) 4곳에 새 필드 배선.
- [x] 드래곤 스킬 시스템 — 단계 상승(egg 제외 3회) 때마다 `DRAGON_SKILLS`(화염 숨결·비늘 강화·괴수 사냥꾼·위압의 포효) 2択, 영웅 승급 2択과 동일 패턴(`pendingDragonSkill`→`chooseDragonSkill`) 재사용. `resolveBattle`에 `dragonSkillSum()` 가산, "위압의 포효"는 `factionTick`의 습격대 규모를 완화.
- **검증**: `node verify.js` 12 PASS(engine.js 무변경), `node sim.js` 지표 불변(봇은 승급·드래곤 스킬을 안 씀), node 스모크로 각 특성/스킬의 실제 수치 차이 확인(예: flame 스킬 有/無 survA·survB 비교), 브라우저에서 2択 UI 클릭 흐름 확인.
### E2. 몬스터·보스 개성 ✅ (2026-07-18)
- [x] `engine.js UNITS` 몬스터 kind 재배정 — 하피(`gen_ab`, proc 0.4, 공중 기습으로 전열+후열 동시 타격) · 오우거(`spec`, 전열 특화 강타 ×1.4). 새 메커니즘 발명 없이 플레이어 유닛에도 쓰는 기존 kind 체계를 몬스터에 재사용(리스크 최소, `verify.js`는 `monster:true`를 걸러내 무영향).
- [x] 월드 보스 격노 — `resolveBattle()`에서 `defender.mtier==="레이드" && raidBossGen>0`이면 전투 개시 즉시 공격측 병력 `min(30%, 8%×세대)` 선제 손실(`attacker.comp` 직접 차감, engine.js 무변경). "재도전은 더 준비해서" 압박용. `sum.enrageLoss`로 UI 전달.
- [x] `ui.js` — 노드 패널 몬스터 구성 줄에 `MONSTER_ROLE`(하피:기습형, 오우거:돌격형) 태그 표시. 전투 모달에 격노 발동 시 "💢 고대 생물이 포효하며 선제 강타! 공격측 병력 -N%" 표시.
- **검증**: `node verify.js` 12 PASS(engine.js 몬스터만 변경, NAMES 필터 대상 외), `node sim.js` 지표 정상 범위(회귀 없음). 브라우저에서 실제 몬스터 노드(고블린 무리: 오크6/하피6/오우거2) 패널에 역할 태그 렌더링 확인, `raidBossGen=2`로 `resolveBattle` 직접 호출해 `enrageLoss=16` 확인, `showBattleModal`에 격노 메시지 렌더링 확인.
- **미착수**: E3(전투 연출/피드백) · E4(연구 트리 갈림길화) · E5(중후반 온보딩 확장) — 다음 세션에서 순서대로.

### E3. 전투 연출/피드백 ✅ (2026-07-18)
- [x] `engine.js simulate()` — 라운드별로 누적하던 `ev.proc`/`ev.counter`를 전투 전체 합계로 반환(`totalProc`,`totalCounter`, `rounds`는 기존에 이미 있었음). 전투 수치(밸런스)는 무변경 — 결과 요약 필드만 추가.
- [x] `game.js resolveBattle()` — `sum`에 `rounds`·`totalProc`·`totalCounter`와, 승자 측 생존율 기반 `margin`(압승≥70%·신승≥35%·박빙) 판정 추가.
- [x] `ui.js showBattleModal()` — "N R 만에 결판 · 특수 N회 · 창병 요격 N회 · 🟢압승/🟡신승/🟠박빙" 한 줄 추가. `defendCastle()`은 내부적으로 `resolveBattle()`을 호출하므로 별도 배선 없이 자동 적용.
- **검증**: `node verify.js` 12 PASS(engine.js 전투 수식 무변경, 반환값만 추가), `node sim.js` 지표 정상 범위. node 스모크로 `rounds`/`totalProc`/`margin` 실값 확인(2연전 각각 압승 케이스), 브라우저에서 실제 몬스터 전투로 모달 렌더링 확인("6R 만에 결판 · 특수 2회 · 🟢 압승").
- **미착수**: E4(연구 트리 갈림길화) · E5(중후반 온보딩 확장) — 다음 세션에서 순서대로.

### E4. 연구 트리 갈림길화 ✅ (2026-07-18)
- [x] `game.js RESEARCH` — 병종 그룹(보병/궁병/기병)마다 공격 II·방어 II를 모두 마치면 열리는 캡스톤 갈림길 추가: "{그룹} 특화: 결전"(공격 +20%) vs "{그룹} 특화: 철벽"(방어 +20%) — **상호 배타**, 하나를 연구하면 나머지는 영구 잠김. 기존 `mod:{group,stat,mul}`/`researchMods()` 파이프라인을 그대로 재사용(새 연산 없음), `excludes` 필드 하나만 신설.
- [x] `startResearch(g,k)` — `excludes` 검사 추가(이미 배타 연구 완료 시 차단, 메시지 "상호 배타 연구 — 이미 다른 노선을 선택함").
- [x] `ui.js` — 연구 목록에서 배타로 잠긴 항목을 `🚫 {이름} "{선택한 노선}" 선택으로 불가`로 표시(기존 `🔒 선행 연구 필요` 패턴과 동일한 자리에 새 분기 추가).
- **검증**: `node verify.js` 12 PASS(engine.js 무변경 — 연구는 game.js 레벨 배율일 뿐), `node sim.js` 지표 정상 범위(봇은 이 정도 심화 연구까지 안 감 — 불변 확인용 시그널). node 스모크로 결전 선택 후 철벽 시도 시 정확히 차단되는 것과 배율 누적(1.15×1.15×1.20=1.587) 확인, 브라우저에서 실제 연구 패널에 ✅완료/🚫잠김 렌더링 확인.
- **미착수**: E5(중후반 온보딩 확장) — 다음 세션에서.

### E5. 중후반 온보딩 확장 ✅ (2026-07-18)
- [x] `game.js QUESTS` — 기존 8단계(초반 빌드 가이드)에 5단계 이어붙임: 용의 동행(드래곤 배치)·영웅 승급(★3 승급)·공성 준비(파성추 제작)·고대성 도전(레이드 승리)·시즌 대침공(첫 시즌 침공 방어). **같은 순차 체인 패턴 재사용**(선형 idx, `done(g)` 순수 조건, 완료 시 보상) — 새 UI·새 자료구조 없이 `renderQuests()`가 그대로 표시.
- [x] `questTick(g)` — 보상이 `g.res`가 아닌 자원(용린·경험치)인 항목을 위해 `q.dragonScale`/`q.xp` 필드 지원 추가.
- [x] `ui.js renderQuests()` — 보상 표시 줄에 `용린+N`/`경험치+N`도 합쳐서 보이도록 확장.
- **버그 발견·수정**: "영웅 승급" 조건을 처음엔 `h.grade>=2`로 짰다가 스모크 테스트 중 **시작 영웅이 이미 grade 2**(로한·카이)라 게임 시작 즉시 완료돼버리는 걸 발견 — 최고 등급이 3이므로 `h.grade>=3`(실제 승급 1회 이상)으로 수정. **교훈**: 온보딩 조건은 항상 `newGame()` 직후 상태로 스모크 검증할 것 — "이미 만족된 조건"은 브라우저에서 눈으로 봐도 안 걸리고 node 스모크라야 잡힌다.
- **검증**: `node verify.js` 12 PASS(engine.js 무관), `node sim.js` 지표 정상 범위. node 스모크로 13단계 전체 순차 완료(드래곤 배치→승급→공성→레이드→시즌) 및 보상 지급 확인, 브라우저에서 "목표 9/13 용의 동행" 렌더링 확인.
- **Milestone E(볼륨업) 전체 완료**(E1~E5).

## Milestone F — 아발론식 심화 시스템 (병영 분리·영웅 위원회·드래곤 트리·군주+장비·연구 다양화)

King of Avalon 구조를 조사(세션 대화 참고) 후 사용자가 5개 항목을 확정: F1(병영별 독립 훈련) → F5(연구 다양화) → F3(드래곤 선행조건 트리) → F2(영웅 위원회) → F4(군주+장비) 순서로 진행. 상세 설계는 계획 파일(`eager-cuddling-pearl.md`) 참고 — 전부 engine.js 무변경, 기존 traitSum/dragonSkillSum/researchMods 파이프라인 재사용 원칙.

### F1. 병영별 독립 훈련 큐 ✅ (2026-07-18)
- [x] `castle.queue`: 단일 배열 → 건물명 키 오브젝트(`{병영:[...],궁수대:[...],마구간:[...]}`). `produce()`가 `UNIT_BLD[u]`로 해당 건물 큐에 push.
- [x] `tickProduction(g)` 신규 헬퍼 — 건물마다 `buildRate(g)`씩 **동시에** 소비(병영 3개면 최대 3배 산출). `endTurn`/`offlineTick` 두 곳에 중복돼 있던 한 줄짜리 처리 로직을 이 함수 호출로 통합(중복 제거 겸함).
- [x] `applySave()` — 구버전 세이브(`castle.queue`가 배열)를 `UNIT_BLD[baseOf(u)]` 기준으로 건물별 오브젝트로 재분배(유닛 유실 방지).
- [x] `ui.js` — 성 패널 상단 대기열 표시는 전체 합계 유지, 건물 목록의 각 항목 아래에 그 건물만의 대기열(`⏳ 유닛,유닛...`) 추가.
- **검증**: `node verify.js` 12 PASS(engine.js 무관). node 스모크로 병영+궁수대+마구간에 동시에 생산 넣고 1턴 진행 시 세 종류가 동시에 완성됨을 확인(각 +1). `node sim.js` — 봇이 궁수대는 짓지만 마구간은 안 지어 부분적으로만 이점을 누림, 지표(정복/함락 오실레이션 패턴)는 기존과 같은 범위. 브라우저에서 건물별 대기열 렌더링 확인.
- **다음**: F5(연구 스킬트리 다양화).

### F5. 연구 스킬트리 다양화 ✅ (2026-07-18)
- [x] **내정 5종 중 채굴법만 있던 2티어를 나머지에도**: "영농 II"/"대장간 II"/"행군술 II" 신설(req: 각 I). **기존 키 이름은 안 바꿈** — 원래 계획은 "영농"→"영농 I" 리네임이었지만, `hasR(g,"영농")` 등 참조 지점이 5곳(econIncome/buildRate/pBaseMp/armySpeed/endTurn 2곳)이라 리네임 시 누락 위험이 커(E5에서 겪은 "조용한 버그"류) II 티어를 원래 키에 얹어 소비 지점마다 개별 가산하는 쪽으로 안전하게 변경.
- [x] **행군 편제 I/II**: 부대당 최대 병력(`ARMY_CAP`) +10/+10 — `armyCapFor(g)` 신규 함수, `draftAdjust`의 상한 체크와 `ui.js` 편성 UI(`+`버튼 비활성·"편성 N/M" 표시) 둘 다 갱신.
- [x] **드래곤 연구(용의 힘/비늘 I·II)**: 드래곤 스킬(선택형, C1)과 별개로 드래곤 자체 스탯을 영구 강화. `researchMods`(group 기반)를 건드리지 않고 `dragonMod:{stat,amount}` 필드+`dragonResearchSum(g,field)` 소형 함수로 격리, `resolveBattle`의 드래곤 버프 가산부에 한 항 추가.
- [x] `ui.js` — 연구 탭 sub 목록에 "드래곤"(전투)·"행군"(내정) 신규 노출.
- **검증**: `node verify.js` 12 PASS(engine.js 무관). node 스모크로 (a) 영농 II 선행 미충족 시 차단, (b) 행군 편제 I+II로 ARMY_CAP 20→40 확인, (c) 드래곤 연구 유무에 따른 동일 전투 survA 비교(27→35 상승) 확인. `node sim.js` 지표 정상 범위(봇 미사용). 브라우저에서 신규 카테고리·항목 렌더링 확인.
- **다음**: F3(드래곤 선행조건 스킬트리).

### F3. 드래곤 선행조건 스킬트리 ✅ (2026-07-18)
- [x] `DRAGON_SKILLS` — 단계 상승마다 2択으로 누적하던 4종(C1)을 폐기하고, RESEARCH와 같은 `req` 체인 4갈래(공격/수비/경제/대몬스터, 각 I/II)로 재설계(총 8종).
- [x] `dragonTick(g)` — 단계 상승 로직은 그대로 두고(egg→hatch→juv→adult), **스킬 포인트는 별도로 용린 30 누적마다 +1** 지급(`scaleSpent` 추적) — 성체(만렙) 이후에도 용린을 계속 모으면 트리가 성장하는 구조로 변경(예전엔 4단계=3회 픽 이후 용린이 무의미해졌음).
- [x] `investDragonSkill(g,skillId)` 신규 — `startResearch`와 동일한 검증(선행조건·포인트 보유), 자원 대신 skillPoints 1점 소모, 턴 대기 없이 즉시 습득. 기존 `chooseDragonSkill`/`pendingDragonSkill`(2択 대기 상태) 완전 폐기.
- [x] `ui.js` — 2択 모달 대신 RESEARCH 리스트 UI 패턴을 복제해 카테고리별 나열(✅완료/🔒선행 필요/포인트 있으면 습득 가능).
- **버그 방지 조치**: 스킬 id를 "flame"→"flame1"처럼 바꿔서 **구버전 세이브의 스킬이 조용히 무효화되는 걸** `applySave()`에서 구id→신id 매핑 이관으로 막음(E5의 "리네임 누락" 교훈을 이번엔 사전에 반영).
- **검증**: `node verify.js` 12 PASS(engine.js 무관). node 스모크로 용린 65 지급 시 skillPoints=2(30×2, 5는 이월) 확인, 선행 미충족(flame2를 flame1 없이) 차단 확인, 포인트 소진 후 추가 습득 차단 확인. `node sim.js` 지표 정상 범위. 브라우저에서 트리 UI 렌더링 + 실제 버튼 클릭으로 습득 흐름 확인.
- **다음**: F2(영웅 위원회).

### F2. 영웅 위원회 ✅ (2026-07-18)
- [x] `cityHero(g)`(내정형 1명 검색)를 `cityHeroes(g)`(배열)로 일반화, `councilSlots(g)`(기본 2, 마일스톤 m3에서 "council" 해금 시 3) 신규.
- [x] `councilGradeSum(g)`/`councilSum(g,field)` — 위원회 전원의 등급 보너스·특성 보너스를 합산. 기존 `cityHero`+`traitSum` 4개 소비 지점(`buildRate`/`econIncome`/`foodUpkeep`/`startResearch`)을 전부 교체.
- [x] `assignHero(g,hid,"castle")` — 위원회가 꽉 찼으면 배치 거부(기존엔 검증 없이 그냥 덮어써서 여러 명을 배치해도 1명분만 적용되던 상태였음). 이미 배치된 영웅의 재배치는 허용.
- [x] `ui.js` — "🏛 위원회 N/M" 배지, 꽉 찼을 때 "성에 배치" 버튼 비활성화.
- **범위**: 전투형 영웅은 위원회 대상 아님(사용자 확정) — 내정형 전용 유지.
- **검증**: `node verify.js` 12 PASS(engine.js 무관). node 스모크로 내정형 3명 배치 시 econIncome/buildRate가 인원수만큼 합산 증가(예: buildRate 1→4) 확인, 슬롯 초과 배치 거부 확인, 마일스톤 해금 후 3번째 슬롯 확인. `node sim.js` 요약 지표(평균 국력 443 등) 기존 범위와 일치. 브라우저에서 배지·버튼 비활성화·실제 배치 거부 확인.
- **Milestone F(F1·F5·F3·F2) 완료, 남은 것은 F4(군주+장비) — 가장 큰 항목.**

### F4. 군주(Lord) + 군주 장비 ✅ (2026-07-18)
- [x] **군주 레벨/경험치**: `g.lord={level,xp,talentPoints,talents,equipment}` 신설. `LORD_XP_REWARD`(사냥1/토벌3/레이드8)를 `resolveBattle`의 몬스터 처치 보상 블록에 `XP_REWARD`/`SUBDUE_REWARD`/`DRAGON_SCALE_REWARD`와 나란히 추가. `lordTick(g)`가 절차적 문턱(`15×1.35^(lv-1)`)으로 레벨업, 레벨당 재능 포인트 +2 — `endTurn`/`offlineStep` 양쪽에 `dragonTick` 옆으로 배선.
- [x] **재능 3트리(전투/경제/개발)**: `LORD_TALENTS` 12종, RESEARCH와 같은 `req` 체인이지만 자원 대신 `talentPoints` 소모(`investTalent`), 턴 대기 없이 즉시 적용. 필드는 기존 6개 어휘(atkBonus/defBonus/buildBonus/researchBonus/econBonus/upkeepReduce)만 사용 — 새 통합 지점 없음.
- [x] **군주 장비**: 슬롯 4개(무기/방어구/투구/장신구) × 티어 2개 = 8종 카탈로그(`EQUIPMENT`). `MATERIAL_REWARD`(사냥1/토벌2/레이드5)·`BLUEPRINT_REWARD`(사냥0/토벌1/레이드2) — **몬스터 티어 기준**(사용자 확정, 종류별 아님) 드랍, 같은 보상 블록에 추가. `craftEquipment`(설계도+재료+자원 소모, `craftSiege`와 동일 패턴)·`enhanceEquipment`(1~5강, 1-2강 +5%p·3-4강 +10%p·5강 +20%p 누적 +50%, 아발론 방식)·`equipItem`/`unequipItem`.
- [x] **소비 지점 배선**: `lordTalentSum(g,field)`/`lordEquipSum(g,field)`를 기존 4곳(`buildRate`/`econIncome`/`foodUpkeep`/`startResearch`)에 `councilSum`과 나란히 추가, `resolveBattle`의 aB/dB에는 **부대·영웅 지정 없이 항상 가산**(군주는 "왕국 전체" 개념).
- [x] **세트 보너스**: 1차 범위에서 제외(사용자 확정) — 슬롯별 개별 장비+강화만.
- [x] `ui.js` — 성 패널에 "군주" 탭 신설: 레벨/XP 진행바, 재능 트리(RESEARCH 리스트 UI 재사용), 장비 슬롯 4칸(장착/해제/강화), 미착용 인벤토리, 제작 목록.
- **검증**: `node verify.js` 12 PASS(engine.js 무관 — 전부 game.js 레벨 가산). node 스모크로 레벨업(xp 36→lv3, 포인트+4)·재능 선행조건 차단·제작→강화→장착 전 과정·실제 몬스터 kill 시 lordXp/materials/blueprints 지급 확인, 재능만/장비만 각각 적용한 동일 전투 비교로 survA 9→23/9→20 상승 확인. `node sim.js` 요약 지표(평균 국력 442) 기존 범위와 일치. 브라우저에서 실제 버튼 클릭으로 재능 습득→제작→장착→강화 전체 흐름 확인.
- **Milestone F(아발론식 심화 시스템, F1~F5) 전체 완료.**

## 지금 다음 액션
**Milestone A·B·C·E·F 전체 완료**(2026-07-18). B3(안개·탐험)·병종 다양화(7번째 유닛)는 둘 다 확정 폐기 — 더 이상 검토 안 함. 다음 라운드는 새로 진단 필요 — 게임 전체 재리뷰 후 우선순위 재수립 권장. King of Avalon 대조에서 아직 안 다룬 것: 세트 보너스(장비), 동맹/PvP류(솔로 설계상 범위 밖).
