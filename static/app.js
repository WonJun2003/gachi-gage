/* 같이가게 MVP 화면. 모든 데이터는 Flask 서버(/api)에 저장된다. */
const HUES = ["#2F7A63", "#B0603A", "#4E5FA8", "#8A4E8F", "#A8892A", "#3D7F9A"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const won = n => Number(n || 0).toLocaleString("ko-KR") + "원";

const state = { role: "owner", view: "o-home", sel: null, draft: null, aiBusy: false, filter: "전체",
  projects: [], students: {}, me: "s1", aiLive: false, pick: {}, bookmarks: [],
  find: { q: "", type: "전체", region: "전체", day: "전체", saved: false }, stu: null, pfTab: "포트폴리오" };
const P = id => state.projects.find(p => p.id === id);
const S = id => state.students[id];

/* ---------- 서버 통신 ---------- */
async function api(path, body, isForm) {
  const opt = body === undefined ? {} : { method: "POST",
    headers: isForm ? {} : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body) };
  const r = await fetch(path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "서버에 연결하지 못했어요.");
  return data;
}
function upd(p) { const i = state.projects.findIndex(x => x.id === p.id); if (i >= 0) state.projects[i] = p; else state.projects.unshift(p); }
async function act(pid, type, payload) { const p = await api(`/api/projects/${pid}/action`, { type, payload }); upd(p); return p; }
async function uploadFiles(files) {
  const out = [];
  for (const f of [...files].slice(0, 10)) {
    const fd = new FormData(); fd.append("file", f);
    out.push(await api("/api/upload", fd, true));
  }
  return out;
}
async function boot() {
  try {
    const d = await api("/api/bootstrap");
    Object.assign(state, { projects: d.projects, students: d.students, me: d.me, aiLive: d.aiLive, bookmarks: d.bookmarks || [] });
    document.getElementById("ai-state").textContent = d.aiLive ? "AI: Claude 연결됨" : "AI: 규칙 기반 예시";
    render();
  } catch (e) { app.innerHTML = `<div class="err">${esc(e.message)} 서버(app.py)가 켜져 있는지 확인해 주세요.</div>`; }
}

/* ---------- 공통 조각 ---------- */
const app = document.getElementById("app");
const ICON = {
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h7l4 4v14H7z"/><path d="M10 11h5M10 15h5"/></svg>',
  case: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  bm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3.5h12v17l-6-4.5-6 4.5z"/></svg>',
  bmOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8"><path d="M6 3.5h12v17l-6-4.5-6 4.5z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 11l8-7 8 7v9H4z"/></svg>'
};
function bar(title, back, right) { return `<header class="bar">${back ? `<button class="iconbtn" data-go="${back}" aria-label="뒤로">‹</button>` : "<span></span>"}<h1>${esc(title)}</h1>${right || "<span></span>"}</header>`; }
const marked = id => state.bookmarks.includes(id);
function bmBtn(id) { return `<button class="iconbtn bm ${marked(id) ? "on" : ""}" data-bm="${id}" aria-label="${marked(id) ? "찜 해제" : "찜하기"}" aria-pressed="${marked(id)}">${marked(id) ? ICON.bmOn : ICON.bm}</button>`; }
function workTile(w, k) { return `<div class="thumb" style="background:${HUES[k % HUES.length]}">${w.img ? `<img src="${esc(w.img)}" alt="">` : esc(w.title)}</div>`; }
function avatar(s) { return `<div class="avatar" style="background:${HUES[s.id.charCodeAt(1) % HUES.length]}">${esc(s.name[0])}</div>`; }
function tabs() {
  const t = state.role === "owner"
    ? [["o-home", "내 의뢰", "home"], ["o-find", "학생 찾기", "search"], ["o-new", "의뢰하기", "plus"], ["work", "진행 작업", "case"]]
    : [["s-list", "프로젝트", "grid"], ["s-mine", "내 지원", "doc"], ["work", "진행 작업", "case"], ["profile", "프로필", "user"]];
  const v = state.view;
  const cur = v === "o-new" ? "o-new" : ["progress", "done", "work"].includes(v) ? "work" : v === "s-detail" ? "s-list" : v === "o-apply" ? "o-home" : v === "o-student" ? "o-find" : v;
  return `<nav class="tabs ${t.length === 3 ? "three" : ""}">${t.map(([k, l, i]) => `<button data-go="${k}" ${cur === k ? 'aria-current="page"' : ""}>${ICON[i]}${l}</button>`).join("")}</nav>`;
}
function thumb(p) { const img = p.refImgs?.[0]; return `<div class="thumb" style="background:${HUES[(p.hue || 0) % HUES.length]}">${img ? `<img src="${esc(img)}" alt="">` : esc(p.shop)}</div>`; }
function metaLine(p) { return `<div class="meta"><span>${esc(p.area)}</span><span>선정 후 ${p.days}일</span><span>수정 ${p.revisions}회</span>${p.visit ? `<span>방문 ${p.visit}회</span>` : ""}</div>`; }
const STAGES = ["매칭 완료", "작업 중", "중간 확인", "최종 제출"];
const stageIdx = p => ({ matched: 1, review: 2, final: 3, done: 4 }[p.status] ?? 0);
function stepsHTML(p) {
  const i = stageIdx(p);
  return `<div class="steps"><div class="fill" style="width:${Math.max(0, Math.min(i - 1, 3)) / 3 * 75}%"></div>${STAGES.map((s, k) => `<div class="step ${k < i ? "on" : ""} ${k === i ? "now" : ""}"><div class="dot">${k < i ? "✓" : ""}</div>${s}</div>`).join("")}</div>`;
}
function termsHTML(p) {
  return `<dl class="kv"><dt>작업 범위</dt><dd>${esc(p.items.join(" + "))}</dd><dt>프로젝트 금액</dt><dd>${won(p.pay)}</dd>
  <dt>작업 기한</dt><dd>선정 후 ${p.days}일</dd><dt>수정 조건</dt><dd>통합 수정 ${p.revisions}회</dd>${p.visit ? `<dt>매장 방문</dt><dd>${p.visit}회</dd>` : ""}</dl>`;
}
const spin = t => `<span class="spin"></span> ${t}`;

