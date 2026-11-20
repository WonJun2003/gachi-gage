// 같이가게 와이어프레임 화면 (2026-11-20 확정안)
// 홈 · 글쓰기 단계 · 계정 연결 단계 · 아래 메뉴(홈/기록/가게). app.js의 함수와 상태를 그대로 쓴다.

// ---------- 공통 ----------
const ICON = {
  instagram: `<svg viewBox="0 0 32 32" class="pf-ic"><defs><linearGradient id="igg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f9a43a"/><stop offset=".5" stop-color="#e1306c"/><stop offset="1" stop-color="#8a3ab9"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#igg)"/><rect x="8" y="8" width="16" height="16" rx="5" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="16" cy="16" r="4" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="21.2" cy="10.8" r="1.3" fill="#fff"/></svg>`,
  facebook: `<svg viewBox="0 0 32 32" class="pf-ic"><circle cx="16" cy="16" r="16" fill="#1877f2"/><path d="M17.6 26v-8.4h2.8l.4-3.3h-3.2v-2.1c0-.9.3-1.6 1.6-1.6h1.7V7.7c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4h-2.8v3.3h2.8V26z" fill="#fff"/></svg>`,
  threads: `<svg viewBox="0 0 32 32" class="pf-ic"><circle cx="16" cy="16" r="16" fill="#1c1c1c"/><text x="16" y="21.5" text-anchor="middle" font-size="16" font-weight="700" fill="#fff" font-family="Arial, sans-serif">@</text></svg>`,
};
const backBtn = (attr) => `<button type="button" class="w-back" ${attr} aria-label="뒤로"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
const progress = (n, total) => `<div class="w-progress"><span style="width:${Math.round((n / total) * 100)}%"></span></div>`;
const micBtn = (target) => `<button type="button" class="w-mic" data-mic="${target}" aria-label="말로 입력하기"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>`;
const check = (on) => `<span class="w-check ${on ? 'on' : ''}">${on ? '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</span>`;

// 말로 입력하기 (브라우저 음성 인식, 크롬·엣지·사파리)
let micRec = null;
function startMic(input, btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('이 브라우저는 음성 입력을 지원하지 않아요. 크롬이나 엣지에서 써 보세요.');
  if (micRec) { micRec.stop(); return; }
  micRec = new SR();
  micRec.lang = 'ko-KR';
  micRec.interimResults = false;
  const before = input.value ? input.value.replace(/\s*$/, ' ') : '';
  btn.classList.add('on');
  toast('듣고 있어요… 말씀해 주세요');
  micRec.onresult = (e) => {
    input.value = before + [...e.results].map((r) => r[0].transcript).join(' ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  micRec.onerror = (e) => toast(e.error === 'not-allowed' ? '마이크 사용을 허용해 주세요.' : '음성을 알아듣지 못했어요.');
  micRec.onend = () => { btn.classList.remove('on'); micRec = null; };
  micRec.start();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mic]');
  if (!b) return;
  const input = document.getElementById(b.dataset.mic);
  if (input) startMic(input, b);
});

// 아래 메뉴: 홈 · 기록 · 가게
const NAV_GROUP = { home: 'home', posts: 'posts', insta: 'posts', customers: 'posts', post: 'posts', store: 'store', channels: 'store', 'channels-adv': 'store' };
function highlightNav() {
  const g = NAV_GROUP[state.view];
  $nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === g));
  const full = ['write', 'connect'].includes(state.view); // 단계 화면은 메뉴를 숨김
  $nav.classList.toggle('hidden', full);
}

