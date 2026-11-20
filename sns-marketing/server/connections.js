// SNS 연결 정보(토큰 등) 저장소. data/connections.json 에 저장되며 .gitignore로 제외됨.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'connections.json');
let conns = { facebook: {}, instagram: {}, threads: {}, publicBaseUrl: '' };

function load() {
  try {
    if (fs.existsSync(FILE)) conns = { ...conns, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch (e) {
    console.error('[connections] 읽기 실패:', e.message);
  }
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(conns, null, 2));
}

function get() {
  return conns;
}

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

function update(body) {
  if (body.facebook) {
    conns.facebook = {
      pageId: clean(body.facebook.pageId) || conns.facebook.pageId || '',
      token: clean(body.facebook.token) || conns.facebook.token || '',
    };
  }
  if (body.instagram) {
    conns.instagram = {
      token: clean(body.instagram.token) || conns.instagram.token || '',
      igUserId: clean(body.instagram.igUserId) || conns.instagram.igUserId || '',
    };
  }
  if (body.threads) {
    conns.threads = { token: clean(body.threads.token) || conns.threads.token || '' };
  }
  if (typeof body.publicBaseUrl === 'string') {
    conns.publicBaseUrl = clean(body.publicBaseUrl).replace(/\/+$/, '');
  }
  if (body.disconnect && conns[body.disconnect]) conns[body.disconnect] = {};
  save();
}

const mask = (t) => (t ? `${t.slice(0, 4)}…${t.slice(-4)}` : '');

// 화면에 보여줄 때는 토큰을 가린다
function view() {
  return {
    facebook: { connected: !!(conns.facebook.token && conns.facebook.pageId), pageId: conns.facebook.pageId || '', token: mask(conns.facebook.token) },
    instagram: { connected: !!conns.instagram.token, igUserId: conns.instagram.igUserId || '', token: mask(conns.instagram.token) },
    threads: { connected: !!conns.threads.token, token: mask(conns.threads.token) },
    publicBaseUrl: conns.publicBaseUrl || '',
  };
}

module.exports = { load, get, update, view };
