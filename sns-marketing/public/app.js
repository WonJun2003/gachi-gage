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
  newDraft: { topic: '', detail: '', tone: '친근하게', files: [] }, // 새 게시물 입력 중인 내용
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
  $app.innerHTML = `<div class="loading"><div class="spinner"></div><div id="loadMsg">${esc(msg)}</div>${steps ? `<ul class="steps">${steps.map((s, i) => `<li data-step="${i}">${esc(s)}</li>`).join('')}</ul>` : ''}</div>`;
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
    }).join('') : `<div class="card empty">${posts.length ? '이 조건의 게시물이 없어요.' : '아직 만든 게시물이 없어요.<br>위의 <b>새 게시물 만들기</b>를 눌러 첫 게시물을 만들어 보세요!'}</div>`}`;
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

      <label>참고 사진 <span class="hint">(선택 · 최대 10장 · AI가 사진을 보고 문구를 써요)</span></label>
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
    let post = await api('POST', `/api/stores/${state.storeId}/posts`, { topic: d.topic, detail: d.detail, tone: d.tone });
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
    // 표지: 홍보 카드 → 그다음 보정 사진들
    const card = await Imaging.makeCard({
      photo: enhancedBlobs[0]?.blob || null,
      headline: post.headline || d.topic,
      subline: post.subline,
      storeName: state.store.name,
      template: enhancedBlobs.length ? 'bottom' : 'text',
    });
    post = await uploadImage(post.id, await Imaging.toJpeg(card), { kind: 'card', source: enhancedBlobs[0]?.ref.id, label: enhancedBlobs.length ? 'bottom' : 'text', select: true });
    for (const e of enhancedBlobs) post = await uploadImage(post.id, e.blob, { kind: 'enhanced', source: e.ref.id, label: 'auto', select: true });
    stepDone(4);
    // 연결된 플랫폼을 기본으로 체크
    const pfs = PLATFORMS.filter((p) => state.connections[p.id]?.connected).map((p) => p.id);
    post = await api('PUT', `/api/posts/${post.id}`, { platforms: pfs });
    state.newDraft = { topic: '', detail: '', tone: d.tone, files: [] };
    setView('post', { postId: post.id, post, capTab: 'instagram' });
  } catch (err) {
    toast(err.message);
    renderNew();
  }
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
      const metrics = p.metrics ? Object.entries(p.metrics).map(([k, v]) => `<span class="metric">${esc(k)} <b>${esc(v)}</b></span>`).join('') : '';
      return `<div class="pub-row">
        <div class="pub-main">
          <div><b>${pf.icon} ${pf.name}</b> <span class="status-badge ${p.status}">${p.status === 'published' ? '게시됨' : p.status === 'failed' ? '실패' : '삭제됨'}</span></div>
          <div class="hint">${fmtDate(p.at)}${p.status === 'failed' ? ` · ${esc(p.error)}` : ''}</div>
          ${metrics ? `<div class="metrics">${metrics}</div>` : ''}
        </div>
        <div class="pub-acts">
          ${p.status === 'published' && p.url ? `<a class="btn line sm" href="${esc(p.url)}" target="_blank" rel="noopener">보기</a>` : ''}
          ${p.status === 'published' ? `<button class="btn line sm" data-del-pub="${pf.id}">삭제</button>` : `<button class="btn line sm" data-reset-pub="${pf.id}">다시 올리기</button>`}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderPostView() {
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
}

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
  let tpl = template || (photo ? 'bottom' : 'text');
  const m = modal(`
    <div class="fact-title" style="margin-top:0">🎨 홍보 카드 만들기</div>
    <canvas id="cardCanvas" class="tool-preview"></canvas>
    <label>큰 제목</label><input id="cardHead" value="${esc(post.headline || post.topic)}" maxlength="20" />
    <label>작은 글</label><input id="cardSub" value="${esc(post.subline || '')}" maxlength="30" />
    <div class="chips" style="margin-top:10px">${Object.entries(Imaging.TEMPLATES).map(([k, l]) => `<button class="chip ${k === tpl ? 'on' : ''}" data-tpl="${k}" ${!photo && k !== 'text' ? 'disabled' : ''}>${l}</button>`).join('')}</div>
    <div class="chips">${['#e8590c', '#2f9e44', '#1c7ed6', '#c2255c', '#343a40'].map((c) => `<button class="swatch" data-color="${c}" style="background:${c}" aria-label="색상"></button>`).join('')}</div>
    <div class="row"><button class="btn primary" data-m="add">카드 추가하기</button><button class="btn line" data-m="close">취소</button></div>`,
    async (e, close) => {
      const tb = e.target.closest('[data-tpl]');
      const cb = e.target.closest('[data-color]');
      if (tb && !tb.disabled) { tpl = tb.dataset.tpl; m.el.querySelectorAll('[data-tpl]').forEach((b) => b.classList.toggle('on', b === tb)); draw(); }
      if (cb) { color = cb.dataset.color; draw(); }
      if (e.target.closest('[data-m=add]')) {
        const canvas = await build();
        close();
        try {
          const headline = m.el.querySelector('#cardHead').value;
          const subline = m.el.querySelector('#cardSub').value;
          await api('PUT', `/api/posts/${post.id}`, {});
          let p = await uploadImage(post.id, await Imaging.toJpeg(canvas), { kind: 'card', source: photo?.id, label: tpl, select: true });
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
    template: tpl,
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
  loading('올리는 중이에요… (사진이 많으면 1분 정도 걸려요)');
  try {
    const { results, post: p } = await api('POST', `/api/posts/${post.id}/publish`, { platforms: chosen });
    state.post = p;
    renderPostView();
    window.scrollTo(0, 0);
    const okNames = results.filter((r) => r.ok).map((r) => r.name);
    const fails = results.filter((r) => !r.ok);
    if (fails.length) alertBox(`${okNames.length ? `✅ ${okNames.join(', ')} 게시 완료\n\n` : ''}❌ 올리지 못한 곳\n${fails.map((f) => `· ${f.name}: ${f.error}`).join('\n')}`);
    else toast(`🎉 ${okNames.join(', ')}에 올렸어요!`);
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

  // 새 게시물 입력
  if (state.view === 'new') {
    if ((el = t('[data-topic]'))) {
      syncNewDraft();
      state.newDraft.topic = el.dataset.topic;
      document.getElementById('topic').value = el.dataset.topic;
      document.querySelectorAll('[data-topic]').forEach((c) => c.classList.toggle('on', c === el));
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
      if (!(await confirmBox(`<b>${pf.name}</b>에 올린 게시물을 지울까요?<p class="hint">지운 게시물은 되돌릴 수 없어요.</p>`, '지우기'))) return;
      try { await refreshPost(await api('POST', `/api/posts/${state.post.id}/publications/${pf.id}/delete`)); toast(`${pf.name} 게시물을 지웠어요.`); }
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
        await refreshPost(post);
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
      <p style="margin:4px 0 0">인스타그램과 스레드는 Meta 서버가 사진을 <b>인터넷 주소로 가져가는</b> 방식이라 localhost로는 사진이 안 올라가요. 폴더의 <b>tunnel.bat</b>을 실행하면 나오는 <b>https://….trycloudflare.com</b> 주소를 넣어 주세요. (페이스북과 글만 올리는 스레드는 없어도 돼요)</p>
      <input data-k="publicBaseUrl" value="${esc(c.publicBaseUrl)}" placeholder="예: https://abc-def.trycloudflare.com" style="margin-top:10px" />
      <div class="row"><button class="btn primary" data-ch-act="save-public">공개 주소 저장</button></div>
    </div>

    ${channelCard('instagram', '📸 인스타그램', c.instagram || {}, [
      { key: 'token', label: '액세스 토큰', secret: true, ph: 'IGAA… 로 시작하는 토큰' },
      { key: 'igUserId', label: '인스타그램 계정 ID', hint: '(IGAA 토큰이면 비워 두세요)', ph: '페이스북 로그인 방식일 때만' },
    ], '① 인스타그램 계정을 <b>프로페셔널(비즈니스/크리에이터)</b>로 전환<br>② <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">Meta for Developers</a>에서 앱 만들기 → 사용 사례에서 Instagram API 추가<br>③ "Instagram 로그인으로 API 설정" → 계정 추가 → <b>토큰 생성</b> (instagram_business_basic, instagram_business_content_publish 권한)<br>※ 개발 모드에서는 앱에 등록한 본인 계정으로만 올릴 수 있어요. 인스타그램은 API로 게시물 삭제가 안 돼요. 메뉴 이름은 Meta 화면 개편에 따라 조금 다를 수 있어요.')}

    ${channelCard('facebook', '📘 페이스북 페이지', c.facebook || {}, [
      { key: 'pageId', label: '페이지 ID', ph: '숫자로 된 페이지 ID' },
      { key: 'token', label: '페이지 액세스 토큰', secret: true, ph: 'EAA… 로 시작하는 토큰' },
    ], '① 페이스북 <b>페이지</b>가 있어야 해요 (개인 프로필에는 API로 못 올려요)<br>② <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener">그래프 API 탐색기</a>에서 내 앱 선택 → 권한 pages_manage_posts, pages_read_engagement 추가 → 토큰 생성<br>③ "사용자 또는 페이지"에서 내 페이지를 골라 <b>페이지 토큰</b>으로 바꾸기<br>④ 탐색기에서 <code>me/accounts</code>를 조회하면 페이지 ID가 나와요<br>※ 탐색기 토큰은 1~2시간이면 만료돼요. 시연 직전에 새로 받거나 장기 토큰으로 바꿔 두세요.')}

    ${channelCard('threads', '🧵 스레드', c.threads || {}, [
      { key: 'token', label: '액세스 토큰', secret: true, ph: 'TH… 로 시작하는 토큰' },
    ], '① <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">Meta for Developers</a>에서 앱 만들기 → 사용 사례에서 <b>Threads API</b> 선택<br>② 권한 threads_basic, threads_content_publish 추가 (게시물 삭제는 threads_delete, 반응 보기는 threads_manage_insights도)<br>③ 역할 → 스레드 테스터에 내 계정 추가 → 스레드 앱 설정에서 초대 수락<br>④ 사용자 토큰 생성기에서 토큰 만들기<br>※ 글자 수 500자, 해시태그 1개 제한이 있어요.')}`;
}

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

// ---------- 라우팅 ----------
async function render() {
  if (!state.storeId) {
    $nav.classList.add('hidden');
    $app.innerHTML = storeForm(null);
    bindStoreForm(null);
    return;
  }
  $nav.classList.remove('hidden');
  try {
    if (!state.store) state.store = await api('GET', `/api/stores/${state.storeId}`);
    await loadConnections();
    if (state.view === 'posts') await renderPosts();
    else if (state.view === 'new') renderNew();
    else if (state.view === 'post') await openPost(state.postId);
    else if (state.view === 'store') { $app.innerHTML = storeForm(state.store); bindStoreForm(state.store); }
    else if (state.view === 'channels') await renderChannels();
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
    state.connections = h.connections || {};
    const badge = document.getElementById('providerBadge');
    badge.textContent = h.provider === 'mock' ? '데모 모드' : `AI: ${h.model}`;
    badge.classList.toggle('mock', h.provider === 'mock');
  } catch {}
  state.storeId = lsGet('gachi.storeId');
  render();
})();
