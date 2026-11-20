require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('./db');
const llm = require('./llm');
const connections = require('./connections');
const auth = require('./auth');
const apilog = require('./apilog');
const crypto = require('crypto');
const { publish, testConnection, deletePublication, fetchMetrics, exists, reactions } = require('./publish');

db.load();
connections.load();
const app = express();
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.set('trust proxy', 1); // Render 같은 프록시 뒤에서 https·IP를 제대로 알기 위해
app.use(express.json({ limit: '300kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// API 사용 기록: 우리 서버 API를 부를 때마다 무엇을·누가·결과만 남김 (요청 내용은 안 남김)
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/admin') || req.path === '/health') return next();
  const t0 = Date.now();
  res.on('finish', () => {
    apilog.add({ kind: 'app', method: req.method, target: req.originalUrl.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id'),
      status: res.statusCode, ok: res.statusCode < 400, ms: Date.now() - t0, user: auth.currentUser(req)?.loginId || '' });
  });
  next();
});
// 업로드한 사진 (인스타·스레드는 이 주소로 Meta가 사진을 가져감)
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));

const PLATFORM_NAMES = { instagram: '인스타그램', facebook: '페이스북', threads: '스레드' };
const TONES = ['친근하게', '깔끔하게 정보 위주로', '이벤트 느낌으로', '감성적으로', '고급스럽게'];
const LAYOUTS = ['magazine', 'caption', 'bottom', 'frame', 'slide'];
const EFFECTS = ['none', 'shapes', 'doodle', 'sparkle', 'sticker'];
const IMAGE_KINDS = ['reference', 'enhanced', 'card', 'ai'];

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message || '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
  });

// ---------- 가게 ----------
function cleanStoreInput(body) {
  const s = (v) => (typeof v === 'string' ? v.trim().slice(0, 500) : '');
  const products = (Array.isArray(body.products) ? body.products : [])
    .map((p) => ({ name: s(p?.name).slice(0, 60), price: s(p?.price).slice(0, 40) }))
    .filter((p) => p.name)
    .slice(0, 20);
  return {
    name: s(body.name).slice(0, 60),
    category: s(body.category).slice(0, 40),
    address: s(body.address).slice(0, 120),
    products,
    goal: s(body.goal),
    etc: s(body.etc),
    ownerName: s(body.ownerName).slice(0, 30),
    manager: ['duri', 'moa', 'tori', 'tantan'].includes(body.manager) ? body.manager : 'duri',
    weeklyPromo: body.weeklyPromo !== false,
  };
}
function validateStore(d) {
  const missing = [];
  if (!d.name) missing.push('가게 이름');
  if (!d.category) missing.push('업종');
  if (!d.address) missing.push('주소');
  return missing;
}
// 내 가게가 아니면 없는 것처럼 (남의 가게 ID를 알아도 못 봄)
function needStore(req, res) {
  const store = db.getStore(req.params.id);
  if (!store || store.ownerId !== req.user.id) {
    res.status(404).json({ error: '가게 정보를 찾을 수 없어요.' });
    return null;
  }
  return store;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, provider: llm.providerName(), model: llm.modelName(), tones: TONES });
});

