// 같이가게 프론트엔드 (빌드 도구 없이 바로 실행되는 순수 JS)
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');

const state = {
  storeId: null,
  store: null,
  view: 'posts',
  postId: null,
  post: null,
  tones: [],
  connections: {},
  capTab: 'instagram',
  filter: 'all',
  newDraft: { topic: '', detail: '', tone: '친근하게', layout: 'magazine', effect: 'none', files: [] }, // 새 게시물 입력 중인 내용
};

const PLATFORMS = [
  { id: 'instagram', name: '인스타그램', icon: '📸', needPhoto: true, limit: 2200 },
  { id: 'facebook', name: '페이스북', icon: '📘', needPhoto: false, limit: 5000 },
  { id: 'threads', name: '스레드', icon: '🧵', needPhoto: false, limit: 500 },
];
const PF = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));
const KIND_LABEL = { reference: '원본', enhanced: '보정', card: '홍보 카드', ai: 'AI' };

// ---------- 유틸 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch {} }

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.needLogin && state.user) { state.user = null; render(); } // 로그인이 풀렸으면 로그인 화면으로
  if (!res.ok) throw new Error(data.error || '요청에 실패했어요.');
  return data;
}

async function uploadImage(postId, blob, { kind, source, label, select }) {
  const qs = new URLSearchParams({ kind, ...(source ? { source } : {}), ...(label ? { label } : {}), ...(select ? { select: '1' } : {}) });
  const res = await fetch(`/api/posts/${postId}/images?${qs}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '사진을 올리지 못했어요.');
  return data;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

function loading(msg, steps) {
  if (steps) { // 글쓰기 결과를 만드는 중 (와이어프레임: 멋지게 만들고 있어요!)
    $nav.classList.add('hidden');
    $app.innerHTML = `<div class="w-screen"><div class="w-head"><span class="w-back ghost"></span>${progress(1, 1)}</div>
      <div class="w-body w-center">${robot('guide', 'w-robot')}<h1>멋지게 만들고 있어요!</h1><p class="w-sub muted" id="loadMsg">잠시만 기다려 주세요</p>
      <ul class="steps">${steps.map((s, i) => `<li data-step="${i}">${esc(s)}</li>`).join('')}</ul></div>
      <div class="w-foot w-center"><div class="spinner big"></div></div></div>`;
    return;
  }
  $app.innerHTML = `<div class="loading">${robot('guide', 'robot md')}<div class="spinner"></div><div id="loadMsg">${esc(msg)}</div>${steps ? `<ul class="steps">${steps.map((s, i) => `<li data-step="${i}">${esc(s)}</li>`).join('')}</ul>` : ''}</div>`;
}
function stepDone(i) {
  const li = document.querySelector(`[data-step="${i}"]`);
  if (li) li.classList.add('done');
  const next = document.querySelector(`[data-step="${i + 1}"]`);
  if (next) next.classList.add('now');
}

function modal(html, onClick) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-box">${html}</div>`;
  const close = () => m.remove();
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.closest('[data-m=close]')) return close();
    onClick?.(e, close, m);
  });
  document.body.appendChild(m);
  return { el: m, close };
}
function alertBox(msg) {
  modal(`<div style="white-space:pre-wrap">${esc(msg)}</div><div class="row"><button class="btn primary" data-m="close">확인</button></div>`);
}
function confirmBox(html, okLabel = '확인') {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(`${html}<div class="row"><button class="btn primary" data-m="ok">${esc(okLabel)}</button><button class="btn line" data-m="close">취소</button></div>`, (e, close) => {
      if (e.target.closest('[data-m=ok]')) { done = true; close(); resolve(true); }
    });
    new MutationObserver(() => { if (!document.body.contains(m.el) && !done) resolve(false); }).observe(document.body, { childList: true });
  });
}

// 게시 PIN 입력 (서버에 INSTAGRAM_PUBLISH_PIN이 있을 때만). 취소하면 null
function pinBox(title) {
  if (!state.connections?.pinRequired) return Promise.resolve('');
  return new Promise((resolve) => {
    let done = false;
    const m = modal(`<div class="fact-title" style="margin-top:0">${esc(title)}</div><p class="hint">팀에서 정한 게시 PIN을 넣어 주세요.</p>
      <input data-pin inputmode="numeric" autocomplete="off" placeholder="게시 PIN" />
      <div class="row"><button class="btn primary" data-m="ok">확인</button><button class="btn line" data-m="close">취소</button></div>`, (e, close) => {
      if (e.target.closest('[data-m=ok]')) { done = true; const v = m.el.querySelector('[data-pin]').value; close(); resolve(v); }
    });
    m.el.querySelector('[data-pin]').focus();
    m.el.querySelector('[data-pin]').addEventListener('keydown', (e) => { if (e.key === 'Enter') m.el.querySelector('[data-m=ok]').click(); });
    new MutationObserver(() => { if (!document.body.contains(m.el) && !done) resolve(null); }).observe(document.body, { childList: true });
  });
}

// ---------- SNS 앱에서 직접 지운 게시물 반영 ----------
function removedToast(removed) {
  if (!removed?.length) return;
  const r = removed[0];
  toast(`${r.name}에서 지운 '${r.topic}' 게시물을 삭제됨으로 바꿨어요${removed.length > 1 ? ` (외 ${removed.length - 1}건)` : ''}`);
}
let syncing = false;
async function snsSync(force) {
  if (syncing || !state.storeId) return;
  syncing = true;
  try {
    if (state.view === 'post' && state.post) {
      if (!Object.values(state.post.publications || {}).some((p) => p.status === 'published')) return;
      const { post, removed } = await api('POST', `/api/posts/${state.post.id}/sync`, { force: !!force });
      if (removed.length && state.view === 'post' && state.post?.id === post.id) { await refreshPost(post); removedToast(removed); }
    } else if (state.view === 'posts') {
      const { removed } = await api('POST', `/api/stores/${state.storeId}/sync`, {});
      if (removed.length && state.view === 'posts') { await renderPosts(); removedToast(removed); }
    }
  } catch {} finally { syncing = false; }
}
// 인스타그램 앱에서 지우고 돌아오면 바로 확인
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') snsSync(true); });

function setView(view, extra = {}) {
  Object.assign(state, extra);
  state.view = view;
  $nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo(0, 0);
  render();
}

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const imgUrl = (im) => `/uploads/${im.file}`;

// ---------- 사진 고르기 / 카메라 ----------
const isTouch = () => matchMedia('(pointer: coarse)').matches;

function pickFiles({ camera }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.capture = 'environment';
    else input.multiple = true;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

// PC: 웹캠 화면 / 폰: 카메라 앱
async function takePhoto() {
  if (isTouch() || !navigator.mediaDevices?.getUserMedia) return pickFiles({ camera: true });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false });
  } catch {
    toast('카메라를 쓸 수 없어요. 사진 고르기로 넣어 주세요.');
    return pickFiles({ camera: false });
  }
  return new Promise((resolve) => {
    const stop = () => stream.getTracks().forEach((t) => t.stop());
    const m = modal(`<video autoplay playsinline muted></video>
      <div class="row"><button class="btn primary" data-m="shot">📸 찍기</button><button class="btn line" data-m="close">닫기</button></div>`,
      async (e, close) => {
        if (!e.target.closest('[data-m=shot]')) return;
        const video = m.el.querySelector('video');
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0);
        stop(); close();
        resolve([await Imaging.toJpeg(c, 0.92)]);
      });
    m.el.querySelector('video').srcObject = stream;
    new MutationObserver((_, obs) => { if (!document.body.contains(m.el)) { stop(); obs.disconnect(); resolve([]); } }).observe(document.body, { childList: true });
  });
}

// ---------- 가게 정보 폼 ----------
const CATEGORY_EXAMPLES = ['카페', '음식점', '치킨집', 'PC방', '미용실', '꽃집', '베이커리', '네일샵'];
const DEFAULT_STORE = {
  name: '별빛 PC방',
  category: 'PC방',
  address: '경북 경산시 대학로 280',
  products: [
    { name: '신형 게이밍 좌석', price: '1,500원/시간' },
    { name: '야간 정액제(밤 10시~아침 8시)', price: '9,000원' },
    { name: '라면·음료 세트', price: '4,500원' },
  ],
  goal: '근처 대학생 손님을 늘리고 싶어요',
  etc: '24시간 영업, 근처 대학교 학생 손님이 많고 평일 낮 시간이 한가해요',
};

function productRow(p = { name: '', price: '' }) {
  return `<div class="product-row">
    <input data-p="name" value="${esc(p.name)}" placeholder="상품·서비스 이름" />
    <input data-p="price" value="${esc(p.price)}" placeholder="가격 (선택)" />
    <button type="button" class="icon-btn" data-action="del-product" aria-label="삭제">×</button>
  </div>`;
}

