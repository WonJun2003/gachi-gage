require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('./db');
const llm = require('./llm');
const connections = require('./connections');
const { publish, testConnection, deletePublication, fetchMetrics } = require('./publish');

db.load();
connections.load();
const app = express();
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use(express.json({ limit: '300kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// 업로드한 사진 (인스타·스레드는 이 주소로 Meta가 사진을 가져감)
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));

const PLATFORM_NAMES = { instagram: '인스타그램', facebook: '페이스북', threads: '스레드' };
const TONES = ['친근하게', '깔끔하게 정보 위주로', '이벤트 느낌으로', '감성적으로', '고급스럽게'];
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
  };
}
function validateStore(d) {
  const missing = [];
  if (!d.name) missing.push('가게 이름');
  if (!d.category) missing.push('업종');
  if (!d.address) missing.push('주소');
  return missing;
}
function needStore(req, res) {
  const store = db.getStore(req.params.id);
  if (!store) res.status(404).json({ error: '가게 정보를 찾을 수 없어요.' });
  return store;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, provider: llm.providerName(), model: llm.modelName(), tones: TONES, connections: connections.view() });
});

app.post('/api/stores', (req, res) => {
  const data = cleanStoreInput(req.body || {});
  const missing = validateStore(data);
  if (missing.length) return res.status(400).json({ error: `${missing.join(', ')}을(를) 입력해 주세요.` });
  res.status(201).json(db.createStore(data));
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
  if (!post) res.status(404).json({ error: '게시물을 찾을 수 없어요.' });
  return post;
}

app.get('/api/stores/:id/posts', (req, res) => {
  const store = needStore(req, res);
  if (store) res.json(db.listPosts(store.id).map(withStatus));
});

app.post('/api/stores/:id/posts', (req, res) => {
  const store = needStore(req, res);
  if (!store) return;
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const topic = s(req.body?.topic, 100);
  if (!topic) return res.status(400).json({ error: '무엇을 홍보할지 적어 주세요.' });
  res.status(201).json(withStatus(db.createPost(store.id, { topic, detail: s(req.body?.detail, 500), tone: s(req.body?.tone, 30) })));
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
    headline: out.headline, subline: out.subline, captions: out.captions, checklist: out.checklist,
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
  const photos = post.selectedImageIds
    .map((id) => post.images.find((i) => i.id === id))
    .filter(Boolean)
    .map((i) => ({ ...i, path: path.join(UPLOAD_DIR, i.file) }));
  const conns = connections.get();
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
  try {
    await deletePublication(platform, connections.get(), pub);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  post.publications[platform] = { ...pub, status: 'deleted', deletedAt: db.now() };
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