// ---------- 로그인 ----------
const userView = (u) => ({ loginId: u.loginId, name: u.name, consents: u.consents || null });
// 약관 동의: 필수(이용약관·개인정보 수집·이용·만 14세 이상) + 선택(마케팅 정보 수신)
const CONSENT_VERSION = '2026-11-20';
function cleanConsents(c) {
  if (!c || typeof c !== 'object') return null;
  const t = db.now();
  return { version: CONSENT_VERSION, terms: c.terms === true, privacy: c.privacy === true, age: c.age === true,
    marketing: c.marketing === true, agreedAt: t, marketingAt: c.marketing === true ? t : null };
}
const consentOk = (c) => !!(c && c.terms && c.privacy && c.age);
// 로그인 전 이 브라우저에서 쓰던 가게(주인 없음)가 있으면 내 계정으로 가져오기
function claimStore(user, storeId) {
  const s = storeId && db.getStore(storeId);
  if (s && !s.ownerId && !db.storeOf(user.id)) db.updateStore(s.id, { ownerId: user.id });
}
app.post('/api/auth/signup', (req, res) => {
  const loginId = String(req.body?.loginId || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!auth.LOGIN_ID.test(loginId)) return res.status(400).json({ error: '아이디는 영문 소문자·숫자·._@- 로 4~40자로 만들어 주세요.' });
  if (password.length < 8 || password.length > 100) return res.status(400).json({ error: '비밀번호는 8자 이상으로 만들어 주세요.' });
  if (db.findUserByLoginId(loginId)) return res.status(409).json({ error: '이미 있는 아이디예요. 다른 아이디를 써 주세요.' });
  const consents = cleanConsents(req.body?.consents);
  if (!consentOk(consents)) return res.status(400).json({ error: '필수 약관에 동의해야 가입할 수 있어요.', needConsent: true });
  const { salt, hash } = auth.hashPassword(password);
  const user = db.createUser({ loginId, name: String(req.body?.name || '').trim().slice(0, 30), salt, passHash: hash, consents });
  claimStore(user, req.body?.claimStoreId);
  auth.startSession(req, res, user);
  res.status(201).json({ user: userView(user), storeId: db.storeOf(user.id)?.id || null });
});
app.post('/api/auth/login', (req, res) => {
  if (auth.tooMany(req.ip)) return res.status(429).json({ error: '로그인을 너무 많이 틀렸어요. 10분 뒤에 다시 해 주세요.' });
  const user = db.findUserByLoginId(String(req.body?.loginId || '').trim().toLowerCase());
  if (!user || !auth.checkPassword(String(req.body?.password || ''), user)) {
    auth.addFail(req.ip);
    return res.status(401).json({ error: '아이디나 비밀번호가 맞지 않아요.' });
  }
  // 예전 계정이라 동의 기록이 없으면 이번 로그인 때 받은 동의를 남긴다
  if (!consentOk(user.consents)) {
    const consents = cleanConsents(req.body?.consents);
    if (consentOk(consents)) db.updateUser(user.id, { consents });
  }
  claimStore(user, req.body?.claimStoreId);
  auth.startSession(req, res, user);
  res.json({ user: userView(user), storeId: db.storeOf(user.id)?.id || null });
});
app.post('/api/auth/logout', (req, res) => {
  auth.endSession(req, res);
  res.json({ ok: true });
});
// ---------- 관리자 페이지 (앱을 만든 팀용) ----------
// 관리자 비밀번호: 환경변수 ADMIN_PASSWORD (없으면 시연용 1234). 통과하면 2시간짜리 관리자 쿠키.
const ADMIN_COOKIE = 'gg_admin';
const adminTokens = new Map();
const adminPass = () => process.env.ADMIN_PASSWORD || '1234';
function isAdmin(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)gg_admin=([a-f0-9]{64})/);
  const exp = m && adminTokens.get(m[1]);
  return !!(exp && exp > Date.now());
}
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || '';
  if (auth.tooMany('admin:' + ip)) return res.status(429).json({ error: '비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 시도해 주세요.' });
  const a = Buffer.from(String(req.body?.password || ''));
  const b = Buffer.from(adminPass());
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    auth.addFail('admin:' + ip);
    apilog.add({ kind: 'admin', method: 'POST', target: '관리자 로그인 실패', status: 401, ok: false, ms: 0 });
    return res.status(401).json({ error: '관리자 비밀번호가 맞지 않아요.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.set(token, Date.now() + 2 * 3600 * 1000);
  const https = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=7200${https ? '; Secure' : ''}`);
  apilog.add({ kind: 'admin', method: 'POST', target: '관리자 로그인', status: 200, ok: true, ms: 0 });
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)gg_admin=([a-f0-9]{64})/);
  if (m) adminTokens.delete(m[1]);
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Path=/api/admin; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
});
app.use('/api/admin', (req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ error: '관리자 비밀번호를 먼저 입력해 주세요.', needAdmin: true })));
// 아이디 가운데를 가려서 보여줌 (관리자도 필요 이상 보지 않게)
const maskId = (s) => (s.length <= 3 ? s[0] + '**' : s.slice(0, 2) + '*'.repeat(Math.max(2, s.length - 4)) + s.slice(-2));
app.get('/api/admin/summary', (req, res) => {
  const users = db.allUsers();
  const stores = db.allStores();
  const posts = db.allPosts();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const owner = (id) => users.find((u) => u.id === id);
  res.json({
    counts: {
      users: users.length,
      stores: stores.length,
      newThisWeek: stores.filter((s) => (s.createdAt || '') >= weekAgo).length,
      posts: posts.length,
      published: posts.filter((p) => Object.values(p.publications || {}).some((x) => x.status === 'published')).length,
    },
    stores: stores.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((s) => ({
      name: s.name, category: s.category, area: (s.address || '').split(' ').slice(0, 2).join(' '),
      createdAt: s.createdAt, owner: owner(s.ownerId) ? maskId(owner(s.ownerId).loginId) : '-',
      posts: posts.filter((p) => p.storeId === s.id).length,
    })),
  });
});
app.get('/api/admin/logs', (req, res) => {
  const kind = String(req.query.kind || 'all');
  const all = apilog.list();
  const rows = all.filter((x) => kind === 'all' || (kind === 'error' ? !x.ok : x.kind === kind)).slice(0, 300)
    .map((x) => ({ ...x, user: x.user ? maskId(x.user) : '' }));
  const count = (k) => all.filter((x) => x.kind === k).length;
  res.json({ rows, total: all.length, byKind: { app: count('app'), meta: count('meta'), ai: count('ai'), error: all.filter((x) => !x.ok).length } });
});
app.get('/api/admin/consents', (req, res) => {
  res.json({ rows: db.allUsers().slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((u) => ({
    user: maskId(u.loginId), joinedAt: u.createdAt, version: u.consents?.version || '',
    terms: !!u.consents?.terms, privacy: !!u.consents?.privacy, age: !!u.consents?.age,
    agreedAt: u.consents?.agreedAt || '', marketing: !!u.consents?.marketing, marketingAt: u.consents?.marketingAt || '',
  })) });
});

// 여기부터 아래 API는 모두 로그인해야 쓸 수 있음
app.use('/api', (req, res, next) => {
  req.user = auth.currentUser(req);
  if (!req.user) return res.status(401).json({ error: '로그인이 필요해요.', needLogin: true });
  next();
});
// 마케팅 정보 수신 동의는 언제든 바꿀 수 있음 (선택 항목)
app.put('/api/auth/consent', (req, res) => {
  const c = { ...(req.user.consents || {}) };
  if (typeof req.body?.marketing === 'boolean') { c.marketing = req.body.marketing; c.marketingAt = db.now(); }
  const u = db.updateUser(req.user.id, { consents: c });
  res.json({ user: userView(u) });
});
app.get('/api/auth/me', (req, res) => {
  res.json({ user: userView(req.user), storeId: db.storeOf(req.user.id)?.id || null, connections: connections.view() });
});

app.post('/api/stores', (req, res) => {
  const data = cleanStoreInput(req.body || {});
  const missing = validateStore(data);
  if (missing.length) return res.status(400).json({ error: `${missing.join(', ')}을(를) 입력해 주세요.` });
  res.status(201).json(db.createStore({ ...data, ownerId: req.user.id }));
});
app.get('/api/stores/:id', (req, res) => {
  const store = needStore(req, res);
  if (store) res.json(store);
});
app.put('/api/stores/:id', (req, res) => {
  const store = needStore(req, res);
  if (!store) return;
  const data = cleanStoreInput({ ...store, ...req.body });
  const missing = validateStore(data);
  if (missing.length) return res.status(400).json({ error: `${missing.join(', ')}을(를) 입력해 주세요.` });
  res.json(db.updateStore(store.id, data));
});

// 뭘 올릴지 모를 때: 아이디어 3개
app.post('/api/stores/:id/ask', wrap(async (req, res) => {
  const store = needStore(req, res);
  if (!store) return;
  res.json(await llm.answerQuestion(store, req.body?.question, db.listPosts(store.id)));
}));

app.post('/api/stores/:id/ideas', wrap(async (req, res) => {
  const store = needStore(req, res);
  if (!store) return;
  res.json(await llm.generateIdeas(store, db.listPosts(store.id)));
}));

// ---------- 게시물 ----------
function postStatus(p) {
  const pubs = Object.values(p.publications || {});
  const ok = pubs.filter((x) => x.status === 'published').length;
  const fail = pubs.filter((x) => x.status === 'failed').length;
  if (!pubs.length) return 'draft';
  if (ok && !fail) return 'published';
  if (ok && fail) return 'partial';
  if (fail) return 'failed';
  return 'deleted';
}
const withStatus = (p) => ({ ...p, status: postStatus(p) });

function needPost(req, res) {
  const post = db.getPost(req.params.postId);
  if (!post || db.getStore(post.storeId)?.ownerId !== req.user.id) {
    res.status(404).json({ error: '게시물을 찾을 수 없어요.' });
    return null;
  }
  return post;
}

// ---------- SNS 앱에서 직접 지운 게시물 반영 ----------
const SYNC_EVERY_MS = 30 * 1000; // 같은 게시물은 30초에 한 번만 확인
async function syncPost(post, { force = false } = {}) {
  const conns = connections.get();
  const removed = [];
  let changed = false;
  for (const [platform, pub] of Object.entries(post.publications || {})) {
    if (pub.status !== 'published') continue;
    if (!force && pub.checkedAt && Date.now() - pub.checkedAt < SYNC_EVERY_MS) continue;
    const ok = await exists(platform, conns, pub);
    if (ok === false) {
      post.publications[platform] = { ...pub, status: 'deleted', deletedAt: db.now(), deletedBy: 'sns' };
      removed.push({ postId: post.id, topic: post.topic, platform, name: PLATFORM_NAMES[platform] });
      changed = true;
    } else if (ok === true) {
      pub.checkedAt = Date.now();
      changed = true;
    }
  }
  if (changed) db.updatePost(post.id, {});
  return removed;
}

app.get('/api/stores/:id/posts', (req, res) => {
  const store = needStore(req, res);
  if (store) res.json(db.listPosts(store.id).map(withStatus));
});

// 내 게시물 전체 확인 (목록 화면을 연 뒤 뒤에서 부름)
app.post('/api/stores/:id/sync', wrap(async (req, res) => {
  const store = needStore(req, res);
  if (!store) return;
  const removed = [];
  for (const p of db.listPosts(store.id)) removed.push(...(await syncPost(p)));
  res.json({ removed });
}));

// ---------- 반응 화면 (인스타·페이스북·스레드): 좋아요·답글 수 + 답글 내용 ----------
const reactCache = new Map(); // 같은 게시물은 30초 동안 다시 묻지 않음
async function postReactions(post, { fresh = false } = {}) {
  const conns = connections.get();
  const platforms = {};
  const removed = [];
  for (const [platform, pub] of Object.entries(post.publications || {})) {
    if (pub.status !== 'published' || !PLATFORM_NAMES[platform]) continue;
    const key = `${platform}:${pub.id}`;
    const hit = reactCache.get(key);
    let data;
    if (!fresh && hit && Date.now() - hit.at < 30000) data = hit.data;
    else {
      try {
        data = await reactions(platform, conns, pub);
        reactCache.set(key, { at: Date.now(), data });
      } catch (e) {
        if (e.gone) { // SNS 앱에서 지운 게시물
          post.publications[platform] = { ...pub, status: 'deleted', deletedAt: db.now(), deletedBy: 'sns' };
          db.updatePost(post.id, {});
          removed.push({ postId: post.id, topic: post.topic, platform, name: PLATFORM_NAMES[platform] });
          continue;
        }
        data = { error: e.message };
      }
    }
    platforms[platform] = { ...data, url: pub.url, at: pub.at };
  }
  return { platforms, removed };
}

app.get('/api/stores/:id/reactions', wrap(async (req, res) => {
  const store = needStore(req, res);
  if (!store) return;
  const items = [];
  const removed = [];
  for (const post of db.listPosts(store.id)) {
    if (!Object.values(post.publications || {}).some((p) => p.status === 'published')) continue;
    const r = await postReactions(post, { fresh: req.query.refresh === '1' });
    removed.push(...r.removed);
    if (!Object.keys(r.platforms).length) continue;
    const cover = post.images.find((i) => i.id === post.selectedImageIds[0]) || post.images[0];
    const at = Object.values(r.platforms).map((x) => x.at).sort().pop();
    items.push({ postId: post.id, topic: post.topic, at, cover: cover ? `/uploads/${cover.file}` : '', platforms: r.platforms });
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  res.json({ items, removed, fetchedAt: db.now() });
}));

// ---------- AI 피드백: 세 SNS의 반응·댓글을 모아 무엇이 잘 됐는지, 다음엔 뭘 할지 ----------
const LAYOUT_KO = { magazine: '매거진 표지', caption: '캡션 박스', bottom: '사진 + 아래 글', frame: '포스터형', slide: '슬라이드 피드', text: '글자만' };
const EFFECT_KO = { none: '효과 없음', shapes: '문구·도형', doodle: '드로잉', sparkle: '반짝 하이라이트', sticker: '스티커 콜라주' };
// 게시물의 카드 스타일: 새 게시물에서 고른 값, 없으면 표지 카드 이름표("magazine+sparkle")
function postStyle(post) {
  const card = post.images.find((i) => i.kind === 'card');
  const [l, e] = String(card?.label || '').split('+');
  const layout = post.layout || l;
  return { style: LAYOUT_KO[layout] || '기본 카드', effect: EFFECT_KO[post.effect || e] || '효과 없음' };
}
const reactScore = (t) => t.likes + t.comments * 2; // 답글은 좋아요보다 품이 드니 2배

// 가게의 SNS 게시물마다 세 SNS 반응·댓글 모으기 (가게 전체 피드백·게시물별 피드백이 같이 씀)
async function collectReactions(store) {
  const conns = connections.get();
  const posts = [];
  const comments = [];
  const errors = {};
  for (const post of db.listPosts(store.id)) {
    const pubs = Object.entries(post.publications || {}).filter(([, p]) => p.status === 'published' && p.id);
    if (!pubs.length) continue;
    const total = { likes: 0, comments: 0 };
    const byPlatform = {};
    for (const [platform, pub] of pubs) {
      try {
        const r = await reactions(platform, conns, pub); // 반응 화면과 같은 함수: 좋아요·답글 수 + 답글 내용
        byPlatform[PLATFORM_NAMES[platform]] = { likes: r.counts?.likes || 0, comments: r.counts?.comments || 0 };
        total.likes += r.counts?.likes || 0;
        total.comments += r.counts?.comments || 0;
        for (const c of r.comments) if (c.text.trim()) comments.push({ platform, platformName: PLATFORM_NAMES[platform], postId: post.id, topic: post.topic, text: c.text.slice(0, 200), username: c.username, likes: c.likes || 0 });
        if (r.errors.comments || r.errors.counts) errors[platform] = r.errors.comments || r.errors.counts;
      } catch (e) {
        errors[platform] = e.message;
      }
    }
    posts.push({ postId: post.id, topic: post.topic, tone: post.tone, at: pubs[0][1].at || post.createdAt,
      platforms: pubs.map(([p]) => PLATFORM_NAMES[p]), ...postStyle(post), total, byPlatform, score: reactScore(total) });
  }
  posts.sort((a, b) => b.score - a.score);
  comments.sort((a, b) => b.likes - a.likes);
  return { posts, comments, errors };
}

// 가게 전체 피드백: 게시물끼리 비교 (어떤 스타일이 잘 되나, 다음엔 뭘 만들까)
app.post('/api/stores/:id/feedback', wrap(async (req, res) => {
  const store = needStore(req, res);
  if (!store) return;
  const { posts, comments, errors } = await collectReactions(store);
  // 스타일 × 효과별 평균 점수
  const groups = {};
  for (const p of posts) (groups[`${p.style} + ${p.effect}`] ||= []).push(p.score);
  const byStyle = Object.entries(groups)
    .map(([name, s]) => ({ name, count: s.length, avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length) }))
    .sort((a, b) => b.avg - a.avg);
  const data = { posts, byStyle, comments: comments.slice(0, 80) };
  const ai = await llm.generateFeedback(store, data);
  res.json({ posts, byStyle, commentCount: comments.length, errors, ...ai, generatedAt: db.now() });
}));

// 게시물별 피드백: 이 게시물 하나 (SNS별 반응, 이 게시물 댓글, 가게 평균과 비교)
app.post('/api/posts/:postId/feedback', wrap(async (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  const store = db.getStore(post.storeId);
  const { posts, comments, errors } = await collectReactions(store);
  const me = posts.find((p) => p.postId === post.id);
  if (!me) return res.status(400).json({ error: 'SNS에 올라간 게시물만 분석할 수 있어요.' });
  const others = posts.filter((p) => p !== me);
  const avg = others.length ? Math.round(others.reduce((n, p) => n + p.score, 0) / others.length) : null;
  const data = {
    post: { ...me, headline: post.headline || '', caption: (post.captions?.instagram || post.captions?.facebook || post.captions?.threads || '').slice(0, 400) },
    rank: posts.indexOf(me) + 1, totalPosts: posts.length, avg,
    // 평균보다 1.2배 이상이면 좋음, 0.8배 미만이면 아쉬움 (비교할 게시물이 없으면 판단 안 함)
    verdict: avg == null ? '첫 게시물' : me.score >= avg * 1.2 ? '평균보다 좋아요' : me.score < avg * 0.8 ? '평균보다 아쉬워요' : '평균 정도예요',
    comments: comments.filter((c) => c.postId === post.id).slice(0, 50),
  };
  const ai = await llm.generatePostFeedback(store, data);
  res.json({ post: data.post, rank: data.rank, totalPosts: data.totalPosts, avg, verdict: data.verdict,
    commentCount: data.comments.length, errors, ...ai, generatedAt: db.now() });
}));

// 게시물 한 개의 반응 (게시물 화면용)
app.get('/api/posts/:postId/reactions', wrap(async (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  const r = await postReactions(post, { fresh: req.query.refresh === '1' });
  res.json({ ...r, post: withStatus(post) });
}));

app.post('/api/posts/:postId/sync', wrap(async (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  const removed = await syncPost(post, { force: !!req.body?.force });
  res.json({ post: withStatus(post), removed });
}));

app.post('/api/stores/:id/posts', (req, res) => {
  const store = needStore(req, res);
  if (!store) return;
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const topic = s(req.body?.topic, 100);
  if (!topic) return res.status(400).json({ error: '무엇을 홍보할지 적어 주세요.' });
  res.status(201).json(withStatus(db.createPost(store.id, { topic, detail: s(req.body?.detail, 500), tone: s(req.body?.tone, 30),
    layout: LAYOUTS.includes(req.body?.layout) ? req.body.layout : 'magazine', effect: EFFECTS.includes(req.body?.effect) ? req.body.effect : 'none' })));
});

app.get('/api/posts/:postId', (req, res) => {
  const post = needPost(req, res);
  if (post) res.json(withStatus(post));
});

app.put('/api/posts/:postId', (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  const b = req.body || {};
  const data = {};
  if (typeof b.topic === 'string' && b.topic.trim()) data.topic = b.topic.trim().slice(0, 100);
  if (typeof b.detail === 'string') data.detail = b.detail.trim().slice(0, 500);
  if (typeof b.tone === 'string') data.tone = b.tone.slice(0, 30);
  // 고른 카드 문구 (후보 5개 중 하나)
  if (typeof b.headline === 'string') data.headline = b.headline.slice(0, 20);
  if (typeof b.subline === 'string') data.subline = b.subline.slice(0, 30);
  if (typeof b.tag === 'string') data.tag = b.tag.slice(0, 12);
  if (b.captions && typeof b.captions === 'object') {
    data.captions = { ...post.captions };
    for (const k of Object.keys(PLATFORM_NAMES)) if (typeof b.captions[k] === 'string') data.captions[k] = b.captions[k].slice(0, 3000);
  }
  if (Array.isArray(b.selectedImageIds)) {
    const ids = new Set(post.images.map((i) => i.id));
    data.selectedImageIds = b.selectedImageIds.filter((x) => ids.has(x)).slice(0, 10);
  }
  if (Array.isArray(b.platforms)) data.platforms = b.platforms.filter((p) => PLATFORM_NAMES[p]);
  res.json(withStatus(db.updatePost(post.id, data)));
});

// 목록에서 지우기 (SNS에 올라간 게시물은 지워지지 않음)
app.delete('/api/posts/:postId', (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  for (const im of post.images) { try { fs.unlinkSync(path.join(UPLOAD_DIR, im.file)); } catch {} }
  db.deletePost(post.id);
  res.json({ ok: true });
});

// 사진 업로드 (화면에서 JPEG 변환 후 바이너리 전송)
app.post('/api/posts/:postId/images', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '12mb' }), (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: '사진 데이터가 없어요.' });
  if (post.images.length >= 30) return res.status(400).json({ error: '한 게시물에 사진은 30장까지 만들 수 있어요. 안 쓰는 사진을 지워 주세요.' });
  const kind = IMAGE_KINDS.includes(req.query.kind) ? req.query.kind : 'reference';
  if (kind === 'reference' && post.images.filter((i) => i.kind === 'reference').length >= 10) {
    return res.status(400).json({ error: '참고 사진은 10장까지 넣을 수 있어요.' });
  }
  const imgId = db.id();
  const file = `${imgId}.jpg`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), req.body);
  const image = { id: imgId, file, kind, sourceId: typeof req.query.source === 'string' ? req.query.source : null, label: typeof req.query.label === 'string' ? req.query.label.slice(0, 30) : '', at: db.now() };
  post.images.push(image);
  if (req.query.select === '1' && post.selectedImageIds.length < 10) post.selectedImageIds.push(imgId);
  db.updatePost(post.id, {});
  res.json(withStatus(post));
});

app.delete('/api/posts/:postId/images/:imgId', (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  const im = post.images.find((i) => i.id === req.params.imgId);
  if (im) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, im.file)); } catch {}
    post.images = post.images.filter((i) => i !== im);
    post.selectedImageIds = post.selectedImageIds.filter((x) => x !== im.id);
    db.updatePost(post.id, {});
  }
  res.json(withStatus(post));
});

// AI로 문구 + 카드 문구 만들기 (참고 사진을 같이 보여줌)
app.post('/api/posts/:postId/generate', wrap(async (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  const store = db.getStore(post.storeId);
  const refs = post.images
    .filter((i) => i.kind === 'reference')
    .map((i) => ({ buffer: fs.readFileSync(path.join(UPLOAD_DIR, i.file)), mime: 'image/jpeg' }));
  const past = db.listPosts(store.id).filter((p) => p.id !== post.id);
  const out = await llm.generatePost(store, post, refs, past);
  res.json(withStatus(db.updatePost(post.id, {
    headline: out.headline, subline: out.subline, tag: out.tag, cardOptions: out.cardOptions, captions: out.captions, checklist: out.checklist,
    imagePrompt: out.imagePrompt, source: out.source, fallbackReason: out.fallbackReason || null, generatedAt: db.now(),
  })));
}));

// AI 이미지: mode=generate(새로 그리기) | enhance(사진 보정). 결과는 화면에서 JPEG로 바꿔 다시 업로드.
app.post('/api/posts/:postId/ai-image', wrap(async (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  const store = db.getStore(post.storeId);
  const mode = req.body?.mode === 'enhance' ? 'enhance' : 'generate';
  let source = null;
  let prompt;
  if (mode === 'enhance') {
    const im = post.images.find((i) => i.id === req.body?.imageId);
    if (!im) return res.status(400).json({ error: '보정할 사진을 골라 주세요.' });
    source = { buffer: fs.readFileSync(path.join(UPLOAD_DIR, im.file)), mime: 'image/jpeg' };
    prompt = `Enhance this photo for a small business Instagram post (${store.category}). Improve lighting, color balance and sharpness so it looks appetizing and professional, keep the subject and composition the same, do not add any text or logos.`;
  } else {
    prompt = `${post.imagePrompt || `A warm photo for a local ${store.category} shop, featuring ${post.topic}`}. Square-ish 4:5 composition, natural light, realistic photo style, no text, no letters, no logos.`;
  }
  try {
    const img = await llm.generateImage({ prompt, source });
    res.json({ mime: img.mime, data: img.buffer.toString('base64') });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

// ---------- 게시 ----------
app.post('/api/posts/:postId/publish', wrap(async (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  const platforms = (Array.isArray(req.body?.platforms) ? req.body.platforms : []).filter((p) => PLATFORM_NAMES[p]);
  if (!platforms.length) return res.status(400).json({ error: '올릴 곳을 하나 이상 골라 주세요.' });
  if (!connections.checkPin(req.body?.pin)) return res.status(403).json({ error: '게시 PIN이 맞지 않아요.' });
  const photos = post.selectedImageIds
    .map((id) => post.images.find((i) => i.id === id))
    .filter(Boolean)
    .map((i) => ({ ...i, path: path.join(UPLOAD_DIR, i.file) }));
  const conns = connections.get();
  // 공개 주소를 안 넣었어도, 터널 주소(https://….trycloudflare.com 등)로 앱을 열었다면 그 주소를 쓴다
  if (!conns.publicBaseUrl) {
    const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    if (host && !/^(localhost|127\.|192\.168\.|10\.|\[?::1)/.test(host)) {
      const proto = /trycloudflare\.com$/.test(host) ? 'https' : (req.get('x-forwarded-proto') || req.protocol).split(',')[0];
      conns.publicBaseUrl = `${proto}://${host}`;
    }
  }
  const results = [];
  for (const platform of platforms) {
    const text = (post.captions?.[platform] || '').trim();
    const prev = post.publications[platform];
    if (prev?.status === 'published') {
      results.push({ platform, name: PLATFORM_NAMES[platform], ok: false, error: '이미 올린 곳이에요. 게시물 관리에서 확인해 주세요.' });
      continue;
    }
    try {
      if (!text) throw new Error('문구가 비어 있어요.');
      const r = await publish(platform, conns, text, photos);
      post.publications[platform] = { status: 'published', id: r.id, url: r.url, at: db.now() };
      results.push({ platform, name: PLATFORM_NAMES[platform], ok: true, ...r });
    } catch (e) {
      console.error(`[publish:${platform}]`, e.message);
      post.publications[platform] = { status: 'failed', error: e.message, at: db.now() };
      results.push({ platform, name: PLATFORM_NAMES[platform], ok: false, error: e.message });
    }
  }
  post.platforms = platforms;
  db.updatePost(post.id, {});
  res.json({ results, post: withStatus(post) });
}));