function storeForm(store) {
  const s = store || DEFAULT_STORE;
  const products = s.products?.length ? s.products : [{ name: '', price: '' }];
  return `
    <h1>${store ? '가게 정보' : '우리 가게 등록하기'}</h1>
    <p class="lead">${store ? '여기 적힌 내용을 AI가 게시물 문구를 쓸 때 참고해요. 바뀐 내용만 고치고 저장하세요.' : '한 번만 입력해 두시면, 게시물을 만들 때마다 AI가 우리 가게에 맞게 써 드려요.'}</p>
    <form id="storeForm" class="card" autocomplete="off">
      <label>가게 이름 <span class="req">*</span></label>
      <input name="name" value="${esc(s.name)}" placeholder="예: 별빛 PC방" />

      <label>업종 <span class="req">*</span></label>
      <input name="category" value="${esc(s.category)}" placeholder="예: PC방" />
      <div class="chips" data-fill="category">
        ${CATEGORY_EXAMPLES.map((c) => `<button type="button" class="chip ${s.category === c ? 'on' : ''}" data-val="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>

      <label>주소 <span class="req">*</span> <span class="hint">(동네 이름까지 · 해시태그에 쓰여요)</span></label>
      <input name="address" value="${esc(s.address)}" placeholder="예: 경북 경산시 대학로 123" />

      <label>상품·서비스 <span class="hint">(AI가 참고하는 정보예요 · 새 게시물에서 골라 쓸 수 있어요)</span></label>
      <div id="products">${products.map((p) => productRow(p)).join('')}</div>
      <button type="button" class="btn line" data-action="add-product">+ 상품 추가</button>

      <label>가게 홍보 목표 <span class="hint">(선택)</span></label>
      <textarea name="goal" placeholder="예: 단골손님을 늘리고 싶어요">${esc(s.goal)}</textarea>

      <label>기타 <span class="hint">(영업시간, 가게 자랑, 주 손님층 등 무엇이든)</span></label>
      <textarea name="etc" placeholder="예: 24시간 영업, 대학생 손님이 많아요">${esc(s.etc)}</textarea>

      <div class="row"><button type="submit" class="btn primary block">${store ? '저장하기' : '등록하고 시작하기'}</button></div>
      ${store ? '<div class="row"><button type="button" class="btn ghost" data-action="reset-store">다른 가게로 새로 시작하기</button></div>' : ''}
    </form>`;
}

function bindStoreForm(store) {
  const form = document.getElementById('storeForm');
  form.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) {
      form.elements[chip.parentElement.dataset.fill].value = chip.dataset.val;
      chip.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chip));
      return;
    }
    const act = e.target.dataset.action;
    const box = document.getElementById('products');
    if (act === 'add-product') {
      if (box.children.length >= 20) return toast('상품은 20개까지 입력할 수 있어요.');
      box.insertAdjacentHTML('beforeend', productRow());
    }
    if (act === 'del-product') {
      if (box.children.length > 1) e.target.closest('.product-row').remove();
      else box.querySelectorAll('input').forEach((i) => (i.value = ''));
    }
    if (act === 'reset-store') {
      confirmBox('지금 가게와 게시물은 이 브라우저에서 연결이 끊겨요. 새로 시작할까요?', '새로 시작').then((ok) => {
        if (!ok) return;
        lsDel('gachi.storeId');
        state.storeId = null;
        render();
      });
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const products = [...document.querySelectorAll('.product-row')].map((r) => ({
      name: r.querySelector('[data-p=name]').value,
      price: r.querySelector('[data-p=price]').value,
    }));
    const body = { name: f.name.value, category: f.category.value, address: f.address.value, products, goal: f.goal.value, etc: f.etc.value };
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if (store) {
        state.store = await api('PUT', `/api/stores/${store.id}`, body);
        toast('저장했어요. 다음 게시물부터 반영돼요.');
        btn.disabled = false;
      } else {
        const created = await api('POST', '/api/stores', body);
        state.storeId = created.id;
        state.store = created;
        lsSet('gachi.storeId', created.id);
        setView('new');
      }
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
}

// ---------- 내 게시물 (관리) ----------
const STATUS_LABEL = { draft: '임시저장', published: '게시됨', partial: '일부 실패', failed: '게시 실패', deleted: '삭제됨' };

function pubIcons(post) {
  return PLATFORMS.map((pf) => {
    const p = post.publications?.[pf.id];
    if (!p) return '';
    const mark = p.status === 'published' ? '✅' : p.status === 'failed' ? '⚠️' : '🗑';
    return `<span class="pub-chip ${p.status}">${mark} ${pf.name}</span>`;
  }).join('');
}

async function renderPosts() {
  loading('불러오는 중…');
  const posts = await api('GET', `/api/stores/${state.storeId}/posts`);
  const counts = { all: posts.length, draft: posts.filter((p) => p.status === 'draft').length, published: posts.filter((p) => ['published', 'partial'].includes(p.status)).length };
  const shown = posts.filter((p) => state.filter === 'all' || (state.filter === 'draft' ? p.status === 'draft' : ['published', 'partial'].includes(p.status)));
  $app.innerHTML = `
    <div class="head-row">
      <div><h1>내 게시물</h1><p class="lead" style="margin:0">${esc(state.store?.name || '')} · 올린 게시물을 한곳에서 관리해요</p></div>
    </div>
    <button class="btn primary block big-new" data-go="new">＋ 새 게시물 만들기</button>
    <div class="chips filter">
      ${[['all', '전체'], ['draft', '임시저장'], ['published', '게시됨']].map(([k, l]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-filter="${k}">${l} ${counts[k]}</button>`).join('')}
    </div>
    ${shown.length ? shown.map((p) => {
      const cover = p.images.find((i) => i.id === p.selectedImageIds[0]) || p.images[0];
      return `<article class="card post-item" data-open="${p.id}">
        <div class="post-thumb">${cover ? `<img src="${imgUrl(cover)}" alt="" />` : '<span>📝</span>'}</div>
        <div class="post-body">
          <div class="post-top"><span class="status-badge ${p.status}">${STATUS_LABEL[p.status]}</span><span class="date">${fmtDate(p.createdAt)}</span></div>
          <div class="post-title">${esc(p.topic)}</div>
          <div class="post-cap">${esc((p.captions?.instagram || p.captions?.facebook || p.detail || '').slice(0, 60))}</div>
          <div class="pubs">${pubIcons(p)}</div>
        </div>
      </article>`;
    }).join('') : `<div class="card empty">${robot('think', 'robot md')}<br>${posts.length ? '이 조건의 게시물이 없어요.' : '아직 만든 게시물이 없어요.<br>위의 <b>새 게시물 만들기</b>를 눌러 첫 게시물을 만들어 보세요!'}</div>`}`;
}

// ---------- 반응 (인스타·페이스북·스레드): 좋아요·답글 수 + 답글 내용 ----------
const igOpen = new Set(); // 답글을 전부 펼친 '게시물:플랫폼'
const ago = (iso) => {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  return fmtDate(iso);
};
const nf = (n) => Number(n || 0).toLocaleString('ko-KR');
const who = (pf, name) => (pf === 'facebook' ? esc(name || 'Facebook 사용자') : `@${esc(name || '알 수 없음')}`);

function commentHtml(pf, c) {
  return `<div class="ig-comment"><span class="who">${who(pf, c.username)}</span>${esc(c.text)}<span class="when">${esc(ago(c.at))}${c.likes ? ` · ♡ ${nf(c.likes)}` : ''}</span>
    ${(c.replies || []).map((r) => `<div class="reply"><span class="who">${who(pf, r.username)}</span>${esc(r.text)}<span class="when">${esc(ago(r.at))}</span></div>`).join('')}</div>`;
}
// 좋아요·답글 칩 (모든 플랫폼 공통)
const countChips = (c) => `<span class="metric big">♡ 좋아요 <b>${c ? nf(c.likes) : '–'}</b></span><span class="metric big">💬 답글 <b>${c ? nf(c.comments) : '–'}</b></span>`;

// 한 플랫폼의 답글 목록 (show개까지 보이고 나머지는 펼치기)
function platformReplies(postId, pf, x, show = 3) {
  const key = `${postId}:${pf}`;
  const list = x.comments || [];
  const all = igOpen.has(key);
  if (x.error) return `<div class="ig-note">${esc(x.error)}</div>`;
  return `${x.errors?.counts ? `<div class="ig-note">숫자: ${esc(x.errors.counts)}</div>` : ''}
    ${x.errors?.comments ? `<div class="ig-note">답글: ${esc(x.errors.comments)}</div>`
      : list.length ? (all ? list : list.slice(0, show)).map((c) => commentHtml(pf, c)).join('') + (list.length > show ? `<button class="btn ghost" data-rc-more="${esc(key)}">${all ? '접기' : `답글 ${list.length - show}개 더 보기`}</button>` : '')
      : '<div class="hint" style="padding:6px 0">아직 답글이 없어요.</div>'}`;
}

function platformBlock(postId, pf, x, show) {
  const P = PF[pf];
  return `<div class="ig-comments">
    <div class="week-head" style="margin-bottom:4px;gap:6px;flex-wrap:wrap"><b style="font-size:14px">${P.icon} ${P.name}</b>
      <span class="ig-stats" style="margin:0">${countChips(x.counts)}${x.permalink || x.url ? `<a class="metric" href="${esc(x.permalink || x.url)}" target="_blank" rel="noopener">보기 ›</a>` : ''}</span></div>
    ${platformReplies(postId, pf, x, show)}</div>`;
}

async function renderInsta(refresh) {
  if (!refresh) loading('SNS에서 반응을 가져오는 중…');
  let d;
  try { d = await api('GET', `/api/stores/${state.storeId}/reactions${refresh ? '?refresh=1' : ''}`); }
  catch (err) { $app.innerHTML = `<h1>반응</h1><div class="card">${esc(err.message)}</div>`; return; }
  if (state.view !== 'insta') return;
  const items = d.items;
  let likes = 0, replies = 0;
  for (const it of items) for (const x of Object.values(it.platforms)) { likes += x.counts?.likes || 0; replies += x.counts?.comments || 0; }
  $app.innerHTML = `
    <div class="head-row"><div><h1>반응</h1><p class="lead" style="margin:0">인스타그램·페이스북·스레드에 올린 게시물의 좋아요와 답글</p></div>
      <button class="btn ghost" data-ig-refresh>🔄 새로고침</button></div>
    <button class="btn primary block" data-ai-feedback style="margin-bottom:12px">✨ 가게 전체 AI 피드백 · 모든 게시물 비교</button>
    <div class="ig-total" style="grid-template-columns:repeat(2,1fr)"><div><b>${nf(likes)}</b><span>좋아요</span></div><div><b>${nf(replies)}</b><span>답글</span></div></div>
    ${items.length ? items.map((x) => `<article class="card ig-item">
        <div class="ig-item-top">
          <div class="post-thumb">${x.cover ? `<img src="${esc(x.cover)}" alt="" />` : '<span>📝</span>'}</div>
          <div style="flex:1;min-width:0">
            <div class="post-top"><span class="post-title" style="margin:0">${esc(x.topic)}</span><span class="date">${esc(fmtDate(x.at))}</span></div>
            <div class="row" style="margin-top:8px"><button class="btn line sm" data-open="${x.postId}">게시물 관리</button><button class="btn line sm" data-post-feedback="${x.postId}">✨ 이 게시물 분석</button></div>
          </div>
        </div>
        ${PLATFORMS.filter((pf) => x.platforms[pf.id]).map((pf) => platformBlock(x.postId, pf.id, x.platforms[pf.id], 3)).join('')}
      </article>`).join('') : '<div class="card empty">아직 SNS에 올린 게시물이 없어요.<br>새 게시물을 만들어 올려 보세요.</div>'}
    <p class="hint" style="text-align:center">${esc(fmtDate(d.fetchedAt))} 기준</p>`;
  if (d.removed?.length) removedToast(d.removed);
}

$app.addEventListener('click', async (e) => {
  if (state.view !== 'insta') return;
  if (e.target.closest('[data-ai-feedback]')) return openFeedback();
  if (e.target.closest('[data-ig-refresh]')) { toast('새로 불러오는 중…'); await renderInsta(true); toast('최신 반응으로 바꿨어요.'); return; }
  const more = e.target.closest('[data-rc-more]');
  if (more) {
    const k = more.dataset.rcMore;
    igOpen.has(k) ? igOpen.delete(k) : igOpen.add(k);
    const y = window.scrollY; await renderInsta(); window.scrollTo(0, y);
  }
});

// ---------- AI 피드백: 세 SNS 반응을 모아 잘 된 스타일, 선플·악플, 다음 게시물 제안 ----------
async function openFeedback() {
  const m = modal('<div class="loading"><div class="spinner"></div>세 SNS의 반응과 댓글을 모아 AI가 분석하는 중…<br><span class="hint">게시물이 많으면 1분쯤 걸릴 수 있어요</span></div>');
  let d;
  try { d = await api('POST', `/api/stores/${state.storeId}/feedback`); }
  catch (err) { m.el.querySelector('.modal-box').innerHTML = `<div class="card">${esc(err.message)}</div><button class="btn line block" data-m="close">닫기</button>`; return; }
  if (!document.body.contains(m.el)) return; // 기다리는 동안 닫음
  const errs = Object.entries(d.errors || {});
  const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join('');
  m.el.querySelector('.modal-box').innerHTML = `
    <div class="week-head"><h2 style="margin:0">✨ 가게 전체 AI 피드백</h2><span class="hint">${d.source === 'mock' ? '예시 분석' : 'AI 분석'}</span></div>
    <p style="margin:8px 0 0">${esc(d.summary)}</p>
    ${d.fallbackReason ? `<div class="ig-note">AI 연결이 안 돼서 규칙으로 분석했어요.</div>` : ''}

    ${d.byStyle?.length ? `<div class="fact-title">🎨 스타일·편집 효과별 반응</div>
      <div class="fb-table">${d.byStyle.map((s, i) => `<div class="fb-row ${i === 0 ? 'best' : ''}"><span>${esc(s.name)}</span><span>게시물 ${s.count} · 평균 <b>${s.avg}</b>점</span></div>`).join('')}</div>
      <ul class="plain">${li(d.styleInsights || [])}</ul>` : ''}

    ${d.posts?.length ? `<div class="fact-title">🏆 반응 좋았던 게시물</div>
      <div class="fb-table">${d.posts.slice(0, 3).map((p) => `<button type="button" class="fb-row" data-fb-open="${p.postId}"><span>${esc(p.topic)}<br><span class="hint">${esc(p.style)} + ${esc(p.effect)} · ${esc(p.platforms.join(', '))}</span></span><span>♡ ${nf(p.total.likes)} · 💬 ${nf(p.total.comments)}<br><b>${p.score}</b>점</span></button>`).join('')}</div>` : ''}

    <div class="fact-title">😊 선플 (${d.positive.length})</div>
    ${d.positive.length ? d.positive.map((x) => `<div class="fb-cmt good">“${esc(x.text)}”<div class="hint">${esc(x.why)}</div></div>`).join('') : '<div class="hint">아직 눈에 띄는 칭찬 댓글이 없어요.</div>'}

    <div class="fact-title">😟 악플·아쉬운 점 (${d.negative.length})</div>
    ${d.negative.length ? d.negative.map((x) => `<div class="fb-cmt bad">“${esc(x.text)}”<div class="hint">${esc(x.why)}</div>${x.reply ? `<div class="fb-reply">💬 답글 예시: ${esc(x.reply)}</div>` : ''}</div>`).join('') : '<div class="hint">불만 댓글은 없었어요.</div>'}

    <div class="fact-title">📌 다음 게시물에 반영할 것</div>
    <ul class="plain">${li(d.suggestions || [])}</ul>

    <p class="hint" style="margin-top:12px">댓글 ${nf(d.commentCount)}개 · 게시물 ${d.posts.length}개 분석 · 반응 점수 = 좋아요 + 답글×2${errs.length ? `<br>못 가져온 곳: ${errs.map(([p, msg]) => `${esc(PLATFORMS.find((x) => x.id === p)?.name || p)} (${esc(msg)})`).join(', ')}` : ''}</p>
    <p class="hint" style="margin:8px 0 0">AI 분석은 참고용이에요. 답글 예시는 내용을 확인하고 다듬어서 달아 주세요.</p>
    <div class="row"><button class="btn primary" data-go-new>이 제안으로 새 게시물 만들기</button><button class="btn line" data-m="close">닫기</button></div>`;
  m.el.addEventListener('click', (e) => {
    const open = e.target.closest('[data-fb-open]');
    if (open) { m.close(); setView('post', { postId: open.dataset.fbOpen }); }
    if (e.target.closest('[data-go-new]')) {
      m.close();
      state.newDraft.detail = (d.suggestions || []).slice(0, 2).join(' / ');
      setView('new');
    }
  });
}

// ---------- 손님 관리(CRM): 세 SNS에 댓글을 단 사람 ----------
const SEGMENTS = ['전체', '단골', '신규', '관심', '휴면'];
const custLabel = (c) => (c.platform === 'facebook' ? c.handle : `@${c.handle}`);

async function renderCustomers() {
  const list = await api('GET', `/api/stores/${state.storeId}/customers`);
  if (state.view !== 'customers') return;
  const f = state.custFilter || '전체';
  const shown = f === '전체' ? list : list.filter((c) => c.segment === f);
  const count = (s) => (s === '전체' ? list.length : list.filter((c) => c.segment === s).length);
  $app.innerHTML = `
    <div class="head-row"><div><h1>손님</h1><p class="lead" style="margin:0">인스타·페이스북·스레드에 댓글을 단 손님을 모아 보여 드려요</p></div></div>
    <button class="btn primary block big-new" data-cust="sync">🔄 댓글 불러오기</button>
    <div class="chips filter">${SEGMENTS.map((s) => `<button class="chip ${f === s ? 'on' : ''}" data-cust-filter="${s}">${s} ${count(s)}</button>`).join('')}</div>
    ${shown.length ? shown.map((c) => `
      <button type="button" class="card cust" data-cust-open="${c.id}">
        <div class="cust-av ${c.platform}">${esc(c.handle.slice(0, 1).toUpperCase())}</div>
        <div class="cust-main">
          <div class="cust-top"><span class="cust-name">${esc(custLabel(c))}</span><span class="seg ${c.segment}">${c.segment}</span></div>
          <div class="cust-last">${esc(c.lastText)}</div>
          <div class="cust-meta"><span>${PF[c.platform]?.name || ''}</span><span>댓글 ${c.count}</span><span>댓글 좋아요 ${c.likes}</span><span>최근 ${fmtDate(c.lastSeen)}</span>${c.memo ? '<span>📝 메모</span>' : ''}</div>
        </div>
      </button>`).join('') : `<div class="empty">${list.length ? '이 무리에 해당하는 손님이 없어요.' : '아직 모은 손님이 없어요.<br>게시물을 SNS에 올린 뒤 "댓글 불러오기"를 눌러 보세요.'}</div>`}
    <p class="hint" style="margin-top:12px">단골: 댓글 3번 이상 · 신규: 처음 본 지 14일 이내 · 휴면: 30일 넘게 반응 없음. 좋아요만 누른 사람은 SNS가 알려 주지 않아 목록에 없어요.</p>`;
}

async function syncCustomers(btn) {
  btn.disabled = true;
  btn.textContent = '댓글 불러오는 중…';
  try {
    const r = await api('POST', `/api/stores/${state.storeId}/customers/sync`);
    await renderCustomers();
    toast(r.checked ? `새 댓글 ${r.added}개를 불러왔어요.` : '아직 SNS에 올린 게시물이 없어요.');
    const errs = Object.entries(r.errors || {});
    if (errs.length) alertBox(`일부 SNS에서 댓글을 못 불러왔어요.\n\n${errs.map(([p, m]) => `· ${PF[p]?.name || p}: ${m}`).join('\n')}`);
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = '🔄 댓글 불러오기';
  }
}

async function openCustomer(id) {
  const c = await api('GET', `/api/customers/${id}`);
  modal(`
    <div class="week-head"><h2 style="margin:0">${esc(custLabel(c))}</h2><span class="seg ${c.segment}">${c.segment}</span></div>
    <div class="cust-meta" style="margin:6px 0 10px"><span>${PF[c.platform]?.name || ''}</span><span>처음 ${fmtDate(c.firstSeen)}</span><span>최근 ${fmtDate(c.lastSeen)}</span><span>댓글 ${c.count}</span><span>댓글 좋아요 ${c.likes}</span></div>
    <label style="margin-top:0">사장님 메모 <span class="hint">(나만 보여요 · 예: 주말마다 오는 대학생)</span></label>
    <textarea id="custMemo" maxlength="1000">${esc(c.memo)}</textarea>
    <div class="fact-title">남긴 댓글</div>
    <div>${c.activities.map((a) => `<div class="act"><div class="act-head"><span>${esc(a.postTopic)} · ${PF[a.platform]?.name || ''}</span><span>${fmtDate(a.at)}${a.likes ? ` · ♥ ${a.likes}` : ''}</span></div>${esc(a.text)}</div>`).join('')}</div>
    <div class="row"><button class="btn primary" data-m="save">메모 저장</button><button class="btn line" data-m="close">닫기</button></div>
    <div class="row"><button class="btn ghost" data-m="forget">🗑 이 손님 정보 지우기</button></div>`,
    async (e, close) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      try {
        if (b.dataset.m === 'save') {
          await api('PUT', `/api/customers/${c.id}`, { memo: document.getElementById('custMemo').value });
          close();
          toast('메모를 저장했어요.');
          renderCustomers();
        }
        if (b.dataset.m === 'forget') {
          close();
          if (!(await confirmBox(`${esc(custLabel(c))} 손님의 정보와 댓글 기록을 지울까요? 다음에 댓글을 불러와도 다시 넣지 않아요.`, '지우기'))) return;
          await api('DELETE', `/api/customers/${c.id}`);
          toast('손님 정보를 지웠어요.');
          renderCustomers();
        }
      } catch (err) { toast(err.message); }
    });
}

// ---------- 게시물 하나 AI 분석: SNS별 반응, 이 게시물 댓글, 가게 평균과 비교 ----------
$app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-post-feedback]');
  if (b) openPostFeedback(b.dataset.postFeedback);
});
async function openPostFeedback(postId) {
  const m = modal('<div class="loading"><div class="spinner"></div>이 게시물의 반응과 댓글을 AI가 분석하는 중…</div>');
  let d;
  try { d = await api('POST', `/api/posts/${postId}/feedback`); }
  catch (err) { m.el.querySelector('.modal-box').innerHTML = `<div class="card">${esc(err.message)}</div><button class="btn line block" data-m="close">닫기</button>`; return; }
  if (!document.body.contains(m.el)) return;
  const li = (arr) => (arr || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const p = d.post;
  const tone = d.verdict === '평균보다 좋아요' ? 'best' : '';
  m.el.querySelector('.modal-box').innerHTML = `
    <div class="week-head"><h2 style="margin:0">✨ 게시물 분석</h2><span class="hint">${d.source === 'mock' ? '예시 분석' : 'AI 분석'}</span></div>
    <div class="post-title" style="margin:6px 0 2px">${esc(p.topic)}</div>
    <div class="hint">${esc(p.style)} + ${esc(p.effect)} · ${esc(fmtDate(p.at))}</div>
    <div class="fb-table" style="margin-top:10px">
      <div class="fb-row ${tone}"><span><b>${esc(d.verdict)}</b>${d.totalPosts > 1 ? `<br><span class="hint">가게 게시물 ${d.totalPosts}개 중 ${d.rank}위 · 다른 게시물 평균 ${d.avg}점</span>` : ''}</span><span><b>${p.score}</b>점</span></div>
      ${Object.entries(p.byPlatform).map(([n, v]) => `<div class="fb-row"><span>${esc(n)}</span><span>♡ ${nf(v.likes)} · 💬 ${nf(v.comments)}</span></div>`).join('')}
    </div>
    <p style="margin:10px 0 0">${esc(d.summary)}</p>
    ${d.fallbackReason ? '<div class="ig-note">AI 연결이 안 돼서 규칙으로 분석했어요.</div>' : ''}
    <div class="fact-title">👍 잘된 점</div><ul class="plain">${li(d.good)}</ul>
    <div class="fact-title">🔧 아쉬운 점</div><ul class="plain">${li(d.improve)}</ul>
    <div class="fact-title">😊 선플 (${d.positive.length})</div>
    ${d.positive.length ? d.positive.map((x) => `<div class="fb-cmt good">“${esc(x.text)}”<div class="hint">${esc(x.why)}</div></div>`).join('') : '<div class="hint">이 게시물엔 눈에 띄는 칭찬 댓글이 없어요.</div>'}
    <div class="fact-title">😟 악플·아쉬운 점 (${d.negative.length})</div>
    ${d.negative.length ? d.negative.map((x) => `<div class="fb-cmt bad">“${esc(x.text)}”<div class="hint">${esc(x.why)}</div>${x.reply ? `<div class="fb-reply">💬 답글 예시: ${esc(x.reply)}</div>` : ''}</div>`).join('') : '<div class="hint">불만 댓글은 없었어요.</div>'}
    <div class="fact-title">📌 다음에 비슷한 게시물을 올린다면</div><ul class="plain">${li(d.nextTime)}</ul>
    <p class="hint" style="margin:8px 0 0">AI 분석은 참고용이에요. 답글 예시는 내용을 확인하고 다듬어서 달아 주세요.</p>
    <p class="hint" style="margin-top:12px">이 게시물 댓글 ${nf(d.commentCount)}개 분석 · 반응 점수 = 좋아요 + 답글×2${Object.keys(d.errors || {}).length ? `<br>못 가져온 곳: ${Object.entries(d.errors).map(([k, v]) => `${esc(PF[k]?.name || k)} (${esc(v)})`).join(', ')}` : ''}</p>
    <div class="row"><button class="btn line" data-m="close">닫기</button></div>`;
}

// ---------- 새 게시물: 1단계 입력 ----------
const TONE_DEFAULT = ['친근하게', '깔끔하게 정보 위주로', '이벤트 느낌으로', '감성적으로', '고급스럽게'];

function renderNew() {
  const d = state.newDraft;
  const store = state.store;
  const products = (store?.products || []).filter((p) => p.name);
  const tones = state.tones.length ? state.tones : TONE_DEFAULT;
  $app.innerHTML = `
    <h1>새 게시물</h1>
    <p class="lead">무엇을 홍보할지 알려 주시면, AI가 문구와 홍보 이미지를 만들어 드려요.</p>
    <div class="card">
      <label style="margin-top:0">무엇을 홍보할까요? <span class="req">*</span></label>
      ${products.length ? `<div class="chips" id="productChips">${products.map((p) => `<button class="chip ${d.topic === p.name ? 'on' : ''}" data-topic="${esc(p.name)}">${esc(p.name)}</button>`).join('')}</div>` : ''}
      <input id="topic" value="${esc(d.topic)}" placeholder="직접 적기 (예: 새로 들어온 딸기라떼)" style="margin-top:10px" />
      <button class="btn ghost" data-action="ideas">💡 뭘 올릴지 모르겠어요 · AI 추천 받기</button>
      <div id="ideas"></div>

      <label>강조하고 싶은 내용 <span class="hint">(선택 · 할인, 기간, 특징 등)</span></label>
      <textarea id="detail" placeholder="예: 이번 주말까지 10% 할인, 새로 바꾼 의자가 정말 편해요">${esc(d.detail)}</textarea>

      <label>분위기</label>
      <div class="chips" id="toneChips">${tones.map((t) => `<button class="chip ${d.tone === t ? 'on' : ''}" data-tone="${esc(t)}">${esc(t)}</button>`).join('')}</div>

      <label>카드 스타일 <span class="hint">(글자 배치)</span></label>
      <div class="chips" id="layoutChips">${Object.entries(Imaging.LAYOUT_NAMES).map(([k, l]) => `<button type="button" class="chip ${d.layout === k ? 'on' : ''}" data-layout="${k}" aria-pressed="${d.layout === k}">${esc(l)}</button>`).join('')}</div>
      <label>편집 효과</label>
      <div class="chips" id="effectChips">${Object.entries(Imaging.EFFECT_NAMES).map(([k, l]) => `<button type="button" class="chip ${d.effect === k ? 'on' : ''}" data-effect="${k}" aria-pressed="${d.effect === k}">${esc(l)}</button>`).join('')}</div>
      <p class="hint" style="margin:6px 0 0">AI가 이 스타일·효과에 맞는 카드 문구 5개를 만들어 보여 드려요. 그중 하나를 고르면 돼요.</p>

      <label>참고 사진 <span class="hint">(선택 · 최대 10장 · 카드는 사진이 있어야 스타일이 적용돼요)</span></label>
      <div class="thumbs" id="refThumbs">${d.files.map((f, i) => `<div class="thumb"><img src="${URL.createObjectURL(f)}" alt="" /><button class="thumb-del" data-del-ref="${i}" aria-label="삭제">×</button></div>`).join('')}</div>
      <div class="row">
        <button class="btn line" data-action="ref-camera">📸 카메라로 찍기</button>
        <button class="btn line" data-action="ref-pick">🖼 사진 고르기</button>
      </div>
      <div class="row"><button class="btn primary block" data-action="create">✨ AI로 게시물 만들기</button></div>
    </div>`;
}

function syncNewDraft() {
  const t = document.getElementById('topic');
  const dd = document.getElementById('detail');
  if (t) state.newDraft.topic = t.value;
  if (dd) state.newDraft.detail = dd.value;
}

async function createPost() {
  syncNewDraft();
  const d = state.newDraft;
  if (!d.topic.trim()) return toast('무엇을 홍보할지 골라 주시거나 적어 주세요.');
  const steps = ['게시물 만들기', `참고 사진 올리기 (${d.files.length}장)`, 'AI가 문구 쓰기', '사진 보정하기', '홍보 카드 만들기'];
  loading('AI가 게시물을 만들고 있어요…', steps);
  document.querySelector('[data-step="0"]')?.classList.add('now');
  try {
    let post = await api('POST', `/api/stores/${state.storeId}/posts`, { topic: d.topic, detail: d.detail, tone: d.tone, layout: d.layout, effect: d.effect });
    stepDone(0);
    for (const f of d.files) {
      const c = await Imaging.fitInsta(f);
      post = await uploadImage(post.id, await Imaging.toJpeg(c), { kind: 'reference' });
    }
    stepDone(1);
    post = await api('POST', `/api/posts/${post.id}/generate`);
    stepDone(2);
    const refs = post.images.filter((i) => i.kind === 'reference');
    const enhancedBlobs = [];
    for (const r of refs) enhancedBlobs.push({ ref: r, blob: await Imaging.toJpeg(await Imaging.enhance(imgUrl(r), 'auto')) });
    stepDone(3);
    // 표지: 고른 스타일·편집 효과로 AI 카드 문구 5개를 그려 보여 주고, 고른 것으로 홍보 카드(슬라이드는 2장) → 그다음 보정 사진들
    const combo = enhancedBlobs.length ? { layout: d.layout, effect: d.effect } : { layout: 'text', effect: 'none' };
    const base = { storeName: state.store.name, category: state.store.category };
    const photos = enhancedBlobs.map((e) => e.blob);
    const options = post.cardOptions?.length ? post.cardOptions : [{ headline: post.headline || d.topic, subline: post.subline, tag: post.tag }];
    const text = { ...base, ...(await pickCardText(options, combo, base, photos)) };
    post = await api('PUT', `/api/posts/${post.id}`, { headline: text.headline, subline: text.subline, tag: text.tag });
    loading('홍보 카드를 만들고 있어요…', steps);
    for (let i = 0; i < 4; i++) stepDone(i);
    const cards = await renderCombo(combo, text, photos);
    for (const card of cards) post = await uploadImage(post.id, await Imaging.toJpeg(card), { kind: 'card', source: enhancedBlobs[0]?.ref.id, label: `${combo.layout}+${combo.effect}`, select: true });
    for (const e of enhancedBlobs) post = await uploadImage(post.id, e.blob, { kind: 'enhanced', source: e.ref.id, label: 'auto', select: true });
    stepDone(4);
    // 연결된 플랫폼을 기본으로 체크
    const pfs = PLATFORMS.filter((p) => state.connections[p.id]?.connected).map((p) => p.id);
    post = await api('PUT', `/api/posts/${post.id}`, { platforms: pfs });
    state.newDraft = { topic: '', detail: '', tone: d.tone, layout: d.layout, effect: d.effect, files: [] };
    setView('post', { postId: post.id, post, capTab: 'instagram' });
  } catch (err) {
    toast(err.message);
    renderNew();
  }
}

// ---------- 카드 문구 고르기 (고른 스타일·효과로 AI 문구 5개 미리보기) ----------
const comboName = (c) => c.layout === 'text' ? '글자만' : `${Imaging.LAYOUT_NAMES[c.layout]} + ${Imaging.EFFECT_NAMES[c.effect]}`;
function renderCombo(c, text, photos) {
  return c.layout === 'slide'
    ? Imaging.makeSlides({ photos, effect: c.effect, ...text })
    : Imaging.makeCard({ photo: photos[0] || null, template: c.layout, effect: c.effect, ...text }).then((x) => [x]);
}
// 화면 크기 미리보기 이미지 (원본 1080px 대신 작은 그림)
function thumbUrl(canvas) {
  const t = document.createElement('canvas');
  t.width = 360; t.height = Math.round((360 * canvas.height) / canvas.width);
  t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.85);
}
function pickCardText(options, combo, base, photos) {
  return new Promise((resolve) => {
    let sel = 0;
    $app.innerHTML = `
      <h1>카드 문구 고르기</h1>
      <p class="lead">${esc(comboName(combo))} 스타일로 AI가 쓴 문구 ${options.length}개예요. 마음에 드는 걸 골라 주세요. 고른 뒤에도 글자는 고칠 수 있어요.</p>
      <div class="pick-grid">${options.map((o, i) => `<button type="button" class="pick ${i === 0 ? 'on' : ''}" data-pick="${i}" aria-pressed="${i === 0}"><div class="pick-img"><div class="spinner"></div></div><span>${esc(o.headline)}</span></button>`).join('')}</div>
      <div class="row"><button class="btn primary block" data-pk="ok">이 문구로 만들기</button></div>`;
    const onClick = (e) => {
      const b = e.target.closest('[data-pick],[data-pk]');
      if (!b) return;
      if (b.dataset.pick) {
        sel = Number(b.dataset.pick);
        $app.querySelectorAll('[data-pick]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
      } else {
        $app.removeEventListener('click', onClick);
        resolve(options[sel]);
      }
    };
    $app.addEventListener('click', onClick);
    window.scrollTo(0, 0);
    (async () => {
      for (const [i, o] of options.entries()) {
        const cards = await renderCombo(combo, { ...base, ...o }, photos);
        const box = $app.querySelector(`[data-pick="${i}"] .pick-img`);
        if (box) box.innerHTML = `<img src="${thumbUrl(cards[0])}" alt="${esc(o.headline)} 카드 미리보기" />${cards.length > 1 ? `<i class="pick-badge">${cards.length}장</i>` : ''}`;
      }
    })();
  });
}

// ---------- 게시물 화면: 미리보기·편집·게시·관리 ----------
let saveTimer = null;
async function saveCaptions() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!state.post) return;
  const captions = {};
  document.querySelectorAll('[data-cap]').forEach((t) => (captions[t.dataset.cap] = t.value));
  if (!Object.keys(captions).length) return;
  Object.assign(state.post.captions, captions);
  await api('PUT', `/api/posts/${state.post.id}`, { captions });
}
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCaptions().catch(() => {}), 700);
}

