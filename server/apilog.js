// API 사용 기록 (관리자 페이지용). 토큰·비밀번호·요청 내용은 남기지 않고, 무엇을 언제 불렀는지와 결과만 남긴다.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'apilog.json');
const MAX = 1000;
let logs = [];
try { if (fs.existsSync(FILE)) logs = JSON.parse(fs.readFileSync(FILE, 'utf8')) || []; } catch { logs = []; }

let timer = null;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(logs)); } catch {}
  }, 1500);
}

// kind: app(우리 서버 API) | meta(인스타·페이스북·스레드) | ai(Gemini·Groq)
function add(e) {
  logs.unshift({ at: new Date().toISOString(), ...e });
  if (logs.length > MAX) logs.length = MAX;
  persist();
}
const list = () => logs;

// 외부 API 주소에서 플랫폼·경로만 남기기 (쿼리스트링=토큰은 버림)
function metaTarget(url) {
  try {
    const u = new URL(url);
    const platform = /threads/.test(u.host) ? 'threads' : /instagram/.test(u.host) ? 'instagram' : 'facebook';
    return { platform, target: u.pathname.replace(/^\/v[\d.]+/, '') };
  } catch { return { platform: '', target: '' }; }
}

module.exports = { add, list, metaTarget };