// SNS에서 게시물 지우기
app.post('/api/posts/:postId/publications/:platform/delete', wrap(async (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  const platform = req.params.platform;
  const pub = post.publications[platform];
  if (!pub || pub.status !== 'published') return res.status(400).json({ error: '올라간 게시물이 없어요.' });
  if (!connections.checkPin(req.body?.pin)) return res.status(403).json({ error: '게시 PIN이 맞지 않아요.' });
  let deletedBy = 'app';
  try {
    await deletePublication(platform, connections.get(), pub);
  } catch (e) {
    // 이미 SNS 앱에서 지워져 있었다면 오류 대신 정리만 한다
    if (!e.gone && (await exists(platform, connections.get(), pub)) !== false) return res.status(400).json({ error: e.message });
    deletedBy = 'sns';
  }
  post.publications[platform] = { ...pub, status: 'deleted', deletedAt: db.now(), deletedBy };
  db.updatePost(post.id, {});
  res.json(withStatus(post));
}));

// 실패/삭제된 플랫폼 기록 지우기 (다시 올릴 수 있게)
app.post('/api/posts/:postId/publications/:platform/reset', (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  if (post.publications[req.params.platform]?.status !== 'published') delete post.publications[req.params.platform];
  db.updatePost(post.id, {});
  res.json(withStatus(post));
});