function selectedImages(post) {
  return post.selectedImageIds.map((id) => post.images.find((i) => i.id === id)).filter(Boolean);
}

function previewHtml(post, pfId) {
  const imgs = selectedImages(post);
  const text = post.captions?.[pfId] || '';
  const name = state.store?.name || '우리 가게';
  const avatar = `<div class="pv-avatar">${esc(name.slice(0, 1))}</div>`;
  const imgBlock = imgs.length
    ? `<div class="pv-img"><img src="${imgUrl(imgs[0])}" alt="" />${imgs.length > 1 ? `<span class="pv-count">1/${imgs.length}</span>` : ''}</div>`
    : '';
  const cap = `<div class="pv-text">${esc(text)}</div>`;
  if (pfId === 'instagram') {
    return `<div class="pv pv-ig"><div class="pv-head">${avatar}<b>${esc(name)}</b></div>${imgBlock || '<div class="pv-noimg">인스타그램은 사진이 꼭 필요해요</div>'}<div class="pv-icons">♡ 💬 ➤</div><div class="pv-text"><b>${esc(name)}</b> ${esc(text)}</div></div>`;
  }
  if (pfId === 'threads') {
    return `<div class="pv pv-th"><div class="pv-head">${avatar}<b>${esc(name)}</b></div>${cap}${imgBlock}</div>`;
  }
  return `<div class="pv pv-fb"><div class="pv-head">${avatar}<div><b>${esc(name)}</b><div class="hint">방금 전 · 🌐</div></div></div>${cap}${imgBlock}<div class="pv-icons">👍 좋아요 · 💬 댓글 · ↗ 공유</div></div>`;
}