function findList() {
  const f = state.find, q = f.q.trim().toLowerCase();
  const list = Object.values(state.students).filter(s =>
    (!q || [s.name, s.major, s.headline, ...s.tags].join(" ").toLowerCase().includes(q)) &&
    (f.type === "전체" || s.tags.includes(f.type)) &&
    (f.region === "전체" || s.region.includes(f.region)) &&
    (f.day === "전체" || s.avail.includes(f.day)) &&
    (!f.saved || marked(s.id))
  ).sort((a, b) => (b.open - a.open) || (b.done - a.done));
  if (!list.length) return `<div class="empty">조건에 맞는 학생이 없어요. 필터를 바꿔 보세요.</div>`;
  return list.map(s => `<article class="card">
    <div class="shead">${avatar(s)}<div class="shead-main"><div class="sname">${esc(s.name)}</div><div class="psub">${esc(s.school)} ${esc(s.major)}</div></div>
      <div class="shead-side">${bmBtn(s.id)}<span class="pill ${s.open ? "" : "off"}">${s.open ? "의뢰 가능" : "의뢰 마감"}</span></div></div>
    <strong class="headline">${esc(s.headline)}</strong>
    <div class="chips">${s.tags.map(x => `<span class="tag">${esc(x)}</span>`).join("")}<span class="tag">영남대 인근</span></div>
    <div class="pf">${s.works.slice(0, 3).map(workTile).join("")}</div>
    <div class="meta"><span>${ICON.pin.replace("<svg", '<svg class="ic"')}${esc(s.region)}</span><span>${ICON.home.replace("<svg", '<svg class="ic"')}${esc(s.avail)}</span><span>후기 ${s.reviews.length}</span></div>
    <button class="btn ghost" data-stu="${s.id}">포트폴리오 보기</button></article>`).join("");
}