// 반응 새로고침
app.post('/api/posts/:postId/metrics', wrap(async (req, res) => {
  const post = needPost(req, res);
  if (!post) return;
  const conns = connections.get();
  const errors = {};
  for (const [platform, pub] of Object.entries(post.publications)) {
    if (pub.status !== 'published') continue;
    try {
      pub.metrics = await fetchMetrics(platform, conns, pub);
      pub.metricsAt = db.now();
    } catch (e) {
      errors[platform] = e.message;
    }
  }
  db.updatePost(post.id, {});
  res.json({ post: withStatus(post), errors });
}));

// ---------- 손님 관리(CRM) ----------
const DAY = 86400000;
// 단골: 댓글 3번 이상 / 신규: 처음 본 지 14일 이내 / 휴면: 30일 넘게 조용 / 나머지: 관심
function segmentOf(c, count) {
  const days = (iso) => (Date.now() - new Date(iso).getTime()) / DAY;
  if (days(c.lastSeen) > 30) return '휴면';
  if (count >= 3) return '단골';
  if (days(c.firstSeen) <= 14) return '신규';
  return '관심';
}
function customerView(c) {
  const acts = db.activitiesOf(c.id);
  return { ...c, count: acts.length, likes: acts.reduce((n, a) => n + (a.likes || 0), 0), lastText: acts[0]?.text || '', segment: segmentOf(c, acts.length) };
}
// 내 가게 손님만
function needCustomer(req, res) {
  const c = db.getCustomer(req.params.customerId);
  if (!c || db.getStore(c.storeId)?.ownerId !== req.user.id) {
    res.status(404).json({ error: '손님 정보를 찾을 수 없어요.' });
    return null;
  }
  return c;
}