function publicationsHtml(post) {
  const entries = PLATFORMS.filter((pf) => post.publications?.[pf.id]);
  if (!entries.length) return '';
  return `
  <div class="card">
    <div class="week-head"><h2 style="margin:0">게시 현황</h2><button class="btn ghost" data-action="metrics">🔄 반응 새로고침</button></div>
    ${entries.map((pf) => {
      const p = post.publications[pf.id];
      const metrics = ''; // 좋아요·답글은 아래 플랫폼별 칸에서 보여줌
      return `<div class="pub-row">
        <div class="pub-main">
          <div><b>${pf.icon} ${pf.name}</b> <span class="status-badge ${p.status}">${p.status === 'published' ? '게시됨' : p.status === 'failed' ? '실패' : '삭제됨'}</span></div>
          <div class="hint">${fmtDate(p.at)}${p.status === 'failed' ? ` · ${esc(p.error)}` : ''}${p.status === 'deleted' && p.deletedBy === 'sns' ? ` · ${pf.name} 앱에서 지워졌어요` : ''}</div>
          ${metrics ? `<div class="metrics">${metrics}</div>` : ''}
        </div>
        <div class="pub-acts">
          ${p.status === 'published' && p.url ? `<a class="btn line sm" href="${esc(p.url)}" target="_blank" rel="noopener">보기</a>` : ''}
          ${p.status === 'published' ? (pf.id !== 'instagram' || state.connections?.instagram?.canDelete ? `<button class="btn line sm" data-del-pub="${pf.id}">삭제</button>` : '') : `<button class="btn line sm" data-reset-pub="${pf.id}">다시 올리기</button>`}
        </div>
      </div>`;
    }).join('')}
    ${Object.values(post.publications || {}).some((p) => p.status === 'published') ? '<div id="igc"><div class="hint" style="padding-top:8px">좋아요와 답글을 불러오는 중…</div></div>' : ''}
    <p class="hint" style="margin:8px 0 0">SNS 앱에서 직접 지워도 여기에 자동으로 반영돼요.</p>
  </div>`;
}