/* ---------- 화면 ---------- */
const views = {
  "o-home"() {
    const mine = state.projects.filter(p => p.mine);
    return bar("내 의뢰") + `<section class="content">
    <div class="ai-box"><span class="ai-badge">✦ AI 의뢰서</span><div>무엇이 필요한지 말로 적으면 AI가 작업 범위, 보수, 기간, 수정 횟수를 채워 드려요.</div>
    <button class="btn ai" data-go="o-new">새 의뢰 만들기</button></div>
    <div class="sec"><h2>내 의뢰 ${mine.length}건</h2>
    ${mine.map(p => `<article class="card"><div class="pcard">${thumb(p)}<div><div class="ptitle">${esc(p.shop)}</div><div class="psub">${esc(p.title)}</div>
      <div class="price">${won(p.pay)}</div>${metaLine(p)}</div></div>
      ${p.status === "open" ? `<button class="btn ${p.applicants.length ? "" : "ghost"}" data-apply="${p.id}" ${p.applicants.length ? "" : "disabled"}>${p.invited ? `지명한 학생(${esc(S(p.invited).name)}) 확정하기` : p.applicants.length ? `지원자 ${p.applicants.length}명 보기` : "지원자를 기다리는 중"}</button>`
        : `<button class="btn ghost" data-progress="${p.id}">${p.status === "done" ? "완료된 프로젝트 보기" : "진행 현황 보기 · " + STAGES[Math.min(stageIdx(p), 3)]}</button>`}</article>`).join("")}</div></section>` + tabs();
  },
  "o-new"() {
    const d = state.draft || (state.draft = { shop: "카페 온담", text: "", title: "", types: [], items: ["", ""], pay: "", days: "", revisions: "", visit: "", refImgs: [], materials: "", apply: [], tips: null, live: null });
    const T = ["사진 촬영", "SNS 제작", "메뉴판", "홍보물 제작", "로고"];
    const inv = d.invite && S(d.invite);
    return bar(inv ? "지명 의뢰 보내기" : "어떤 도움이 필요하세요?", inv ? "o-student" : "o-home") + `<section class="content">
    ${inv ? `<div class="card invite">${avatar(inv)}<div><strong>${esc(inv.name)} 학생에게 보내는 의뢰예요</strong><div class="psub">${esc(inv.headline)} · 다른 학생에게는 보이지 않아요</div></div></div>` : ""}
    <div class="ai-box"><span class="ai-badge">✦ 말로 설명하기</span>
      <label class="sr" for="ai-text">필요한 작업 설명</label>
      <textarea class="input" id="ai-text" placeholder="예) 겨울 신메뉴 3종이 나왔는데 인스타에 올릴 사진이 없어요. 사진 찍어서 게시물로 만들어 주세요.">${esc(d.text)}</textarea>
      <button class="btn ai" id="ai-fill" ${state.aiBusy ? "disabled" : ""}>${state.aiBusy ? spin("의뢰서 작성 중") : "AI로 의뢰서 채우기"}</button>
      ${d.tips ? `<div class="stack">${d.tips.map(t => `<div class="reason">${esc(t)}</div>`).join("")}${d.live === false ? '<div class="hint">AI 키가 없어 예시 규칙으로 채웠어요.</div>' : ""}</div>` : ""}
    </div>
    <div class="sec"><label class="label" for="f-shop">가게 이름</label><input class="input" id="f-shop" value="${esc(d.shop)}"></div>
    <div class="sec"><div class="label">작업 종류 <span>(복수 선택 가능)</span></div>
      <div class="chips">${T.map(t => `<button class="chip" data-type="${t}" aria-pressed="${d.types.includes(t)}">${t}</button>`).join("")}</div></div>
    <div class="sec"><label class="label" for="f-title">프로젝트 제목</label><input class="input" id="f-title" value="${esc(d.title)}" placeholder="신메뉴 사진 및 인스타 게시물 제작"></div>
    <div class="sec"><div class="label">작업 수량</div><div class="row2">
      <input class="input" id="f-item0" aria-label="작업 수량 1" value="${esc(d.items[0] || "")}" placeholder="사진 5장">
      <input class="input" id="f-item1" aria-label="작업 수량 2" value="${esc(d.items[1] || "")}" placeholder="게시물 3개"></div></div>
    <div class="row2"><div class="sec"><label class="label" for="f-pay">프로젝트 보수</label><input class="input" id="f-pay" inputmode="numeric" value="${esc(d.pay)}" placeholder="200000"></div>
      <div class="sec"><label class="label" for="f-days">작업 기간 <span>선정 후 일수</span></label><input class="input" id="f-days" inputmode="numeric" value="${esc(d.days)}" placeholder="7"></div></div>
    <div class="row2"><div class="sec"><label class="label" for="f-rev">수정 횟수</label><input class="input" id="f-rev" inputmode="numeric" value="${esc(d.revisions)}" placeholder="1"></div>
      <div class="sec"><label class="label" for="f-visit">매장 방문 <span>횟수</span></label><input class="input" id="f-visit" inputmode="numeric" value="${esc(d.visit)}" placeholder="0"></div></div>
    <div class="sec"><div class="label">참고 이미지 <span>${d.refImgs.length}/10</span></div>
      <div class="upload">${d.refImgs.map(s => `<div class="ph"><img src="${esc(s)}" alt="참고 이미지"></div>`).join("")}
      <label for="f-img">+ 사진</label><input type="file" id="f-img" accept="image/*" multiple class="sr"></div></div>
    <div class="stack"><button class="btn" id="f-submit">${inv ? esc(inv.name) + " 학생에게 의뢰 보내기" : "의뢰 올리기"}</button><button class="btn ghost" data-go="o-home">임시 저장</button></div>
    </section>` + tabs();
  },
  "o-find"() {
    const f = state.find, all = Object.values(state.students);
    const types = ["전체", ...new Set(all.flatMap(s => s.tags))];
    const sel = (id, label, opts, val) => `<label class="sr" for="${id}">${label}</label><select class="input sel" id="${id}">${opts.map(o => `<option value="${esc(o)}" ${o === val ? "selected" : ""}>${o === "전체" ? label : esc(o)}</option>`).join("")}</select>`;
    return bar("함께할 대학생 찾기") + `<section class="content">
    <div class="search">${ICON.search}<label class="sr" for="find-q">검색</label><input class="input" id="find-q" value="${esc(f.q)}" placeholder="이름, 학과, 작업 종류로 검색하기"></div>
    <div class="selects">${sel("find-type", "작업 종류", types, f.type)}${sel("find-region", "지역", ["전체", "경산", "대구"], f.region)}${sel("find-day", "일정", ["전체", "평일", "주말"], f.day)}</div>
    <div class="sec"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2>학생 둘러보기</h2>
      <button class="chip" id="find-saved" aria-pressed="${f.saved}">찜한 학생만</button></div>
      <div class="stack" id="find-list">${findList()}</div></div></section>` + tabs();
  },
  "o-student"() {
    const s = S(state.stu), t = state.pfTab;
    const rv = r => `<div class="rev"><div class="rev-head"><span>${esc(r.user)}</span><span class="stars-sm">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span></div><div>${esc(r.text)}</div></div>`;
    const body = t === "포트폴리오" ? `
      <div class="sec"><div class="sec-head"><h2 class="h-lg">작업물</h2><span class="hint">전체 ${s.works.length}</span></div>
        <div class="works">${s.works.map((w, k) => `<figure>${workTile(w, k + 1)}<figcaption><strong>${esc(w.title)}</strong><span>${esc(w.kind)} · ${esc(w.tags.join(", "))}</span></figcaption></figure>`).join("")}</div></div>
      <div class="sec"><h2 class="h-lg">함께할 수 있는 작업</h2>
        <div class="card">${s.services.map(v => `<div class="svc"><span>${esc(v.name)}</span><strong>${esc(v.price)}</strong></div>`).join("")}
        <button class="btn" data-invite="${s.id}" ${s.open ? "" : "disabled"}>${s.open ? "이 학생에게 의뢰하기" : "지금은 의뢰를 받지 않아요"}</button></div></div>
      <div class="sec"><div class="sec-head"><h2 class="h-lg">사장님 후기 <span class="hint">(${s.reviews.length})</span></h2>${s.reviews.length > 2 ? `<button class="linkbtn" data-pftab="후기">전체 보기</button>` : ""}</div>
        ${s.reviews.length ? `<div class="card">${s.reviews.slice(0, 2).map(rv).join("")}</div>` : `<div class="empty">아직 후기가 없어요.</div>`}</div>`
    : t === "소개" ? `<div class="sec"><p class="intro">${esc(s.intro)}</p>
        <dl class="kv"><dt>학교</dt><dd>${esc(s.school)}</dd><dt>학과</dt><dd>${esc(s.major)}</dd><dt>활동 지역</dt><dd>${esc(s.region)}</dd>
        <dt>방문 일정</dt><dd>${esc(s.avail)}</dd><dt>완료 프로젝트</dt><dd>${s.done}건</dd><dt>잘하는 작업</dt><dd>${esc(s.tags.join(", "))}</dd></dl></div>
        <button class="btn" data-invite="${s.id}" ${s.open ? "" : "disabled"}>${s.open ? "이 학생에게 의뢰하기" : "지금은 의뢰를 받지 않아요"}</button>`
    : `<div class="sec">${s.reviews.length ? `<div class="card">${s.reviews.map(rv).join("")}</div>` : `<div class="empty">아직 후기가 없어요.</div>`}</div>`;
    return bar("포트폴리오", "o-find", bmBtn(s.id)) + `<section class="content">
    <div class="shead">${avatar(s)}<div class="shead-main"><div class="sname">${esc(s.name)}</div><div class="psub">${esc(s.school)} ${esc(s.major)}</div></div>
      <span class="pill ${s.open ? "" : "off"}">${s.open ? "의뢰 가능" : "의뢰 마감"}</span></div>
    <div class="stack"><strong class="headline">${esc(s.headline)}</strong>
      <div class="chips">${s.tags.map(x => `<span class="tag">${esc(x)}</span>`).join("")}</div>
      <div class="meta"><span>${ICON.pin.replace("<svg", '<svg class="ic"')}${esc(s.region)}</span><span>${ICON.home.replace("<svg", '<svg class="ic"')}${esc(s.avail)}</span></div></div>
    <div class="seg" role="tablist">${["포트폴리오", "소개", "후기"].map(x => `<button role="tab" data-pftab="${x}" aria-selected="${t === x}">${x}</button>`).join("")}</div>
    ${body}</section>` + tabs();
  },
  "o-apply"() {
    const p = P(state.sel), pick = state.pick[p.id];
    const order = [...p.applicants].sort((a, b) => p.scores ? (p.scores[b]?.score || 0) - (p.scores[a]?.score || 0) : 0);
    return bar("함께 할 학생을 선택하세요", "o-home") + `<section class="content">
    <div class="pcard">${thumb(p)}<div><div class="ptitle">${esc(p.shop)}</div><div class="psub">${esc(p.title)}</div><div class="price">${won(p.pay)}</div>${metaLine(p)}</div></div>
    <div class="sec"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2>지원자 ${p.applicants.length}명</h2>
      <button class="btn ai sm" id="ai-match" ${state.aiBusy ? "disabled" : ""}>${state.aiBusy ? spin("분석 중") : p.scores ? "다시 분석" : "✦ AI 적합도 분석"}</button></div>
    ${order.map(id => { const s = S(id), sc = p.scores?.[id]; return `<article class="card applicant ${pick === id ? "sel" : ""}" data-pick="${id}" tabindex="0" role="radio" aria-checked="${pick === id}">
      <div class="radio"></div><div class="stack" style="min-width:0">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><strong>${esc(s.name)} ${p.invited === id ? '<span class="tag hot">지명한 학생</span>' : ""}</strong>${sc ? `<span class="score">${sc.score}점</span>` : ""}</div>
      <div class="psub">${esc(s.major)} · 완료 ${s.done}건 · ${esc(s.avail)}</div>
      <div class="psub">“${esc(id === state.me && p.pitch ? p.pitch : s.intro)}”</div>
      <div class="pf">${s.pf.map((t, k) => `<div class="thumb" style="background:${HUES[(k + id.charCodeAt(1)) % HUES.length]}">${esc(t)}</div>`).join("")}</div>
      ${sc ? `<div class="reason"><span class="ai-badge">✦ AI 추천 이유</span><br>${esc(sc.reason)}</div>` : ""}</div></article>`; }).join("")}
    ${p.scoreLive === false ? '<div class="hint">AI 키가 없어 예시 규칙으로 점수를 냈어요.</div>' : ""}</div>
    <button class="btn" id="choose" ${pick ? "" : "disabled"}>함께할 학생 선택</button>
    <p class="notice">선택하면 매칭이 확정되고 작업 공간이 열려요.</p></section>` + tabs();
  },
  "s-list"() {
    const F = ["전체", "사진 촬영", "SNS 제작", "메뉴판", "홍보물 제작"];
    const list = state.projects.filter(p => p.status === "open" && (!p.invited || p.invited === state.me) && (state.filter === "전체" || p.types.includes(state.filter)));
    return bar("내가 참여할 프로젝트") + `<section class="content">
    <div class="chips">${F.map(f => `<button class="chip" data-filter="${f}" aria-pressed="${state.filter === f}">${f}</button>`).join("")}</div>
    <div class="stack">${list.length ? list.map(p => `<article class="card"><div class="chips"><span class="tag">${esc(p.area)}</span>${p.types.map(t => `<span class="tag">${esc(t)}</span>`).join("")}${p.invited ? `<span class="tag hot">나에게 온 지명 의뢰</span>` : p.deadline <= 3 ? `<span class="tag hot">지원 마감 D-${p.deadline}</span>` : ""}</div>
      <div class="pcard">${thumb(p)}<div><div class="ptitle">${esc(p.shop)}</div><div class="psub">${esc(p.title)}</div><div class="price">${won(p.pay)}</div>${metaLine(p)}</div></div>
      <button class="btn ghost" data-detail="${p.id}">${p.invited === state.me ? "지명 의뢰 확인하기" : p.applicants.includes(state.me) ? "지원 완료 · 상세 보기" : "상세 보기"}</button></article>`).join("")
      : `<div class="empty">조건에 맞는 프로젝트가 없어요.</div>`}</div></section>` + tabs();
  },
  "s-detail"() {
    const p = P(state.sel), applied = p.applicants.includes(state.me);
    return bar("프로젝트 상세", "s-list") + `<section class="content">
    <div class="pcard">${thumb(p)}<div><div class="ptitle">${esc(p.shop)}</div><div class="psub">${esc(p.title)}</div><div class="price">${won(p.pay)}</div>${metaLine(p)}</div></div>
    <div class="sec"><h2>상세 정보</h2><dl class="kv">
      <dt>작업 산출물</dt><dd><ul>${p.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></dd>
      <dt>제공 자료</dt><dd>${esc(p.materials)}</dd>
      <dt>수정 범위</dt><dd>통합 수정 ${p.revisions}회</dd>
      <dt>지원 시 제출</dt><dd><ul>${p.apply.map(i => `<li>${esc(i)}</li>`).join("")}</ul></dd>
      ${p.desc ? `<dt>사장님 한마디</dt><dd>${esc(p.desc)}</dd>` : ""}</dl></div>
    ${applied || p.status !== "open" ? "" : `<div class="sec"><label class="label" for="pitch">지원 메시지</label><textarea class="input" id="pitch">${esc(S(state.me).intro)}</textarea></div>`}
    <div class="stack">${p.invited === state.me && p.status === "open" ? `<div class="card invite"><strong>사장님이 나를 지명한 의뢰예요.</strong><div class="psub">사장님이 확정하면 바로 작업이 시작돼요.</div></div>` : `<button class="btn" id="apply" ${applied || p.status !== "open" ? "disabled" : ""}>${applied ? "지원 완료" : p.status !== "open" ? "모집 마감" : "지원하기"}</button>`}
    <button class="btn ghost" id="save">${p.saved ? "관심 프로젝트에 담김" : "관심 프로젝트 담기"}</button></div></section>` + tabs();
  },
  "s-mine"() {
    const list = state.projects.filter(p => p.applicants.includes(state.me));
    return bar("내 지원") + `<section class="content"><div class="stack">${list.length ? list.map(p => `<article class="card"><div class="pcard">${thumb(p)}<div>
      <div class="ptitle">${esc(p.shop)}</div><div class="psub">${esc(p.title)}</div><div class="price">${won(p.pay)}</div></div></div>
      <span class="tag ${p.chosen === state.me ? "hot" : ""}">${p.chosen === state.me ? "선정됨" : p.chosen ? "다른 학생 선정" : "검토 중"}</span>
      ${p.chosen === state.me ? `<button class="btn" data-progress="${p.id}">작업 공간으로</button>` : ""}</article>`).join("")
      : `<div class="empty">아직 지원한 프로젝트가 없어요.<br>프로젝트 탭에서 마음에 드는 의뢰에 지원해 보세요.</div>`}</div></section>` + tabs();
  },
  "profile"() {
    const s = S(state.me), done = state.projects.filter(p => p.chosen === state.me && p.status === "done");
    return bar("프로필") + `<section class="content">
    <div class="pcard"><div class="thumb" style="background:${HUES[0]};border-radius:50%">${esc(s.name[0])}</div><div><div class="ptitle">${esc(s.name)}</div><div class="psub">${esc(s.major)}</div>
    <div class="chips" style="margin-top:6px">${s.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div></div></div>
    <div class="sec"><h2>포트폴리오</h2><div class="pf">${s.pf.map((t, k) => `<div class="thumb" style="background:${HUES[k % HUES.length]}">${esc(t)}</div>`).join("")}
    ${done.map(p => `<div class="thumb" style="background:var(--accent)">${p.drafts[0]?.img ? `<img src="${esc(p.drafts[0].img)}" alt="">` : esc(p.shop) + " 실무"}</div>`).join("")}</div></div>
    <div class="sec"><h2>실무 프로젝트 기록</h2>${done.length ? done.map(p => `<div class="card"><strong>${esc(p.shop)} · ${esc(p.title)}</strong>
      <div class="psub">${esc(p.items.join(" + "))} · 사장님 평가 ${"★".repeat(p.rating)}${"☆".repeat(5 - p.rating)}</div>${p.review ? `<div class="psub">“${esc(p.review)}”</div>` : ""}</div>`).join("")
      : `<div class="empty">프로젝트를 완료하면 결과물과 사장님 평가가 여기에 쌓여요.</div>`}</div></section>` + tabs();
  },
  "work"() {
    const list = state.projects.filter(p => p.chosen && (state.role === "owner" ? p.mine : p.chosen === state.me));
    return bar("진행 작업") + `<section class="content"><div class="stack">${list.length ? list.map(p => `<article class="card"><strong>${esc(p.shop)} · ${esc(p.title)}</strong>${stepsHTML(p)}
      <button class="btn ghost" data-progress="${p.id}">${p.status === "done" ? "완료 내역 보기" : "열기"}</button></article>`).join("")
      : `<div class="empty">${state.role === "owner" ? "학생을 선택하면 진행 중인 작업이 여기에 나와요." : "선정된 프로젝트가 생기면 여기에서 작업해요."}</div>`}</div></section>` + tabs();
  },
  "progress"() {
    const p = P(state.sel), owner = state.role === "owner", st = S(p.chosen), fb = p.feedback;
    if (p.status === "final" || p.status === "done") return views.done();
    return bar("프로젝트 진행 중", "work") + `<section class="content">
    <div class="sec"><h2>프로젝트 진행 현황</h2>${stepsHTML(p)}</div>
    <div class="card"><h2>프로젝트 조건 <span class="hint">(합의 내용)</span></h2>${termsHTML(p)}<div class="hint">담당 학생: ${esc(st.name)} · ${esc(st.major)}</div></div>
    <div class="sec"><h2>초안 ${p.drafts.length ? `<span class="hint">${p.drafts.length}개</span>` : ""}</h2>
      ${p.drafts.length ? `<div class="pf">${p.drafts.map(d => `<div class="thumb" style="background:${HUES[2]}">${d.img ? `<img src="${esc(d.img)}" alt="${esc(d.name)}">` : esc(d.name)}</div>`).join("")}</div>`
        : `<div class="empty">${owner ? "학생이 초안을 올리면 여기에서 확인해요." : "작업한 초안을 올려 사장님 확인을 받으세요."}</div>`}
      ${!owner && p.status === "matched" ? `<div class="upload"><label for="d-img">+ 초안</label><input type="file" id="d-img" accept="image/*" multiple class="sr"></div>
        <button class="btn ghost" id="d-sample">예시 초안 3장 올리기</button>` : ""}
      ${!owner && p.drafts.length && p.status === "matched" ? `<button class="btn" id="d-send">중간 확인 요청</button>` : ""}</div>
    <div class="sec"><h2>피드백 <span class="hint">(사장님 → 학생)</span></h2>
      ${owner && p.status === "review" && !fb ? `<label class="sr" for="fb-text">피드백</label><textarea class="input" id="fb-text" placeholder="예) 사진이 좀 어두워요. 딸기라떼는 위에서 찍은 것도 있으면 좋겠고 게시물 글씨는 더 크게 해주세요."></textarea>
        <button class="btn ai" id="fb-ai" ${state.aiBusy ? "disabled" : ""}>${state.aiBusy ? spin("정리 중") : "✦ AI로 수정 요청 정리해서 보내기"}</button>` : ""}
      ${fb ? `<div class="card"><div class="psub">사장님 원문: “${esc(fb.raw)}”</div><span class="ai-badge">✦ 수정 요청 목록 (수정 ${p.revisions}회 중 1회 사용)</span>
        ${fb.items.map((t, k) => `<label class="check"><input type="checkbox" data-fbcheck="${k}" ${fb.done?.[k] ? "checked" : ""} ${owner ? "disabled" : ""}>${esc(t)}</label>`).join("")}
        ${fb.outOfScope?.length ? `<div class="reason" style="background:var(--warn-soft)"><strong>합의 범위 밖 요청</strong><br>${fb.outOfScope.map(esc).join("<br>")}<br><span class="hint">추가 비용이나 별도 합의가 필요해요.</span></div>` : ""}</div>`
        : !(owner && p.status === "review") ? `<div class="empty">${p.status === "review" ? "사장님 피드백을 기다리는 중이에요." : "중간 확인 요청 후 피드백을 받을 수 있어요."}</div>` : ""}
      ${!owner && fb ? `<button class="btn" id="final-send">최종 결과물 제출</button>` : ""}</div>
    </section>` + tabs();
  },
  "done"() {
    const p = P(state.sel), owner = state.role === "owner", done = p.status === "done";
    const checks = [...p.items.map(i => i + " 확인"), "수정사항 반영 확인", "오탈자 확인"];
    const all = checks.every((_, k) => p.checks[k]);
    return bar(done ? "프로젝트 완료" : "프로젝트 진행 완료", "work") + `<section class="content">
    <div class="sec"><h2>프로젝트 진행 현황</h2>${stepsHTML(p)}</div>
    <div class="card" style="background:var(--accent-soft);border-color:var(--accent)"><strong>${done ? "완료된 프로젝트예요. 결과물이 학생 포트폴리오에 등록됐어요." : owner ? "최종 제출됨 · 확인 대기" : "최종 제출 완료 · 사장님 확인 대기"}</strong></div>
    <div class="files">${p.drafts.filter(d => d.img).map(d => `<div class="file"><span>${esc(d.name)}</span><a class="btn ghost sm" href="${esc(d.img)}" download>받기</a></div>`).join("")
      || p.items.map(it => `<div class="file"><span>${esc(p.shop.replace(/\s/g, ""))}_${esc(it.replace(/\s/g, ""))}_최종</span><span class="hint">예시 파일</span></div>`).join("")}</div>
    ${done ? `<div class="sec"><h2>사장님 평가</h2><div class="psub">${"★".repeat(p.rating)}${"☆".repeat(5 - p.rating)} ${p.review ? "“" + esc(p.review) + "”" : ""}</div></div>` :
      owner ? `<div class="sec"><h2>확인 체크리스트</h2>${checks.map((c, k) => `<label class="check"><input type="checkbox" data-check="${k}" ${p.checks[k] ? "checked" : ""}>${esc(c)}</label>`).join("")}</div>
      <div class="sec"><h2>학생 평가</h2><div class="stars" role="group" aria-label="별점">${[1, 2, 3, 4, 5].map(n => `<button data-star="${n}" class="${p.rating >= n ? "on" : ""}" aria-label="${n}점">★</button>`).join("")}</div>
      <label class="sr" for="review">한 줄 후기</label><input class="input" id="review" placeholder="한 줄 후기 (학생 포트폴리오에 표시돼요)" value="${esc(state.reviewDraft ?? p.review ?? "")}"></div>
      <p class="notice">약속한 결과물을 확인한 뒤 완료해 주세요. 완료하면 보수가 학생에게 지급돼요.</p>
      <button class="btn" id="complete" ${all && p.rating ? "" : "disabled"}>완료 확인하기</button>`
      : `<div class="empty">사장님이 체크리스트를 확인하고 완료하면 보수가 지급되고 포트폴리오에 등록돼요.<br>상단의 ‘사장님’으로 바꿔 확인해 보세요.</div>`}
    </section>` + tabs();
  }
};

