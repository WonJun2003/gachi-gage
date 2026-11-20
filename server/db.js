// 아주 단순한 JSON 파일 저장소 (해커톤 MVP용)
// 나중에 SQLite/PostgreSQL 등으로 바꿀 때 이 파일만 교체하면 되도록 함수로 감싸 둠.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = { stores: [], posts: [], users: [], sessions: [], customers: [], activities: [], forgotten: [] };

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db.stores = raw.stores || [];
      db.posts = raw.posts || [];
      db.users = raw.users || [];
      db.sessions = raw.sessions || [];
      db.customers = raw.customers || [];
      db.activities = raw.activities || [];
      db.forgotten = raw.forgotten || [];
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

// ---------- 사용자·로그인 세션 ----------
// user = { id, loginId, name, passHash, salt, createdAt } / session = { token, userId, expiresAt }
function createUser(data) {
  const user = { id: id(), ...data, createdAt: now() };
  db.users.push(user);
  save();
  return user;
}
const getUser = (userId) => db.users.find((u) => u.id === userId) || null;
const allUsers = () => db.users;
const allStores = () => db.stores;
const allPosts = () => db.posts;
function updateUser(userId, data) {
  const u = getUser(userId);
  if (!u) return null;
  Object.assign(u, data);
  save();
  return u;
}
const findUserByLoginId = (loginId) => db.users.find((u) => u.loginId === loginId) || null;
function addSession(s) {
  const t = now();
  db.sessions = db.sessions.filter((x) => x.expiresAt > t); // 만료된 세션 정리
  db.sessions.push(s);
  save();
}
const getSession = (token) => db.sessions.find((s) => s.token === token) || null;
function deleteSession(token) {
  db.sessions = db.sessions.filter((s) => s.token !== token);
  save();
}
// ---------- 손님(CRM): 게시물에 댓글을 단 사람 ----------
// customer = { id, storeId, platform, handle, firstSeen, lastSeen, memo }
// activity = { id, storeId, customerId, postId, platform, extId(SNS 댓글 id), text, likes, at }
// forgotten = [{ storeId, platform, handle }]  사장님이 지운 손님은 다시 모으지 않음
const sameCust = (a, storeId, platform, handle) => a.storeId === storeId && a.platform === platform && a.handle === handle;
// 댓글 하나 기록. 새로 넣었으면 true (save는 부르는 쪽에서 한 번에)
function recordComment(storeId, postId, platform, c) {
  if (!c.handle || db.forgotten.some((f) => sameCust(f, storeId, platform, c.handle))) return false;
  const old = db.activities.find((a) => a.storeId === storeId && a.platform === platform && a.extId === c.id);
  if (old) { old.likes = c.likes; old.text = c.text; return false; }
  let cust = db.customers.find((x) => sameCust(x, storeId, platform, c.handle));
  if (!cust) {
    cust = { id: id(), storeId, platform, handle: c.handle, firstSeen: c.at, lastSeen: c.at, memo: '' };
    db.customers.push(cust);
  }
  if (c.at < cust.firstSeen) cust.firstSeen = c.at;
  if (c.at > cust.lastSeen) cust.lastSeen = c.at;
  db.activities.push({ id: id(), storeId, customerId: cust.id, postId, platform, extId: c.id, text: c.text, likes: c.likes, at: c.at });
  return true;
}
const listCustomers = (storeId) => db.customers.filter((c) => c.storeId === storeId);
const getCustomer = (customerId) => db.customers.find((c) => c.id === customerId) || null;
const activitiesOf = (customerId) => db.activities.filter((a) => a.customerId === customerId).sort((a, b) => b.at.localeCompare(a.at));
function updateCustomer(customerId, data) {
  const c = getCustomer(customerId);
  if (!c) return null;
  Object.assign(c, data);
  save();
  return c;
}
// 손님과 그 댓글 기록을 지우고, 다음에 댓글을 모아도 다시 넣지 않음 (개인정보 삭제 요청 대응)
function forgetCustomer(customerId) {
  const c = getCustomer(customerId);
  if (!c) return null;
  db.customers = db.customers.filter((x) => x.id !== customerId);
  db.activities = db.activities.filter((a) => a.customerId !== customerId);
  db.forgotten.push({ storeId: c.storeId, platform: c.platform, handle: c.handle });
  save();
  return c;
}

// 내 가게 (여러 개면 가장 최근 것)
const storeOf = (userId) => db.stores.filter((s) => s.ownerId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;

module.exports = {
  load, save, id, now,
  createUser, getUser, updateUser, allUsers, allStores, allPosts, findUserByLoginId, addSession, getSession, deleteSession, storeOf,
  recordComment, listCustomers, getCustomer, activitiesOf, updateCustomer, forgetCustomer,
  createStore, getStore, updateStore,
  createPost, getPost, listPosts, updatePost, deletePost,
};