function renderPostView() {
  setTimeout(() => loadPostComments(false), 0);
  return renderPostViewInner();
}
function renderPostViewInner() {
  const post = state.post;
  const conn = state.connections || {};
  const imgs = post.images;
  const sel = post.selectedImageIds;
  const hasPhoto = sel.length > 0;
  const tab = state.capTab;
  const pending = PLATFORMS.filter((pf) => post.publications?.[pf.id]?.status !== 'published');

  $app.innerHTML = `
    <button class="btn ghost back" data-go="posts">← 내 게시물</button>
    <h1>${post.status === 'draft' ? '이렇게 올릴까요?' : esc(post.topic)}</h1>
    <p class="lead">${post.status === 'draft' ? `<b>${esc(post.topic)}</b> 게시물을 만들었어요. 사진과 문구를 확인하고 올릴 곳을 골라 주세요.` : `${fmtDate(post.createdAt)} 만든 게시물`}</p>
    ${post.source === 'mock' ? `<div class="card notice">※ ${post.fallbackReason ? 'AI 연결에 실패해 예시 문구로 만들었어요.' : '데모 모드 예시 문구예요. API 키를 넣으면 AI가 써요.'}</div>` : ''}

    ${publicationsHtml(post)}

    <div class="card">
      <h2 style="margin-top:0">미리보기</h2>
      <div class="tabs">${PLATFORMS.map((pf) => `<button class="tab ${tab === pf.id ? 'on' : ''}" data-tab="${pf.id}">${pf.icon} ${pf.name}</button>`).join('')}</div>
      <div id="preview">${previewHtml(post, tab)}</div>
    </div>

    <div class="card">
      <div class="week-head"><h2 style="margin:0">📷 사진</h2><span class="hint">눌러서 넣기/빼기 · 번호 순서대로 올라가요</span></div>
      <div class="thumbs big">${imgs.length ? imgs.map((im) => {
        const n = sel.indexOf(im.id);
        return `<div class="thumb ${n >= 0 ? 'sel' : ''}" data-toggle="${im.id}">
          <img src="${imgUrl(im)}" alt="" />
          <span class="kind">${KIND_LABEL[im.kind] || ''}</span>
          ${n >= 0 ? `<span class="num">${n + 1}</span>` : ''}
          <button class="thumb-more" data-tools="${im.id}" aria-label="사진 꾸미기">⋯</button>
        </div>`;
      }).join('') : '<p class="hint">아직 사진이 없어요.</p>'}</div>
      <div class="row">
        <button class="btn line" data-action="add-camera">📸 찍기</button>
        <button class="btn line" data-action="add-pick">🖼 사진 추가</button>
      </div>
      <div class="row">
        <button class="btn line" data-action="card">🎨 홍보 카드 만들기</button>
        <button class="btn line" data-action="ai-generate">✨ AI 이미지 그리기</button>
      </div>
    </div>

    <div class="card">
      <div class="week-head"><h2 style="margin:0">✍ 문구</h2><button class="btn ghost" data-action="regen">AI로 다시 쓰기</button></div>
      <div class="tabs">${PLATFORMS.map((pf) => `<button class="tab ${tab === pf.id ? 'on' : ''}" data-tab="${pf.id}">${pf.icon} ${pf.name}</button>`).join('')}</div>
      ${PLATFORMS.map((pf) => `<div class="${tab === pf.id ? '' : 'hidden'}">
        <textarea class="cap" data-cap="${pf.id}">${esc(post.captions?.[pf.id] || '')}</textarea>
        <div class="count" data-count="${pf.id}">${(post.captions?.[pf.id] || '').length} / ${pf.limit}자</div>
      </div>`).join('')}
      ${post.checklist?.length ? `<div class="checklist"><div class="fact-title need">올리기 전에 확인하세요</div><ul class="plain">${post.checklist.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      <div class="row"><button class="btn line" data-action="copy">📋 지금 탭 문구 복사</button></div>
    </div>

    ${pending.length ? `
    <div class="card publish-card">
      <h2 style="margin-top:0">🚀 어디에 올릴까요?</h2>
      <div class="platforms">
        ${pending.map((pf) => {
          const connected = conn[pf.id]?.connected;
          const blocked = pf.needPhoto && !hasPhoto;
          const checked = connected && !blocked && (post.platforms || []).includes(pf.id);
          return `<label class="pf ${connected && !blocked ? '' : 'off'}">
            <input type="checkbox" data-pf="${pf.id}" ${checked ? 'checked' : ''} ${connected && !blocked ? '' : 'disabled'} />
            <span class="pf-name">${pf.icon} ${pf.name}</span>
            <span class="pf-state ${connected ? 'on' : ''}">${!connected ? '연결 안 됨' : blocked ? '사진 필요' : '연결됨'}</span>
          </label>`;
        }).join('')}
      </div>
      <div class="row"><button class="btn ok block" data-action="publish">선택한 곳에 동시에 올리기</button></div>
      <div class="row" style="margin-top:6px">
        <button class="btn line" data-action="save">임시저장</button>
        <button class="btn ghost" data-go="channels">계정 연결하기</button>
      </div>
    </div>` : ''}

    <div class="row"><button class="btn ghost" data-action="remove">이 게시물을 목록에서 지우기</button></div>`;
}

async function openPost(postId) {
  loading('불러오는 중…');
  state.post = await api('GET', `/api/posts/${postId}`);
  state.postId = postId;
  renderPostView();
  snsSync(true);
}

// 게시물 화면의 '게시 현황' 아래에 플랫폼별 좋아요·답글과 답글 목록 채우기
let igcData = null;
async function loadPostComments(force) {
  const box = document.getElementById('igc');
  if (!box || !state.post) return;
  const id = state.post.id;
  if (force || !igcData || igcData.postId !== id) {
    try { igcData = { postId: id, ...(await api('GET', `/api/posts/${id}/reactions${force ? '?refresh=1' : ''}`)) }; }
    catch (err) { box.innerHTML = `<div class="ig-note">답글을 불러오지 못했어요: ${esc(err.message)}</div>`; return; }
    if (igcData.removed?.length) { removedToast(igcData.removed); igcData.removed = []; state.post = igcData.post; return renderPostView(); }
  }
  const el = document.getElementById('igc');
  if (!el || state.post?.id !== id) return;
  const blocks = PLATFORMS.filter((pf) => igcData.platforms?.[pf.id]).map((pf) => platformBlock(id, pf.id, igcData.platforms[pf.id], 5)).join('');
  el.innerHTML = blocks + (blocks ? `<button class="btn line block" data-post-feedback="${id}" style="margin-top:8px">✨ 이 게시물 AI 분석</button>` : '');
}
$app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rc-more]');
  if (!b || state.view !== 'post') return;
  const k = b.dataset.rcMore;
  igOpen.has(k) ? igOpen.delete(k) : igOpen.add(k);
  loadPostComments();
});

async function refreshPost(post) {
  if (post) state.post = post;
  else state.post = await api('GET', `/api/posts/${state.postId}`);
  const y = window.scrollY;
  renderPostView();
  window.scrollTo(0, y);
}

// 사진 꾸미기 메뉴
function openTools(imgId) {
  const im = state.post.images.find((i) => i.id === imgId);
  if (!im) return;
  const base = im.kind === 'enhanced' || im.kind === 'card' ? state.post.images.find((i) => i.id === im.sourceId) || im : im;
  modal(`
    <img src="${imgUrl(im)}" alt="" class="tool-preview" />
    <div class="fact-title">사진 보정 <span class="hint">(원본 기준으로 새 사진이 추가돼요)</span></div>
    <div class="chips">${Object.entries(Imaging.PRESETS).map(([k, p]) => `<button class="chip" data-preset="${k}">${p.label}</button>`).join('')}
      <button class="chip" data-ai-enhance="1">✨ AI 보정</button></div>
    <div class="fact-title">이 사진으로 홍보 카드</div>
    <div class="chips">${Object.entries(Imaging.TEMPLATES).filter(([k]) => k !== 'text').map(([k, l]) => `<button class="chip" data-card-tpl="${k}">${l}</button>`).join('')}</div>
    <div class="row"><button class="btn line" data-m="close">닫기</button><button class="btn ghost" data-del-img="1">🗑 이 사진 지우기</button></div>`,
    async (e, close) => {
      const t = e.target.closest('[data-preset],[data-ai-enhance],[data-card-tpl],[data-del-img]');
      if (!t) return;
      close();
      try {
        await saveCaptions();
        if (t.dataset.preset) {
          toast('보정하는 중…');
          const blob = await Imaging.toJpeg(await Imaging.enhance(imgUrl(base), t.dataset.preset));
          await refreshPost(await uploadImage(state.post.id, blob, { kind: 'enhanced', source: base.id, label: t.dataset.preset, select: true }));
          toast(`${Imaging.PRESETS[t.dataset.preset].label} 사진을 추가했어요.`);
        } else if (t.dataset.aiEnhance) {
          await aiImage('enhance', base.id);
        } else if (t.dataset.cardTpl) {
          await openCardMaker(im.kind === 'card' ? base : im, t.dataset.cardTpl);
        } else if (t.dataset.delImg) {
          await refreshPost(await api('DELETE', `/api/posts/${state.post.id}/images/${im.id}`));
        }
      } catch (err) { toast(err.message); }
    });
}

async function openCardMaker(photoImg, template) {
  const post = state.post;
  const photo = photoImg || selectedImages(post).find((i) => i.kind !== 'card') || post.images.find((i) => i.kind !== 'card');
  let tpl = template || (!photo ? 'text' : Imaging.TEMPLATES[post.layout] ? post.layout : 'magazine');
  let effect = photo && Imaging.EFFECT_NAMES[post.effect] ? post.effect : 'none';
  const m = modal(`
    <div class="fact-title" style="margin-top:0">🎨 홍보 카드 만들기</div>
    <canvas id="cardCanvas" class="tool-preview"></canvas>
    <label>큰 제목</label><input id="cardHead" value="${esc(post.headline || post.topic)}" maxlength="20" />
    <label>작은 글</label><input id="cardSub" value="${esc(post.subline || '')}" maxlength="30" />
    <label>스타일</label>
    <div class="chips">${Object.entries(Imaging.TEMPLATES).map(([k, l]) => `<button class="chip ${k === tpl ? 'on' : ''}" data-tpl="${k}" ${!photo && k !== 'text' ? 'disabled' : ''}>${l}</button>`).join('')}</div>
    <label>편집 효과</label>
    <div class="chips">${Object.entries(Imaging.EFFECT_NAMES).map(([k, l]) => `<button class="chip ${k === effect ? 'on' : ''}" data-fx="${k}" ${!photo ? 'disabled' : ''}>${l}</button>`).join('')}</div>
    <div class="chips">${['#e8590c', '#2f9e44', '#1c7ed6', '#c2255c', '#343a40'].map((c) => `<button class="swatch" data-color="${c}" style="background:${c}" aria-label="색상"></button>`).join('')}</div>
    <div class="row"><button class="btn primary" data-m="add">카드 추가하기</button><button class="btn line" data-m="close">취소</button></div>`,
    async (e, close) => {
      const tb = e.target.closest('[data-tpl]');
      const cb = e.target.closest('[data-color]');
      const fb = e.target.closest('[data-fx]');
      if (fb && !fb.disabled) { effect = fb.dataset.fx; m.el.querySelectorAll('[data-fx]').forEach((b) => b.classList.toggle('on', b === fb)); draw(); }
      if (tb && !tb.disabled) { tpl = tb.dataset.tpl; m.el.querySelectorAll('[data-tpl]').forEach((b) => b.classList.toggle('on', b === tb)); draw(); }
      if (cb) { color = cb.dataset.color; draw(); }
      if (e.target.closest('[data-m=add]')) {
        const canvas = await build();
        close();
        try {
          const headline = m.el.querySelector('#cardHead').value;
          const subline = m.el.querySelector('#cardSub').value;
          await api('PUT', `/api/posts/${post.id}`, {});
          let p = await uploadImage(post.id, await Imaging.toJpeg(canvas), { kind: 'card', source: photo?.id, label: `${tpl}+${effect}`, select: true });
          // 새 카드를 표지(1번)로
          const ids = [p.images[p.images.length - 1].id, ...p.selectedImageIds.filter((x) => x !== p.images[p.images.length - 1].id)];
          p = await api('PUT', `/api/posts/${post.id}`, { selectedImageIds: ids });
          Object.assign(p, { headline, subline });
          await refreshPost(p);
          toast('홍보 카드를 표지로 넣었어요.');
        } catch (err) { toast(err.message); }
      }
    });
  let color = '#e8590c';
  const build = () => Imaging.makeCard({
    photo: photo ? imgUrl(photo) : null,
    headline: m.el.querySelector('#cardHead').value,
    subline: m.el.querySelector('#cardSub').value,
    storeName: state.store?.name || '',
    category: state.store?.category || '',
    tag: post.tag || '',
    template: tpl,
    effect,
    color,
  });
  const draw = async () => {
    const c = await build();
    const out = m.el.querySelector('#cardCanvas');
    out.width = c.width; out.height = c.height;
    out.getContext('2d').drawImage(c, 0, 0);
  };
  m.el.querySelectorAll('#cardHead,#cardSub').forEach((i) => i.addEventListener('input', draw));
  draw();
}

async function aiImage(mode, imageId) {
  toast(mode === 'enhance' ? 'AI가 사진을 보정하는 중… (최대 30초)' : 'AI가 이미지를 그리는 중… (최대 30초)');
  try {
    const r = await api('POST', `/api/posts/${state.post.id}/ai-image`, { mode, imageId });
    const blob = await (await fetch(`data:${r.mime};base64,${r.data}`)).blob();
    const jpeg = await Imaging.toJpeg(await Imaging.fitInsta(blob));
    await refreshPost(await uploadImage(state.post.id, jpeg, { kind: 'ai', source: imageId, label: mode, select: true }));
    toast('AI 이미지를 추가했어요.');
  } catch (err) {
    alertBox(err.message);
  }
}

async function publishNow() {
  await saveCaptions();
  const post = state.post;
  const chosen = [...document.querySelectorAll('[data-pf]:checked')].map((c) => c.dataset.pf);
  if (!chosen.length) return toast('올릴 곳을 하나 이상 골라 주세요. 연결이 안 되어 있으면 계정 연결부터 해 주세요.');
  await api('PUT', `/api/posts/${post.id}`, { platforms: chosen });
  const imgs = selectedImages(post);
  const over = chosen.filter((p) => (post.captions[p] || '').length > PF[p].limit);
  if (over.length) return toast(`${over.map((p) => PF[p].name).join(', ')} 문구가 너무 길어요. 줄여 주세요.`);
  const empty = chosen.filter((p) => !(post.captions[p] || '').trim());
  if (empty.length) return toast(`${empty.map((p) => PF[p].name).join(', ')} 문구가 비어 있어요.`);
  const ok = await confirmBox(`
    <div class="fact-title" style="margin-top:0">이렇게 올릴까요?</div>
    <p><b>${chosen.map((p) => `${PF[p].icon} ${PF[p].name}`).join(', ')}</b>에 동시에 올려요.</p>
    <p class="hint">사진 ${imgs.length}장 · 올린 뒤에는 각 앱에서 바로 보여요.</p>
    ${imgs.length ? `<div class="thumbs">${imgs.slice(0, 5).map((im) => `<div class="thumb"><img src="${imgUrl(im)}" alt="" /></div>`).join('')}</div>` : ''}`, '올리기');
  if (!ok) return;
  const pin = await pinBox('게시 PIN');
  if (pin === null) return;
  loading('올리는 중이에요… (사진이 많으면 1분 정도 걸려요)');
  try {
    const { results, post: p } = await api('POST', `/api/posts/${post.id}/publish`, { platforms: chosen, pin });
    state.post = p;
    renderPostView();
    window.scrollTo(0, 0);
    const okNames = results.filter((r) => r.ok).map((r) => r.name);
    const fails = results.filter((r) => !r.ok);
    if (fails.length) alertBox(`${okNames.length ? `✅ ${okNames.join(', ')} 게시 완료\n\n` : ''}❌ 올리지 못한 곳\n${fails.map((f) => `· ${f.name}: ${f.error}`).join('\n')}`);
    else modal(`<div class="cheer">${robot('cheer', 'robot md')}<div class="fact-title" style="margin:6px 0 4px">${esc(okNames.join(', '))}에 올렸어요!</div><p class="hint">반응 탭에서 좋아요와 답글을 볼 수 있어요.</p></div><div class="row"><button class="btn primary" data-m="close">확인</button></div>`);
  } catch (err) {
    toast(err.message);
    renderPostView();
  }
}

// ---------- 클릭 처리 ----------
$app.addEventListener('input', (e) => {
  const cap = e.target.closest('[data-cap]');
  if (cap) {
    const pf = PF[cap.dataset.cap];
    const n = cap.value.length;
    const cnt = document.querySelector(`[data-count="${pf.id}"]`);
    cnt.textContent = `${n} / ${pf.limit}자`;
    cnt.classList.toggle('over', n > pf.limit);
    state.post.captions[pf.id] = cap.value;
    if (state.capTab === pf.id) document.getElementById('preview').innerHTML = previewHtml(state.post, pf.id);
    queueSave();
  }
});

$app.addEventListener('click', async (e) => {
  const t = (sel) => e.target.closest(sel);
  let el;

  if ((el = t('[data-go]'))) return setView(el.dataset.go);
  if ((el = t('[data-filter]'))) { state.filter = el.dataset.filter; return renderPosts(); }
  if ((el = t('[data-open]'))) return setView('post', { postId: el.dataset.open });

  // 손님
  if (state.view === 'customers') {
    if ((el = t('[data-cust=sync]'))) return syncCustomers(el);
    if ((el = t('[data-cust-filter]'))) { state.custFilter = el.dataset.custFilter; return renderCustomers(); }
    if ((el = t('[data-cust-open]'))) return openCustomer(el.dataset.custOpen).catch((err) => toast(err.message));
  }

  // 새 게시물 입력
  if (state.view === 'new') {
    if ((el = t('[data-topic]'))) {
      syncNewDraft();
      state.newDraft.topic = el.dataset.topic;
      document.getElementById('topic').value = el.dataset.topic;
      document.querySelectorAll('[data-topic]').forEach((c) => c.classList.toggle('on', c === el));
      return;
    }
    if ((el = t('[data-layout],[data-effect]'))) {
      const key = el.dataset.layout ? 'layout' : 'effect';
      state.newDraft[key] = el.dataset[key];
      document.querySelectorAll(`[data-${key}]`).forEach((c) => { c.classList.toggle('on', c === el); c.setAttribute('aria-pressed', c === el); });
      return;
    }
    if ((el = t('[data-tone]'))) {
      state.newDraft.tone = el.dataset.tone;
      document.querySelectorAll('[data-tone]').forEach((c) => c.classList.toggle('on', c === el));
      return;
    }
    if ((el = t('[data-idea]'))) {
      const idea = JSON.parse(el.dataset.idea);
      state.newDraft.topic = idea.topic;
      state.newDraft.detail = idea.detail;
      document.getElementById('topic').value = idea.topic;
      document.getElementById('detail').value = idea.detail;
      return toast('아이디어를 채워 넣었어요.');
    }
    if ((el = t('[data-del-ref]'))) {
      syncNewDraft();
      state.newDraft.files.splice(Number(el.dataset.delRef), 1);
      return renderNew();
    }
    const act = t('[data-action]')?.dataset.action;
    if (act === 'ref-camera' || act === 'ref-pick') {
      syncNewDraft();
      const files = act === 'ref-camera' ? await takePhoto() : await pickFiles({ camera: false });
      state.newDraft.files.push(...files);
      if (state.newDraft.files.length > 10) { state.newDraft.files.length = 10; toast('참고 사진은 10장까지예요.'); }
      return renderNew();
    }
    if (act === 'ideas') {
      const box = document.getElementById('ideas');
      box.innerHTML = '<div class="hint">AI가 아이디어를 고르는 중…</div>';
      try {
        const { ideas } = await api('POST', `/api/stores/${state.storeId}/ideas`);
        box.innerHTML = ideas.map((i) => `<button class="idea" data-idea="${esc(JSON.stringify(i))}"><b>${esc(i.topic)}</b><span>${esc(i.why)}</span></button>`).join('');
      } catch (err) { box.innerHTML = ''; toast(err.message); }
      return;
    }
    if (act === 'create') return createPost();
    return;
  }

  // 게시물 화면
  if (state.view === 'post' && state.post) {
    if ((el = t('[data-tools]'))) { e.stopPropagation(); return openTools(el.dataset.tools); }
    if ((el = t('[data-toggle]'))) {
      const id = el.dataset.toggle;
      let ids = [...state.post.selectedImageIds];
      if (ids.includes(id)) ids = ids.filter((x) => x !== id);
      else if (ids.length >= 10) return toast('한 번에 10장까지 올릴 수 있어요.');
      else ids.push(id);
      await saveCaptions();
      return refreshPost(await api('PUT', `/api/posts/${state.post.id}`, { selectedImageIds: ids }));
    }
    if ((el = t('[data-tab]'))) {
      await saveCaptions();
      state.capTab = el.dataset.tab;
      const y = window.scrollY;
      renderPostView();
      window.scrollTo(0, y);
      return;
    }
    if ((el = t('[data-del-pub]'))) {
      const pf = PF[el.dataset.delPub];
      if (!(await confirmBox(`<b>${pf.name}</b>에 올린 게시물을 지울까요?<p class="hint">좋아요와 댓글도 함께 사라지고 되돌릴 수 없어요.</p>`, '지우기'))) return;
      const pin = await pinBox('게시 PIN');
      if (pin === null) return;
      try { await refreshPost(await api('POST', `/api/posts/${state.post.id}/publications/${pf.id}/delete`, { pin })); toast(`${pf.name} 게시물을 지웠어요.`); }
      catch (err) { alertBox(err.message); }
      return;
    }
    if ((el = t('[data-reset-pub]'))) {
      await refreshPost(await api('POST', `/api/posts/${state.post.id}/publications/${el.dataset.resetPub}/reset`));
      document.querySelector('.publish-card')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const act = t('[data-action]')?.dataset.action;
    try {
      if (act === 'add-camera' || act === 'add-pick') {
        await saveCaptions();
        const files = act === 'add-camera' ? await takePhoto() : await pickFiles({ camera: false });
        if (!files.length) return;
        toast('사진을 넣고 자동 보정하는 중…');
        let p = state.post;
        for (const f of files) {
          const c = await Imaging.fitInsta(f);
          p = await uploadImage(p.id, await Imaging.toJpeg(c), { kind: 'reference' });
          const ref = p.images[p.images.length - 1];
          p = await uploadImage(p.id, await Imaging.toJpeg(await Imaging.enhance(c, 'auto')), { kind: 'enhanced', source: ref.id, label: 'auto', select: true });
        }
        await refreshPost(p);
        toast(`사진 ${files.length}장을 넣었어요. (보정본이 선택돼요)`);
      }
      if (act === 'card') { await saveCaptions(); return openCardMaker(null); }
      if (act === 'ai-generate') { await saveCaptions(); return aiImage('generate'); }
      if (act === 'regen') {
        if (!(await confirmBox('AI가 세 플랫폼 문구를 새로 써요. 지금 고친 문구는 바뀌어요.', '다시 쓰기'))) return;
        toast('AI가 문구를 다시 쓰는 중…');
        clearTimeout(saveTimer);
        await refreshPost(await api('POST', `/api/posts/${state.post.id}/generate`));
        toast('새 문구를 만들었어요.');
      }
      if (act === 'copy') {
        const text = state.post.captions[state.capTab] || '';
        try { await navigator.clipboard.writeText(text); toast(`${PF[state.capTab].name} 문구를 복사했어요.`); }
        catch { document.querySelector(`[data-cap="${state.capTab}"]`).select(); toast('글을 길게 눌러 복사해 주세요.'); }
      }
      if (act === 'save') {
        await saveCaptions();
        const chosen = [...document.querySelectorAll('[data-pf]:checked')].map((c) => c.dataset.pf);
        await api('PUT', `/api/posts/${state.post.id}`, { platforms: chosen });
        toast('임시저장했어요. 내 게시물에서 이어서 할 수 있어요.');
      }
      if (act === 'publish') return publishNow();
      if (act === 'metrics') {
        toast('반응을 불러오는 중…');
        const { post, errors } = await api('POST', `/api/posts/${state.post.id}/metrics`);
        igcData = null;
        await refreshPost(post);
        await loadPostComments(true);
        const errs = Object.entries(errors);
        if (errs.length) alertBox(errs.map(([k, v]) => `${PF[k].name}: ${v}`).join('\n\n'));
        else toast('반응을 새로 불러왔어요.');
      }
      if (act === 'remove') {
        const published = Object.values(state.post.publications || {}).some((p) => p.status === 'published');
        if (!(await confirmBox(`이 게시물을 목록에서 지울까요?${published ? '<p class="hint">SNS에 올라간 게시물은 지워지지 않아요. SNS에서도 지우려면 먼저 게시 현황의 삭제를 눌러 주세요.</p>' : ''}`, '지우기'))) return;
        await api('DELETE', `/api/posts/${state.post.id}`);
        toast('목록에서 지웠어요.');
        setView('posts');
      }
    } catch (err) {
      toast(err.message);
    }
  }
});

// ---------- 계정 연결 ----------
async function loadConnections() {
  try { state.connections = await api('GET', '/api/connections'); } catch { state.connections = {}; }
  return state.connections;
}

function channelCard(id, title, c, fields, help) {
  return `
  <div class="card" data-ch="${id}">
    <div class="week-head"><h2 style="margin:0">${title}</h2><span class="pf-state ${c.connected ? 'on' : ''}">${c.connected ? '● 연결됨' : '○ 연결 안 됨'}</span></div>
    ${fields.map((f) => `
      <label>${f.label} ${f.hint ? `<span class="hint">${f.hint}</span>` : ''}</label>
      <input data-k="${f.key}" ${f.secret ? 'type="password" autocomplete="off"' : ''} value="${f.secret ? '' : esc(c[f.key] || '')}" placeholder="${esc(f.secret && c[f.key] ? `저장됨 (${c[f.key]}) · 바꿀 때만 입력` : f.ph || '')}" />`).join('')}
    <details><summary>토큰은 어디서 받나요?</summary><div class="hint">${help}</div></details>
    <div class="row">
      <button class="btn primary" data-ch-act="save">저장하고 연결 확인</button>
      ${c.connected ? '<button class="btn line" data-ch-act="disconnect">연결 끊기</button>' : ''}
    </div>
  </div>`;
}

async function renderChannels() {
  loading('불러오는 중…');
  const c = await loadConnections();
  $app.innerHTML = `
    <h1>계정 연결</h1>
    <p class="lead">한 번 연결해 두면 게시물을 버튼 하나로 여러 곳에 동시에 올릴 수 있어요. 토큰은 이 컴퓨터(서버)에만 저장돼요.</p>

    <div class="card summary" data-ch="public">
      <div class="label">공개 주소 (인스타그램·스레드에 사진 올릴 때 필요)</div>
      <p style="margin:4px 0 0">인스타그램과 스레드는 Meta 서버가 사진을 <b>인터넷 주소로 가져가는</b> 방식이라 localhost로는 사진이 안 올라가요. 폴더의 <b>tunnel.bat</b>을 실행하면 나오는 <b>https://….trycloudflare.com</b> 주소를 넣어 주세요. <b>또는 그 주소로 이 앱을 열면</b> 따로 넣지 않아도 돼요. (페이스북과 글만 올리는 스레드는 없어도 돼요)</p>
      ${c.envManaged?.publicBaseUrl ? `<p style="margin:10px 0 0"><b>${esc(c.publicBaseUrl)}</b> · 배포 서버 주소를 자동으로 써요.</p>`
      : `<input data-k="publicBaseUrl" value="${esc(c.publicBaseUrl)}" placeholder="예: https://abc-def.trycloudflare.com" style="margin-top:10px" />
      <div class="row"><button class="btn primary" data-ch-act="save-public">공개 주소 저장</button></div>`}
    </div>

    ${c.envManaged?.instagram ? `<div class="card"><div class="week-head"><h2 style="margin:0">📸 인스타그램</h2><span class="pf-state on">● 연결됨</span></div>
      <p class="hint" style="margin:6px 0 0">서버 환경변수(INSTAGRAM_TOKEN)로 연결돼 있어요. 토큰을 바꾸려면 서버(Render → Environment)에서 바꿔 주세요.<br>
      ${c.instagram?.canDelete ? '이 앱에서 올린 게시물을 지울 수 있어요.' : '인스타그램 로그인 토큰이라 삭제는 인스타그램 앱에서 해 주세요.'} 인스타그램 앱에서 지우면 여기에도 자동으로 반영돼요.</p></div>`
    : channelCard('instagram', '📸 인스타그램', c.instagram || {}, [
      { key: 'token', label: '액세스 토큰', secret: true, ph: 'IGAA… 로 시작하는 토큰' },
      { key: 'igUserId', label: '인스타그램 계정 ID', hint: '(IGAA 토큰이면 비워 두세요)', ph: '페이스북 로그인 방식일 때만' },
    ], '① 인스타그램 계정을 <b>프로페셔널(비즈니스/크리에이터)</b>로 전환<br>② <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">Meta for Developers</a>에서 앱 만들기 → 사용 사례에서 Instagram API 추가<br>③ "Instagram 로그인으로 API 설정" → 계정 추가 → <b>토큰 생성</b> (instagram_business_basic, instagram_business_content_publish 권한)<br>※ 이 앱에서 게시물을 지우려면 <b>페이스북 로그인 방식 토큰(EAA…)</b>에 instagram_manage_contents 권한이 있어야 해요. 인스타그램 앱에서 지우면 여기에도 자동으로 반영돼요.<br>※ 개발 모드에서는 앱에 등록한 본인 계정으로만 올릴 수 있어요. 메뉴 이름은 Meta 화면 개편에 따라 조금 다를 수 있어요.')}

    ${c.envManaged?.facebook ? `<div class="card"><div class="week-head"><h2 style="margin:0">📘 페이스북 페이지</h2><span class="pf-state on">● 연결됨</span></div>
      <p class="hint" style="margin:6px 0 0">서버 환경변수(FACEBOOK_PAGE_ID, FACEBOOK_PAGE_TOKEN)로 연결돼 있어요. 바꾸려면 서버(Render → Environment 또는 .env)에서 바꿔 주세요.</p>
      <div class="row"><button class="btn line" data-fb-test>연결 확인</button></div></div>`
    : channelCard('facebook', '📘 페이스북 페이지', c.facebook || {}, [
      { key: 'pageId', label: '페이지 ID', ph: '숫자로 된 페이지 ID' },
      { key: 'token', label: '페이지 액세스 토큰', secret: true, ph: 'EAA… 로 시작하는 토큰' },
    ], '① 페이스북 <b>페이지</b>가 있어야 해요 (개인 프로필에는 API로 못 올려요)<br>② <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener">그래프 API 탐색기</a>에서 내 앱 선택 → 권한 pages_manage_posts, pages_read_engagement 추가 → 토큰 생성<br>③ "사용자 또는 페이지"에서 내 페이지를 골라 <b>페이지 토큰</b>으로 바꾸기<br>④ 탐색기에서 <code>me/accounts</code>를 조회하면 페이지 ID가 나와요<br>※ 탐색기 토큰은 1~2시간이면 만료돼요. 시연 직전에 새로 받거나 장기 토큰으로 바꿔 두세요.')}

    ${c.envManaged?.threads ? `<div class="card"><div class="week-head"><h2 style="margin:0">🧵 스레드</h2><span class="pf-state on">● 연결됨</span></div>
      <p class="hint" style="margin:6px 0 0">서버 환경변수(THREADS_TOKEN)로 연결돼 있어요.</p></div>`
    : channelCard('threads', '🧵 스레드', c.threads || {}, [
      { key: 'token', label: '액세스 토큰', secret: true, ph: 'TH… 로 시작하는 토큰' },
    ], '① <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">Meta for Developers</a>에서 앱 만들기 → 사용 사례에서 <b>Threads API</b> 선택<br>② 권한 threads_basic, threads_content_publish 추가 (게시물 삭제는 threads_delete, 반응 보기는 threads_manage_insights도)<br>③ 역할 → 스레드 테스터에 내 계정 추가 → 스레드 앱 설정에서 초대 수락<br>④ 사용자 토큰 생성기에서 토큰 만들기<br>※ 글자 수 500자, 해시태그 1개 제한이 있어요.')}`;
}

$app.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-fb-test]')) return;
  const r = await fetch('/api/connections/facebook/test', { method: 'POST' }).then((x) => x.json()).catch(() => ({ error: '서버에 연결하지 못했어요.' }));
  if (r.ok) toast(`✅ ${r.message}`); else alertBox(`연결 확인 실패\n\n${r.error}`);
});

$app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ch-act]');
  if (!b) return;
  const box = b.closest('[data-ch]');
  const ch = box.dataset.ch;
  const act = b.dataset.chAct;
  b.disabled = true;
  try {
    if (act === 'save-public') {
      await api('PUT', '/api/connections', { publicBaseUrl: box.querySelector('[data-k=publicBaseUrl]').value });
      toast('공개 주소를 저장했어요.');
    } else if (act === 'disconnect') {
      if (!(await confirmBox('연결을 끊을까요? 저장된 토큰이 지워져요.', '연결 끊기'))) { b.disabled = false; return; }
      await api('PUT', '/api/connections', { disconnect: ch });
      toast('연결을 끊었어요.');
    } else if (act === 'save') {
      const vals = {};
      box.querySelectorAll('[data-k]').forEach((i) => (vals[i.dataset.k] = i.value));
      await api('PUT', '/api/connections', { [ch]: vals });
      const r = await fetch(`/api/connections/${ch}/test`, { method: 'POST' }).then((x) => x.json());
      if (r.ok) toast(`✅ ${r.message}`);
      else alertBox(`연결 확인 실패\n\n${r.error}`);
    }
  } catch (err) {
    toast(err.message);
  }
  await renderChannels();
});

// ---------- 첫 실행 온보딩 ----------
// 같이가게 캐릭터(로봇) 하나로 통일. 포즈: hello, guide, think, cheer, shy, bell
const robot = (pose, cls = 'robot') => `<img class="${cls}" src="/img/robot-${pose}.png" alt="" aria-hidden="true" />`;
const ob = { step: 0, data: { ownerName: '', manager: 'duri', category: '', name: '', address: '', weeklyPromo: true } };

function obScreen(body, foot, { back = true } = {}) {
  return `<div class="ob">
    <button type="button" class="ob-back ${back ? '' : 'ghost'}" data-ob="back" aria-label="뒤로">‹</button>
    <div class="ob-body">${body}</div>
    <div class="ob-foot">${foot}</div>
  </div>`;
}

function renderOnboarding() {
  if (ob.step === 0 && splashDone) ob.step = 1; // 로고는 이미 봤으면 건너뛰기
  const d = ob.data;
  const next = (label = '다음') => `<button type="button" class="btn primary" data-ob="next">${label}</button>`;
  const steps = [
    () => `<div class="ob ob-splash" data-ob="next">${robot('hello', 'robot splash')}<div class="ob-logo">같이가게</div></div>`,
    () => obScreen(`<div class="ob-hello">${robot('hello', 'robot sm')}<div class="bubble">안녕하세요! 홍보, 저와 같이 해봐요.</div></div>
      <h1>사장님의<br>이름을 입력해주세요</h1>
      <label>이름</label><input data-field="ownerName" value="${esc(d.ownerName)}" autocomplete="name" />`, next(), { back: false }),
    () => obScreen(`<h1>어떤 업종을 하고 계신가요?</h1>
      <label>업종</label><input data-field="category" list="obCategories" value="${esc(d.category)}" placeholder="골라주세요 또는 직접 입력" />
      <datalist id="obCategories">${CATEGORY_EXAMPLES.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`, next()),
    () => obScreen(`<h1>사장님의 가게를 알려주세요</h1>
      <label>가게 이름</label><input data-field="name" value="${esc(d.name)}" />
      <label>가게 주소</label><input data-field="address" value="${esc(d.address)}" placeholder="동네 이름까지 · 해시태그에 쓰여요" />`, next()),
    () => {
      return obScreen(`<div class="ob-center">${robot('bell')}
        <h1>매주, 가게 홍보를 챙겨드릴까요?</h1>
        <p>사장님 상황에 맞는 홍보를 일주일에 한 번 알려드릴게요.</p></div>`,
        `<button type="button" class="btn soft" data-ob="finish-skip">건너뛰기</button>
         <button type="button" class="btn primary" data-ob="finish">다음</button>`);
    },
  ];
  $app.innerHTML = steps[ob.step]();
  $app.querySelector('input')?.focus();
  if (ob.step === 0) setTimeout(() => { if (ob.step === 0 && !state.storeId) { ob.step = 1; renderOnboarding(); } }, 1200);
}

const OB_REQUIRED = { 1: [['ownerName', '이름']], 2: [['category', '업종']], 3: [['name', '가게 이름'], ['address', '가게 주소']] };

async function onboardingClick(e) {
  const act = e.target.closest('[data-ob]')?.dataset.ob;
  if (!act) return;
  $app.querySelectorAll('[data-field]').forEach((i) => (ob.data[i.dataset.field] = i.value.trim()));
  if (act === 'back') ob.step = Math.max(1, ob.step - 1);
  if (act === 'next') {
    const miss = (OB_REQUIRED[ob.step] || []).find(([k]) => !ob.data[k]);
    if (miss) return toast(`${miss[1]}을(를) 입력해 주세요.`);
    ob.step++;
  }
  if (act === 'finish' || act === 'finish-skip') {
    ob.data.weeklyPromo = act === 'finish';
    e.target.disabled = true;
    try {
      const created = await api('POST', '/api/stores', ob.data);
      state.storeId = created.id;
      state.store = created;
      lsSet('gachi.storeId', created.id);
      ob.step = 0;
      return startConnect('onboarding'); // 와이어프레임: 가게 등록 → 계정 연결 → 홈
    } catch (err) {
      e.target.disabled = false;
      return toast(err.message);
    }
  }
  renderOnboarding();
}
$app.addEventListener('click', (e) => { if (!state.storeId) onboardingClick(e); });
$app.addEventListener('keydown', (e) => {
  if (!state.storeId && e.key === 'Enter' && e.target.matches('input')) $app.querySelector('[data-ob=next]')?.click();
});

// ---------- 라우팅 ----------
// ---------- 처음 화면: 로고 → 약관 동의 → 로그인 ----------
let splashDone = false;
function renderSplash() {
  $nav.classList.add('hidden');
  $app.innerHTML = `<div class="ob ob-splash">${robot('hello', 'robot splash')}<div class="ob-logo">같이가게</div>
    <p class="lead" style="text-align:center;margin-top:6px">우리 가게를 이해하는 마케팅 AI</p></div>`;
  setTimeout(() => { splashDone = true; if (!state.user) render(); }, 1400);
}

// 약관 내용 (해커톤 시연용 초안 · 정식 서비스 전 법률 검토 필요)
const CONSENTS = [
  { k: 'terms', req: true, t: '서비스 이용약관 동의',
    body: '같이가게는 가게 정보를 바탕으로 홍보 문구·사진을 만들어 드리고, 사장님이 연결한 SNS에 사장님이 확인한 게시물만 올려 드리는 서비스예요. 사장님이 확인하기 전에는 아무것도 자동으로 올리지 않아요. 서비스를 부정하게 쓰거나 다른 사람의 계정을 연결하면 이용이 제한될 수 있어요.' },
  { k: 'privacy', req: true, t: '개인정보 수집·이용 동의',
    body: '<b>수집 항목</b> 아이디, 비밀번호(암호화해서 저장), 사장님 이름, 가게 이름·업종·주소·상품, 올린 사진과 문구, 연결한 SNS의 게시물 정보<br><b>이용 목적</b> 회원 확인, 홍보 문구·사진 만들기, SNS 게시와 반응 보여주기<br><b>보유 기간</b> 회원 탈퇴 시 바로 파기 (법령에 따라 보관해야 하는 정보는 그 기간 동안 보관)<br><b>하지 않는 것</b> 비밀번호를 SNS에 넘기지 않고, DM·팔로워 목록을 가져오지 않으며, 다른 곳에 팔거나 넘기지 않아요.<br>동의를 거부할 수 있지만, 필수 항목에 동의하지 않으면 가입할 수 없어요.' },
  { k: 'age', req: true, t: '만 14세 이상입니다', body: '만 14세 미만은 보호자 동의 없이 가입할 수 없어요.' },
  { k: 'marketing', req: false, t: '마케팅 정보 수신 동의',
    body: '새 기능, 이벤트, 소상공인 지원 소식을 앱 알림으로 보내 드려요. 동의하지 않아도 서비스를 모두 쓸 수 있고, 가게 정보 화면에서 언제든 끌 수 있어요.' },
];
const getConsent = () => { try { return JSON.parse(lsGet('gachi.consent') || 'null'); } catch { return null; } };
const consentOk = (c) => !!(c && c.terms && c.privacy && c.age);

function renderConsent() {
  $nav.classList.add('hidden');
  const c = getConsent() || {};
  const all = CONSENTS.every((x) => c[x.k]);
  $app.innerHTML = `
    <div class="auth consent">
      ${robot('guide', 'robot md')}
      <h1 style="text-align:center;margin:4px 0 6px">약관에 동의해 주세요</h1>
      <p class="lead" style="text-align:center">사장님 정보를 어떻게 쓰는지 먼저 알려 드릴게요.</p>
      <label class="cs-all"><input type="checkbox" data-cs="all" ${all ? 'checked' : ''} /> <b>전체 동의</b><span class="hint">선택 항목 포함</span></label>
      <div class="card cs-list">
        ${CONSENTS.map((x) => `<div class="cs-item">
          <label><input type="checkbox" data-cs="${x.k}" ${c[x.k] ? 'checked' : ''} /> <span class="cs-tag ${x.req ? 'req' : ''}">${x.req ? '필수' : '선택'}</span> ${x.t}</label>
          <details><summary>보기</summary><div class="hint cs-body">${x.body}</div></details>
        </div>`).join('')}
      </div>
      <button type="button" class="btn primary block" data-cs-go ${consentOk(c) ? '' : 'disabled'}>동의하고 시작하기</button>
      <p class="hint" style="text-align:center;margin-top:10px">해커톤 시연용 약관 초안이에요.</p>
    </div>`;
}
$app.addEventListener('change', (e) => {
  const cb = e.target.closest('[data-cs]');
  if (!cb || state.user) return;
  const c = getConsent() || {};
  if (cb.dataset.cs === 'all') CONSENTS.forEach((x) => (c[x.k] = cb.checked));
  else c[cb.dataset.cs] = cb.checked;
  c.at = new Date().toISOString();
  lsSet('gachi.consent', JSON.stringify(c));
  renderConsent();
});
$app.addEventListener('click', (e) => {
  if (!e.target.closest('[data-cs-go]') || state.user) return;
  if (!consentOk(getConsent())) return toast('필수 항목에 동의해 주세요.');
  authMode = 'signup';
  renderAuth();
});

// 가게 정보 화면 아래: 마케팅 정보 수신 동의 (선택) 켜고 끄기
function marketingCard() {
  const on = !!state.user?.consents?.marketing;
  return `<div class="card"><label class="cs-all" style="margin:0"><input type="checkbox" data-mkt ${on ? 'checked' : ''} /> <b>마케팅 정보 수신 동의</b> <span class="cs-tag">선택</span></label>
    <p class="hint" style="margin:6px 0 0">새 기능·이벤트·지원 소식을 앱 알림으로 받아요. 끄더라도 서비스는 그대로 쓸 수 있어요.</p></div>`;
}
$app.addEventListener('change', async (e) => {
  const cb = e.target.closest('[data-mkt]');
  if (!cb) return;
  try {
    const r = await api('PUT', '/api/auth/consent', { marketing: cb.checked });
    state.user = r.user;
    toast(cb.checked ? '마케팅 정보 수신에 동의했어요.' : '마케팅 정보 수신 동의를 철회했어요.');
  } catch (err) { cb.checked = !cb.checked; toast(err.message); }
});

// ---------- 로그인 · 회원가입 ----------
let authMode = consentOk(getConsent()) ? 'login' : 'signup'; // 약관 동의 직후엔 회원가입부터
function renderAuth() {
  $nav.classList.add('hidden');
  const signup = authMode === 'signup';
  $app.innerHTML = `
    <div class="auth">
      ${robot('hello', 'robot md')}<div class="ob-logo" style="text-align:center;margin:0 0 4px">같이가게</div>
      <p class="lead" style="text-align:center">${signup ? '아이디를 만들면 어느 기기에서든 내 가게를 이어서 쓸 수 있어요.' : '로그인하고 우리 가게 홍보를 이어서 해요.'}</p>
      <form id="authForm" class="card" autocomplete="on">
        <label style="margin-top:0">아이디</label>
        <input name="loginId" autocomplete="username" autocapitalize="none" placeholder="영문 소문자·숫자 4자 이상" required />
        <label>비밀번호</label>
        <input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? '8자 이상' : ''}" required />
        ${signup ? '<label>비밀번호 확인</label><input name="password2" type="password" autocomplete="new-password" required />' : ''}
        <div class="row"><button type="submit" class="btn primary block">${signup ? '가입하고 시작하기' : '로그인'}</button></div>
      </form>
      <button type="button" class="btn ghost block" data-auth-mode="${signup ? 'login' : 'signup'}">${signup ? '이미 아이디가 있어요 · 로그인' : '처음이에요 · 회원가입'}</button>
    </div>`;
  const form = document.getElementById('authForm');
  form.elements.loginId.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    if (signup && f.password.value !== f.password2.value) return toast('비밀번호가 서로 달라요.');
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const r = await api('POST', `/api/auth/${signup ? 'signup' : 'login'}`, { loginId: f.loginId.value, password: f.password.value, claimStoreId: lsGet('gachi.storeId'), consents: getConsent() });
      await afterLogin(r);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
}
$app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-auth-mode]');
  if (b && !state.user) { authMode = b.dataset.authMode; renderAuth(); }
});
async function afterLogin(me) {
  state.user = me.user;
  state.storeId = me.storeId;
  if (me.connections) state.connections = me.connections;
  state.store = null;
  if (me.storeId) lsSet('gachi.storeId', me.storeId);
  else lsDel('gachi.storeId');
  document.getElementById('userBox').classList.remove('hidden');
  document.getElementById('userName').textContent = me.user.loginId;
  document.body.classList.add('in-app');
  setView('home');
}
document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (!(await confirmBox('로그아웃할까요?', '로그아웃'))) return;
  await api('POST', '/api/auth/logout').catch(() => {});
  Object.assign(state, { user: null, storeId: null, store: null, post: null });
  lsDel('gachi.storeId');
  document.getElementById('userBox').classList.add('hidden');
  document.body.classList.remove('in-app');
  render();
});

async function render() {
  if (!state.user) {
    if (!splashDone) return renderSplash();
    if (!consentOk(getConsent())) return renderConsent();
    return renderAuth();
  }
  if (!state.storeId) {
    $nav.classList.add('hidden');
    renderOnboarding();
    return;
  }
  $nav.classList.remove('hidden');
  try {
    if (!state.store) state.store = await api('GET', `/api/stores/${state.storeId}`);
    await loadConnections();
    if (state.view === 'new') { state.view = 'write'; state.wstep = 1; state.wideas = null; } // 예전 '새 게시물' → 글쓰기 단계
    if (state.view === 'home') await renderHome();
    else if (state.view === 'write') renderWrite();
    else if (state.view === 'connect') renderConnect();
    else if (state.view === 'posts') { await renderPosts(); snsSync(); }
    else if (state.view === 'post') await openPost(state.postId);
    else if (state.view === 'store') { $app.innerHTML = storeForm(state.store) + marketingCard(); bindStoreForm(state.store); }
    else if (state.view === 'channels') await renderChannelsSimple();
    else if (state.view === 'channels-adv') await renderChannels();
    else if (state.view === 'insta') await renderInsta();
    else if (state.view === 'customers') await renderCustomers();
    withTabs();
    highlightNav();
  } catch (err) {
    if (/가게 정보를 찾을 수 없어요/.test(err.message)) {
      lsDel('gachi.storeId');
      state.storeId = null;
      state.store = null;
      return render();
    }
    $app.innerHTML = `<div class="card">${esc(err.message)}</div><button class="btn line" data-go="posts">내 게시물로</button>`;
  }
}

$nav.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  if (state.view === 'post') await saveCaptions().catch(() => {});
  if (state.view === 'new') syncNewDraft();
  setView(b.dataset.view);
});

window.addEventListener('beforeunload', () => { if (saveTimer) saveCaptions(); });

(async function init() {
  try {
    const h = await api('GET', '/api/health');
    state.tones = h.tones || [];
    const badge = document.getElementById('providerBadge');
    badge.textContent = h.provider === 'mock' ? '데모 모드' : `AI: ${h.model}`;
    badge.classList.toggle('mock', h.provider === 'mock');
  } catch {}
  try { await afterLogin(await api('GET', '/api/auth/me')); }
  catch { render(); } // 로그인 안 됨 → 로그인 화면
})();