function render() {
  app.innerHTML = views[state.view]();
  document.getElementById("role-owner").setAttribute("aria-pressed", state.role === "owner");
  document.getElementById("role-student").setAttribute("aria-pressed", state.role === "student");
}
let tt; function toast(m) { const t = document.getElementById("toast"); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2800); }
function go(v) { state.view = v; render(); app.querySelector(".content")?.scrollTo(0, 0); window.scrollTo(0, 0); }
function syncDraft() {
  const d = state.draft; if (!d || state.view !== "o-new") return; const v = id => document.getElementById(id)?.value ?? "";
  Object.assign(d, { text: v("ai-text"), shop: v("f-shop"), title: v("f-title"), items: [v("f-item0"), v("f-item1")], pay: v("f-pay"), days: v("f-days"), revisions: v("f-rev"), visit: v("f-visit") });
}

/* ---------- 이벤트 ---------- */
document.getElementById("role-owner").onclick = () => { syncDraft(); state.role = "owner"; go("o-home"); };
document.getElementById("role-student").onclick = () => { syncDraft(); state.role = "student"; go("s-list"); };
document.getElementById("reset").onclick = async () => {
  if (!confirm("모든 의뢰와 진행 내역을 지우고 예시 데이터로 되돌릴까요?")) return;
  await api("/api/reset", {}); state.draft = null; state.pick = {}; await boot(); go(state.role === "owner" ? "o-home" : "s-list"); toast("예시 데이터로 초기화했어요.");
};

