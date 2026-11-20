// 아주 단순한 JSON 파일 저장소 (해커톤 MVP용)
// 나중에 SQLite/PostgreSQL 등으로 바꿀 때 이 파일만 교체하면 되도록 함수로 감싸 둠.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = { stores: [], posts: [] };

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db.stores = raw.stores || [];
      db.posts = raw.posts || [];
    }
  } catch (e) {
    console.error('[db] db.json 읽기 실패, 빈 DB로 시작합니다:', e.message);
  }
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ---------- 가게 ----------
function createStore(data) {
  const store = { id: id(), ...data, createdAt: now(), updatedAt: now() };
  db.stores.push(store);
  save();
  return store;
}
function getStore(storeId) {
  return db.stores.find((s) => s.id === storeId) || null;
}
function updateStore(storeId, data) {
  const s = getStore(storeId);
  if (!s) return null;
  Object.assign(s, data, { updatedAt: now() });
  save();
  return s;
}

// ---------- 게시물 ----------
// post = {
//   id, storeId, topic, detail, tone,
//   images: [{ id, file, kind: 'reference'|'enhanced'|'card'|'ai', sourceId, label }],
//   selectedImageIds: [],                         // 올릴 사진 (순서대로)
//   captions: { instagram, facebook, threads },  // 플랫폼별 최종 문구
//   headline, subline,                            // 홍보 카드용 짧은 문구
//   checklist: [], source,                        // AI 결과 정보
//   platforms: [],                                // 마지막으로 고른 플랫폼
//   publications: { instagram: { status, id, url, at, error, metrics } ... },
// }
function createPost(storeId, data) {
  const post = {
    id: id(), storeId, topic: '', detail: '', tone: '',
    images: [], selectedImageIds: [], captions: {}, headline: '', subline: '',
    checklist: [], platforms: [], publications: {},
    ...data, createdAt: now(), updatedAt: now(),
  };
  db.posts.push(post);
  save();
  return post;
}
function getPost(postId) {
  return db.posts.find((p) => p.id === postId) || null;
}
function listPosts(storeId) {
  return db.posts.filter((p) => p.storeId === storeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function updatePost(postId, data) {
  const p = getPost(postId);
  if (!p) return null;
  Object.assign(p, data, { updatedAt: now() });
  save();
  return p;
}
function deletePost(postId) {
  const p = getPost(postId);
  db.posts = db.posts.filter((x) => x.id !== postId);
  save();
  return p;
}

module.exports = {
  load, save, id, now,
  createStore, getStore, updateStore,
  createPost, getPost, listPosts, updatePost, deletePost,
};