// 세 SNS에 올린 게시물의 댓글을 모아 손님 목록 만들기 (반응 화면과 같은 reactions 함수 사용)
app.post('/api/stores/:id/customers/sync', wrap(async (req, res) => {
  const store = needStore(req, res);
  if (!store) return;
  const conns = connections.get();
  const errors = {};
  let added = 0;
  let checked = 0;
  for (const post of db.listPosts(store.id)) {
    for (const [platform, pub] of Object.entries(post.publications || {})) {
      if (pub.status !== 'published' || !pub.id) continue;
      checked++;
      try {
        const r = await reactions(platform, conns, pub);
        if (r.errors.comments) errors[platform] = r.errors.comments;
        // shortcut: 맨 위 댓글만 손님으로 셈 (답글에는 가게 계정이 단 답이 섞여서). 가게 계정 이름을 알게 되면 답글도 포함
        for (const c of r.comments) {
          const handle = c.username === 'Facebook 사용자' ? '' : c.username; // 페이스북은 권한 없으면 이름이 안 와서 누군지 모름
          if (db.recordComment(store.id, post.id, platform, { id: c.id, handle, text: c.text, likes: c.likes || 0, at: c.at || db.now() })) added++;
        }
      } catch (e) {
        errors[platform] = e.message;
      }
    }
  }
  db.save();
  res.json({ added, checked, errors });
}));