// 기록·가게 위쪽 작은 탭
function subTabs(items) {
  return `<div class="w-seg">${items.map(([v, l]) => `<button type="button" data-go-view="${v}" class="${state.view === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
const RECORD_TABS = [['posts', '게시물'], ['insta', '반응'], ['customers', '손님']];
const SHOP_TABS = [['store', '가게 정보'], ['channels', '계정 연결']];
function withTabs() {
  const tabs = RECORD_TABS.some(([v]) => v === state.view) ? RECORD_TABS : SHOP_TABS.some(([v]) => v === state.view) ? SHOP_TABS : null;
  if (!tabs || $app.querySelector('.w-seg')) return;
  $app.insertAdjacentHTML('afterbegin', subTabs(tabs));
  if (tabs === SHOP_TABS) $app.insertAdjacentHTML('beforeend', `<div class="w-account"><span>${esc(state.user?.loginId || '')} 님</span><button type="button" class="btn line" data-w-logout>로그아웃</button></div>`);
}
$app.addEventListener('click', (e) => {
  const v = e.target.closest('[data-go-view]');
  if (v) return setView(v.dataset.goView);
  if (e.target.closest('[data-w-logout]')) document.getElementById('logoutBtn').click();
});

// ---------- 홈 ----------
function weekRange() {
  const now = new Date();
  const mon = new Date(now); mon.setHours(0, 0, 0, 0); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (d) => `${d.getMonth() + 1}. ${d.getDate()}`;
  return { from: mon, to: new Date(sun.getTime() + 864e5 - 1), label: `${f(mon)} ~ ${f(sun)}` };
}

async function renderHome() {
  const s = state.store;
  const wk = weekRange();
  $app.innerHTML = `
  <div class="home">
    <div class="home-top">
      <button type="button" class="home-store" data-go-view="store">${esc(s.name)} <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      <button type="button" class="home-write" data-w-write>＋ 글쓰기</button>
      <button type="button" class="home-me" data-go-view="store" aria-label="내 정보"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 18.5c1.6-2.4 3.9-3.6 6.5-3.6s4.9 1.2 6.5 3.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>
    </div>

    <div class="home-card hero">
      <div><h2>사장님, 오늘도<br>같이가게와 함께해요</h2>
        <button type="button" class="hero-link" data-w-consult>두리 컨설팅 시작하기 ›</button></div>
      ${robot('shy', 'hero-robot')}
    </div>

    <form class="home-ask" data-w-ask>
      <input id="askInput" placeholder="두리에게 질문하기" autocomplete="off" maxlength="300" />
      ${micBtn('askInput')}
    </form>

    <div class="home-card">
      <button type="button" class="home-head" data-go-view="insta"><span><b>이번 주 홍보 요약</b><small>${wk.label}</small></span><span class="chev">›</span></button>
      <div class="home-stats" id="homeStats"><div><b>–</b><span>올린 게시물</span></div><div><b>–</b><span>좋아요</span></div><div><b>–</b><span>댓글</span></div></div>
      <p class="home-note" id="homeNote">반응을 불러오는 중이에요</p>
    </div>

    <div class="home-card">
      <button type="button" class="home-head" data-go-view="posts"><b>최근 홍보</b><span class="chev">›</span></button>
      <div class="home-grid" id="homeRecent"><div class="hint">불러오는 중…</div></div>
    </div>

    <div class="home-card">
      <button type="button" class="home-head" data-go-view="insta"><b>어디서 반응했나요?</b><span class="chev">›</span></button>
      <div class="home-pf" id="homePf">${PLATFORMS.map((p) => `<div>${ICON[p.id]}<span>👍 – · 💬 –</span></div>`).join('')}</div>
      <div class="home-chart" id="homeChart"></div>
    </div>
  </div>`;
  fillHome(wk).catch(() => {});
}

async function fillHome(wk) {
  const [posts, re] = await Promise.all([
    api('GET', `/api/stores/${state.storeId}/posts`),
    api('GET', `/api/stores/${state.storeId}/reactions`).catch(() => ({ items: [] })),
  ]);
  if (state.view !== 'home') return;
  // 최근 홍보: 올린 게시물의 첫 사진(카드)
  const recent = posts.filter((p) => p.images?.length).slice(0, 6);
  document.getElementById('homeRecent').innerHTML = recent.length
    ? recent.map((p) => { const im = p.images.find((i) => i.id === p.selectedImageIds?.[0]) || p.images[0]; return `<button type="button" class="home-thumb" data-open="${p.id}"><img src="${imgUrl(im)}" alt="${esc(p.topic)}" /></button>`; }).join('')
    : `<div class="home-empty">${robot('think', 'robot sm')}<span>아직 만든 홍보가 없어요.<br><b>＋ 글쓰기</b>로 첫 홍보를 만들어 보세요.</span></div>`;
  // 이번 주 요약 (이번 주에 올린 게시물 기준)
  const inWeek = (iso) => iso && new Date(iso) >= wk.from && new Date(iso) <= wk.to;
  const weekItems = re.items.filter((x) => inWeek(x.at));
  let likes = 0, comments = 0;
  const pf = Object.fromEntries(PLATFORMS.map((p) => [p.id, { likes: 0, comments: 0 }]));
  for (const it of re.items) for (const [id, x] of Object.entries(it.platforms)) { pf[id].likes += x.counts?.likes || 0; pf[id].comments += x.counts?.comments || 0; }
  for (const it of weekItems) for (const x of Object.values(it.platforms)) { likes += x.counts?.likes || 0; comments += x.counts?.comments || 0; }
  document.getElementById('homeStats').innerHTML = `<div><b>${nf(weekItems.length)}개</b><span>올린 게시물</span></div><div><b>${nf(likes)}개</b><span>좋아요</span></div><div><b>${nf(comments)}개</b><span>댓글</span></div>`;
  const best = Object.entries(pf).sort((a, b) => (b[1].likes + b[1].comments * 2) - (a[1].likes + a[1].comments * 2))[0];
  document.getElementById('homeNote').textContent = !weekItems.length ? '이번 주엔 아직 올린 홍보가 없어요'
    : likes + comments === 0 ? '아직 반응을 모으고 있어요' : `${PF[best[0]].name}에서 반응이 가장 좋아요`;
  document.getElementById('homePf').innerHTML = PLATFORMS.map((p) => `<div>${ICON[p.id]}<span>👍 ${nf(pf[p.id].likes)} &nbsp;💬 ${nf(pf[p.id].comments)}</span></div>`).join('');
  // 그래프: 최근 올린 게시물(오래된 순 최대 7개)의 좋아요+댓글
  const pts = re.items.slice(0, 7).reverse().map((it) => ({ t: it.topic, v: Object.values(it.platforms).reduce((n, x) => n + (x.counts?.likes || 0) + (x.counts?.comments || 0), 0) }));
  document.getElementById('homeChart').innerHTML = chartSvg(pts);
}

function chartSvg(pts) {
  if (pts.length < 2) return '<div class="home-chart-empty">게시물을 2개 이상 올리면 반응 흐름을 그래프로 보여 드려요</div>';
  const W = 320, H = 110, P = 14;
  const max = Math.max(1, ...pts.map((p) => p.v));
  const xy = pts.map((p, i) => [P + (i * (W - P * 2)) / (pts.length - 1), H - P - (p.v / max) * (H - P * 2)]);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 게시물 반응 흐름"><polyline points="${xy.map((q) => q.join(',')).join(' ')}" fill="none" stroke="#c0262d" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>${xy.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="3.2" fill="#c0262d"><title>${esc(pts[i].t)}: ${pts[i].v}</title></circle>`).join('')}</svg>
    <div class="hint" style="text-align:center">최근 게시물별 좋아요 + 댓글</div>`;
}

// 홈 동작
$app.addEventListener('click', (e) => {
  if (state.view !== 'home') return;
  if (e.target.closest('[data-w-write]')) return startWrite();
  if (e.target.closest('[data-w-consult]')) return openFeedback();
});
$app.addEventListener('submit', async (e) => {
  if (!e.target.matches('[data-w-ask]')) return;
  e.preventDefault();
  const input = document.getElementById('askInput');
  const q = input.value.trim();
  if (!q) return toast('두리에게 궁금한 걸 적어 주세요.');
  const m = modal(`<div class="ask-box">${robot('think', 'robot md')}<p class="ask-q">“${esc(q)}”</p><div class="spinner"></div><p class="hint" style="text-align:center">두리가 생각하는 중…</p></div>`);
  try {
    const r = await api('POST', `/api/stores/${state.storeId}/ask`, { question: q });
    if (!document.body.contains(m.el)) return;
    m.el.querySelector('.modal-box').innerHTML = `<div class="ask-box">${robot('guide', 'robot md')}<p class="ask-q">“${esc(q)}”</p><div class="ask-a">${esc(r.answer)}</div>
      ${r.source === 'mock' ? '<p class="hint">예시 답변이에요. AI 키를 연결하면 두리가 직접 답해요.</p>' : '<p class="hint">두리의 답변은 참고용이에요.</p>'}</div>
      <div class="row"><button class="btn primary" data-ask-write>이 내용으로 글쓰기</button><button class="btn line" data-m="close">닫기</button></div>`;
    input.value = '';
    m.el.addEventListener('click', (ev) => {
      if (!ev.target.closest('[data-ask-write]')) return;
      m.close();
      startWrite({ detail: q });
    });
  } catch (err) {
    m.close();
    toast(err.message);
  }
});

// ---------- 글쓰기 (4단계) ----------
const TONE_LABEL = { '깔끔하게 정보 위주로': '정보 위주로', '이벤트 느낌으로': '이벤트처럼', '고급스럽게': '고급지게' };
function startWrite(prefill = {}) {
  state.wstep = 1;
  state.wideas = null;
  Object.assign(state.newDraft, prefill);
  setView('write');
}

function renderWrite() {
  const d = state.newDraft;
  const n = state.wstep || 1;
  const products = (state.store?.products || []).map((p) => p.name).filter(Boolean);
  let body = '', foot = '';
  if (n === 1) {
    const opts = state.wideas ? state.wideas.map((i) => i.topic) : products;
    const custom = d.topic && !opts.includes(d.topic) ? d.topic : '';
    body = `${robot('think', 'w-robot')}
      <h1>사장님, 무엇을 홍보할까요?</h1><p class="w-sub">알리고 싶은 내용을 고르면 두리가 홍보글을 만들어드려요</p>
      ${state.wideas ? '<p class="w-tag">두리 추천</p>' : ''}
      <div class="w-opts">
        ${opts.map((t, i) => `<button type="button" class="w-opt" data-w-topic="${esc(t)}"><span class="w-pill">${esc(t)}${state.wideas?.[i]?.why ? `<small>${esc(state.wideas[i].why)}</small>` : ''}</span>${check(d.topic === t)}</button>`).join('')}
        <label class="w-opt"><input class="w-pill" id="wTopic" value="${esc(custom)}" placeholder="직접 입력.." maxlength="100" />${check(!!custom)}</label>
      </div>`;
    foot = `<div class="w-reco"><span>무엇을 올릴지 모르겠어요</span><button type="button" data-w-ideas>두리 추천 받기 ›</button></div>
      <button type="button" class="btn primary w-cta" data-w-next>다음</button>`;
  } else if (n === 2) {
    body = `${robot('guide', 'w-robot')}
      <h1>강조하고 싶은 내용이 있나요?</h1><p class="w-sub">가격, 할인, 기간, 장점을 알려주세요</p>
      <div class="w-area"><textarea id="wDetail" maxlength="500" placeholder="• 새로 바꾼 의자가 편안해요&#10;• 이번 주말까지 이용료 10% 할인해요.">${esc(d.detail)}</textarea>${micBtn('wDetail')}</div>`;
    foot = `<button type="button" class="btn primary w-cta" data-w-next>다음</button>`;
  } else if (n === 3) {
    const tones = state.tones.length ? state.tones : TONE_DEFAULT;
    const customTone = d.tone && !tones.includes(d.tone) ? d.tone : '';
    body = `${robot('shy', 'w-robot')}
      <h1>어떤 말투로 할까요?</h1><p class="w-sub">원하는 느낌을 하나 골라주세요</p>
      <div class="w-tones">
        ${tones.map((t) => `<button type="button" class="w-tone ${d.tone === t ? 'on' : ''}" data-w-tone="${esc(t)}">${d.tone === t ? '✓ ' : ''}${esc(TONE_LABEL[t] || t)}</button>`).join('')}
        <input class="w-tone ${customTone ? 'on' : ''}" id="wTone" value="${esc(customTone)}" placeholder="직접 입력.." maxlength="30" />
      </div>`;
    foot = `<button type="button" class="btn primary w-cta" data-w-next>다음</button>`;
  } else {
    body = `${robot('hello', 'w-robot')}
      <h1>마지막으로 사진을<br>첨부해주세요</h1><p class="w-sub muted">최대 10장 - 사진을 참고해 문구를 만들어요</p>
      ${d.files.length ? `<div class="w-photos">${d.files.map((f, i) => `<div class="thumb"><img src="${URL.createObjectURL(f)}" alt="" /><button class="thumb-del" data-w-delphoto="${i}" aria-label="삭제">×</button></div>`).join('')}
        ${d.files.length < 10 ? '<button type="button" class="w-addmore" data-w-photo>＋</button>' : ''}</div>`
      : `<button type="button" class="w-drop" data-w-photo><svg viewBox="0 0 24 24"><rect x="3" y="5" width="15" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="10" r="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 18l5-5 4 4 2-2 3.5 3.5M18 2.5v6M15 5.5h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span>사진을 추가해 주세요</span></button>`}
      <p class="w-info">ⓘ 사진 없이도 홍보글을 만들 수 있어요.</p>`;
    foot = `<button type="button" class="btn primary w-cta" data-w-make>두리와 홍보글 만들기</button>`;
  }
  $app.innerHTML = `<div class="w-screen">
    <div class="w-head">${backBtn('data-w-back')}${progress(n, 4)}</div>
    <div class="w-body">${body}</div>
    <div class="w-foot">${foot}</div></div>`;
}

function syncWrite() {
  const d = state.newDraft;
  const t = document.getElementById('wTopic');
  if (t && t.value.trim()) d.topic = t.value.trim();
  const dd = document.getElementById('wDetail');
  if (dd) d.detail = dd.value;
  const tn = document.getElementById('wTone');
  if (tn && tn.value.trim()) d.tone = tn.value.trim();
}

$app.addEventListener('input', (e) => {
  if (state.view !== 'write') return;
  if (e.target.id === 'wTopic') { // 직접 입력하면 위 선택 해제
    $app.querySelectorAll('.w-check').forEach((c) => c.classList.remove('on'));
    if (e.target.value.trim()) e.target.parentElement.querySelector('.w-check').classList.add('on');
  }
  if (e.target.id === 'wTone') $app.querySelectorAll('.w-tone').forEach((c) => c.classList.toggle('on', c === e.target && !!e.target.value.trim()));
});

$app.addEventListener('click', async (e) => {
  if (state.view !== 'write') return;
  const d = state.newDraft;
  const el = (s) => e.target.closest(s);
  let x;
  if (el('[data-w-back]')) {
    syncWrite();
    if (state.wstep > 1) { state.wstep--; return renderWrite(); }
    return setView('home');
  }
  if ((x = el('[data-w-topic]'))) { d.topic = x.dataset.wTopic; const idea = state.wideas?.find((i) => i.topic === d.topic); if (idea?.detail && !d.detail) d.detail = idea.detail; return renderWrite(); }
  if ((x = el('[data-w-tone]'))) { d.tone = x.dataset.wTone; return renderWrite(); }
  if (el('[data-w-ideas]')) {
    const b = el('[data-w-ideas]');
    b.textContent = '두리가 고르는 중…';
    try { state.wideas = (await api('POST', `/api/stores/${state.storeId}/ideas`)).ideas; }
    catch (err) { toast(err.message); }
    return renderWrite();
  }
  if (el('[data-w-next]')) {
    syncWrite();
    if (state.wstep === 1) {
      const custom = document.getElementById('wTopic')?.value.trim();
      if (custom) d.topic = custom;
      if (!d.topic) return toast('무엇을 홍보할지 골라 주시거나 적어 주세요.');
    }
    state.wstep++;
    window.scrollTo(0, 0);
    return renderWrite();
  }
  if (el('[data-w-photo]')) {
    const files = await pickFiles({ camera: false });
    d.files.push(...files);
    if (d.files.length > 10) { d.files.length = 10; toast('사진은 10장까지예요.'); }
    return renderWrite();
  }
  if ((x = el('[data-w-delphoto]'))) { d.files.splice(Number(x.dataset.wDelphoto), 1); return renderWrite(); }
  if (el('[data-w-make]')) {
    state.view = 'new'; // createPost는 기존 '새 게시물' 흐름을 그대로 씀
    await createPost();
    if (state.view === 'new') { state.view = 'write'; renderWrite(); } // 실패하면 사진 단계로
  }
});

// ---------- 계정 연결 (2단계) ----------
// mode: 'onboarding'(가게 등록 직후) | 'manage'(가게 탭)
function startConnect(mode) {
  state.cmode = mode;
  state.cstep = 'pick';
  state.cpick = state.cpick || PLATFORMS.filter((p) => state.connections[p.id]?.connected).map((p) => p.id);
  if (!state.cpick.length) state.cpick = ['instagram'];
  setView('connect');
}

function renderConnect() {
  const c = state.connections || {};
  if (state.cstep === 'pick') {
    $app.innerHTML = `<div class="w-screen">
      <div class="w-head">${backBtn('data-c-back')}</div>
      <div class="w-body">${robot('think', 'w-robot')}
        <h1>사장님, 어떤 계정부터<br>연결 하시겠어요?</h1><p class="w-sub">한번 연결해 두면 게시물을 여러곳에 올릴 수 있어요</p>
        <div class="w-opts">${PLATFORMS.map((p) => `<button type="button" class="w-opt" data-c-pick="${p.id}"><span class="w-pill pf">${ICON[p.id]}${p.name}${c[p.id]?.connected ? '<small class="ok">● 연결됨</small>' : ''}</span>${check(state.cpick.includes(p.id))}</button>`).join('')}</div>
      </div>
      <div class="w-foot">${state.cmode === 'onboarding' ? '<button type="button" class="w-skip" data-c-skip>건너뛰기</button>' : ''}
        <button type="button" class="btn primary w-cta" data-c-go>${state.cmode === 'onboarding' ? '연결 완료' : '다음'}</button></div></div>`;
    return;
  }
  const id = state.cqueue[state.cidx];
  const p = PF[id];
  const info = c[id] || {};
  const env = c.envManaged?.[id];
  const fields = id === 'facebook'
    ? [['pageId', '페이지 ID', info.pageId || ''], ['token', '페이지 액세스 토큰', '']]
    : id === 'instagram' ? [['token', '액세스 토큰 (IG… 또는 EAA…)', ''], ['igUserId', '인스타 계정 ID (선택)', info.igUserId || '']]
      : [['token', '액세스 토큰 (TH…)', '']];
  $app.innerHTML = `<div class="w-screen">
    <div class="w-head">${backBtn('data-c-back')}<span class="w-me"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4.2" fill="currentColor"/><path d="M3.5 21c.9-4.4 4.3-6.6 8.5-6.6s7.6 2.2 8.5 6.6z" fill="currentColor"/></svg></span></div>
    <div class="w-body">
      <h1 class="c-title">계정 연결</h1>
      <div class="c-acc">${ICON[id]}<b>${{ instagram: 'INSTAGRAM', facebook: 'FACEBOOK', threads: 'THREADS' }[id]} ACCOUNT</b><span class="${info.connected ? 'ok' : ''}">${info.connected ? '● 연결됨' : '○ 연결안됨'}</span></div>
      ${env ? `<p class="c-note">서버에 미리 연결해 둔 계정이에요. 바로 올릴 수 있어요.</p>`
        : `${fields.map(([k, label, v]) => `<input class="w-field" data-ck="${k}" value="${esc(v)}" placeholder="${esc(info.connected && k === 'token' ? `저장됨 (${info.token}) · 바꿀 때만 입력` : label)}" ${k === 'token' ? 'type="password" autocomplete="off"' : ''} />`).join('')}
           <button type="button" class="btn primary w-cta slim" data-c-save>저장하고 연결 확인</button>
           <details class="c-help"><summary>토큰은 어디서 받나요?</summary><p>Meta 개발자 센터(developers.facebook.com)에서 앱을 만들고, 그래프 API 탐색기에서 ${id === 'facebook' ? '페이지 토큰' : id === 'threads' ? '스레드 사용자 토큰' : '인스타그램 토큰'}을 받아 붙여 넣어 주세요. 비밀번호는 넣지 마세요.</p></details>`}
    </div>
    <div class="w-foot">${state.cmode === 'onboarding' ? '<button type="button" class="w-skip" data-c-next>건너뛰기</button>' : ''}
      <button type="button" class="btn primary w-cta" data-c-next>${state.cidx < state.cqueue.length - 1 ? '다음' : '완료'}</button></div></div>`;
}

function finishConnect() {
  state.cpick = null;
  if (state.cmode === 'onboarding') { toast('준비 끝! 두리와 함께 시작해요'); return setView('home'); }
  return setView('channels');
}

$app.addEventListener('click', async (e) => {
  if (state.view !== 'connect') return;
  const el = (s) => e.target.closest(s);
  let x;
  if (el('[data-c-back]')) {
    if (state.cstep === 'one' && state.cidx > 0) { state.cidx--; return renderConnect(); }
    if (state.cstep === 'one') { state.cstep = 'pick'; return renderConnect(); }
    return state.cmode === 'onboarding' ? setView('home') : setView('channels');
  }
  if ((x = el('[data-c-pick]'))) {
    const id = x.dataset.cPick;
    state.cpick = state.cpick.includes(id) ? state.cpick.filter((v) => v !== id) : [...state.cpick, id];
    return renderConnect();
  }
  if (el('[data-c-skip]')) return finishConnect();
  if (el('[data-c-go]')) {
    if (!state.cpick.length) return toast('연결할 계정을 하나 이상 골라 주세요.');
    state.cqueue = PLATFORMS.map((p) => p.id).filter((id) => state.cpick.includes(id));
    state.cidx = 0;
    state.cstep = 'one';
    return renderConnect();
  }
  if (el('[data-c-save]')) {
    const id = state.cqueue[state.cidx];
    const vals = {};
    $app.querySelectorAll('[data-ck]').forEach((i) => (vals[i.dataset.ck] = i.value.trim()));
    if (!vals.token && !state.connections[id]?.connected) return toast('토큰을 넣어 주세요.');
    const b = el('[data-c-save]');
    b.disabled = true; b.textContent = '연결 확인 중…';
    try {
      await api('PUT', '/api/connections', { [id]: vals });
      const r = await fetch(`/api/connections/${id}/test`, { method: 'POST' }).then((y) => y.json());
      if (r.ok) toast(`✅ ${r.message}`); else alertBox(`연결 확인 실패\n\n${r.error}`);
    } catch (err) { toast(err.message); }
    await loadConnections();
    return renderConnect();
  }
  if (el('[data-c-next]')) {
    if (state.cidx < state.cqueue.length - 1) { state.cidx++; return renderConnect(); }
    return finishConnect();
  }
});

// 가게 탭의 '계정 연결': 연결 상태 요약 + 연결하기
async function renderChannelsSimple() {
  const c = await loadConnections();
  $app.innerHTML = `<h1>계정 연결</h1><p class="lead">한 번 연결해 두면 게시물을 버튼 하나로 여러 곳에 올릴 수 있어요.</p>
    <div class="w-opts">${PLATFORMS.map((p) => `<div class="w-opt static"><span class="w-pill pf">${ICON[p.id]}${p.name}</span><span class="c-state ${c[p.id]?.connected ? 'ok' : ''}">${c[p.id]?.connected ? '● 연결됨' : '○ 연결안됨'}</span></div>`).join('')}</div>
    <button type="button" class="btn primary w-cta" data-w-connect style="margin-top:18px">계정 연결하기</button>
    <button type="button" class="btn ghost" data-go-view="channels-adv" style="margin-top:6px">고급 설정 (공개 주소 등)</button>`;
}
$app.addEventListener('click', (e) => { if (e.target.closest('[data-w-connect]')) startConnect('manage'); });