async function guarded(fn) { try { await fn(); } catch (e) { state.aiBusy = false; render(); toast(e.message); } }

app.addEventListener("click", e => {
  const b = e.target.closest("button,[data-pick]"); if (!b) return;
  const ds = b.dataset;
  if (ds.go) { syncDraft(); return go(ds.go); }
  if (ds.apply) { state.sel = ds.apply; return go("o-apply"); }
  if (ds.progress) { state.sel = ds.progress; return go("progress"); }
  if (ds.detail) { state.sel = ds.detail; return go("s-detail"); }
  if (ds.filter) { state.filter = ds.filter; return render(); }
  if (ds.type) { syncDraft(); const d = state.draft; d.types = d.types.includes(ds.type) ? d.types.filter(t => t !== ds.type) : [...d.types, ds.type]; return render(); }
  if (ds.pick) { state.pick[state.sel] = ds.pick; return render(); }
  if (ds.stu) { state.stu = ds.stu; state.pfTab = "포트폴리오"; return go("o-student"); }
  if (ds.pftab) { state.pfTab = ds.pftab; return render(); }
  if (ds.invite) { const s = S(ds.invite); state.draft = { shop: "카페 온담", text: "", title: "", types: s.tags.filter(t => ["사진 촬영", "SNS 제작", "메뉴판", "홍보물 제작", "로고"].includes(t)).slice(0, 2), items: ["", ""], pay: "", days: "", revisions: "", visit: "", refImgs: [], materials: "", apply: [], tips: null, live: null, invite: s.id }; return go("o-new"); }
  if (ds.bm) return guarded(async () => { state.bookmarks = (await api("/api/bookmarks/toggle", { id: ds.bm })).bookmarks; toast(marked(ds.bm) ? "찜한 학생에 담았어요." : "찜을 해제했어요."); if (state.view === "o-find") { document.getElementById("find-list").innerHTML = findList(); } else render(); });
  if (b.id === "find-saved") { state.find.saved = !state.find.saved; return render(); }
  if (ds.star) return guarded(async () => { await act(state.sel, "rate", { n: +ds.star, review: state.reviewDraft ?? "" }); render(); });
  const p = P(state.sel);
  guarded(async () => {
    switch (b.id) {
      case "ai-fill": {
        syncDraft(); const d = state.draft;
        if (d.text.trim().length < 5) return toast("필요한 작업을 한두 문장으로 적어 주세요.");
        state.aiBusy = true; render();
        const { data, live } = await api("/api/ai/brief", { text: d.text, shop: d.shop });
        state.aiBusy = false;
        const items = data.items || [];
        Object.assign(d, { title: data.title || d.title, types: (data.types || []).filter(Boolean), items: [...items, "", ""].slice(0, Math.max(2, items.length)),
          pay: data.pay ?? "", days: data.days ?? "", revisions: data.revisions ?? "", visit: data.visit ?? "", materials: data.materials || "", apply: data.apply || [], tips: data.tips || [], live });
        render(); toast(live ? "AI가 의뢰서를 채웠어요. 내용을 확인하고 고쳐 주세요." : "예시 규칙으로 채웠어요."); break;
      }
      case "f-submit": {
        syncDraft();
        const np = await api("/api/projects", state.draft);
        upd(np); const wasInvite = state.draft.invite; state.draft = null;
        toast(wasInvite ? "지명 의뢰를 보냈어요. 내 의뢰에서 확정할 수 있어요." : "의뢰를 올렸어요. 학생 화면에서 바로 보여요."); return go("o-home");
      }
      case "ai-match": {
        state.aiBusy = true; render();
        upd(await api(`/api/projects/${p.id}/match`, {})); state.aiBusy = false; return render();
      }
      case "choose": {
        await act(p.id, "choose", { student: state.pick[p.id] }); toast(S(state.pick[p.id]).name + " 학생과 매칭됐어요."); return go("progress");
      }
      case "apply": { await act(p.id, "apply", { pitch: document.getElementById("pitch")?.value || "" }); toast("지원했어요. 사장님 화면에서 지원자로 보여요."); return render(); }
      case "save": { await act(p.id, "save"); return render(); }
      case "d-sample": { await act(p.id, "add_drafts", { drafts: [{ name: "메뉴 사진 A" }, { name: "메뉴 사진 B" }, { name: "게시물 시안" }] }); return render(); }
      case "d-send": { await act(p.id, "request_review"); toast("중간 확인을 요청했어요."); return render(); }
      case "fb-ai": {
        const raw = document.getElementById("fb-text").value.trim();
        if (raw.length < 4) return toast("피드백을 적어 주세요.");
        state.aiBusy = true; render();
        await act(p.id, "feedback", { raw }); state.aiBusy = false; toast("수정 요청을 학생에게 보냈어요."); return render();
      }
      case "final-send": { await act(p.id, "final"); toast("최종 결과물을 제출했어요."); return render(); }
      case "complete": { await act(p.id, "complete", { review: state.reviewDraft ?? p.review ?? "" }); state.reviewDraft = undefined; state.students = (await api("/api/bootstrap")).students; toast("완료됐어요. 보수가 지급되고 포트폴리오에 등록됐어요."); return render(); }
    }
  });
});

app.addEventListener("change", e => {
  const t = e.target;
  guarded(async () => {
    if (t.id === "f-img") { syncDraft(); const ups = await uploadFiles(t.files); state.draft.refImgs.push(...ups.map(u => u.url)); render(); }
    if (t.id === "d-img") { const ups = await uploadFiles(t.files); await act(state.sel, "add_drafts", { drafts: ups.map(u => ({ name: u.name, img: u.url })) }); render(); }
    if (["find-type", "find-region", "find-day"].includes(t.id)) { state.find[t.id.slice(5)] = t.value; document.getElementById("find-list").innerHTML = findList(); return; }
    if (t.dataset.check !== undefined) { await act(state.sel, "check", { k: t.dataset.check, v: t.checked }); render(); }
    if (t.dataset.fbcheck !== undefined) { await act(state.sel, "fbcheck", { k: t.dataset.fbcheck, v: t.checked }); }
  });
});
app.addEventListener("input", e => {
  if (e.target.id === "review") state.reviewDraft = e.target.value;
  if (e.target.id === "find-q") { state.find.q = e.target.value; document.getElementById("find-list").innerHTML = findList(); }
});
app.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.dataset?.pick) { e.preventDefault(); e.target.click(); } });

boot();