app.get('/api/stores/:id/customers', (req, res) => {
  const store = needStore(req, res);
  if (!store) return;
  res.json(db.listCustomers(store.id).map(customerView).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)));
});

app.get('/api/customers/:customerId', (req, res) => {
  const c = needCustomer(req, res);
  if (!c) return;
  const topic = (postId) => db.getPost(postId)?.topic || '(지운 게시물)';
  res.json({ ...customerView(c), activities: db.activitiesOf(c.id).map((a) => ({ ...a, postTopic: topic(a.postId) })) });
});

app.put('/api/customers/:customerId', (req, res) => {
  const c = needCustomer(req, res);
  if (!c) return;
  if (typeof req.body?.memo === 'string') db.updateCustomer(c.id, { memo: req.body.memo.slice(0, 1000) });
  res.json(customerView(db.getCustomer(c.id)));
});

app.delete('/api/customers/:customerId', (req, res) => {
  const c = needCustomer(req, res);
  if (!c) return;
  db.forgetCustomer(c.id);
  res.json({ ok: true });
});

// ---------- SNS 연결 ----------
app.get('/api/connections', (req, res) => res.json(connections.view()));
app.put('/api/connections', (req, res) => {
  connections.update(req.body || {});
  res.json(connections.view());
});
app.post('/api/connections/:platform/test', wrap(async (req, res) => {
  try {
    res.json({ ok: true, message: await testConnection(req.params.platform, connections.get()) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`같이가게 서버 실행: http://localhost:${PORT}`);
  console.log(`LLM: ${llm.providerName()} (${llm.modelName()})${llm.providerName() === 'mock' ? '  ← API 키가 없어 데모 모드로 실행 중' : ''}`);
});
