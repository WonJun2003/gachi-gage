// 인스타그램 / 페이스북 페이지 / 스레드 게시 (Meta 공식 API)
// - 페이스북: 사진 파일을 직접 업로드 → 공개 주소 없어도 됨
// - 인스타그램, 스레드: Meta 서버가 사진을 "주소로 가져가는" 방식 → 공개 주소(PUBLIC_BASE_URL, 터널 등) 필요
const fs = require('fs');

const VER = () => process.env.META_GRAPH_VERSION || 'v25.0';
const FB = () => process.env.META_FB_HOST || 'https://graph.facebook.com';
const IG = () => process.env.META_IG_HOST || 'https://graph.instagram.com';
const TH = () => process.env.META_THREADS_HOST || 'https://graph.threads.net';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function friendlyError(data, status) {
  const e = data?.error || {};
  let msg = e.error_user_msg || e.message || `요청 실패 (HTTP ${status})`;
  // 게시물이 이미 없어진 경우 (앱에서 직접 지운 경우 등)
  const gone = status === 404 || e.error_subcode === 33 || (e.code === 100 && /does not exist/i.test(e.message || ''));
  if (gone) {
    const err = new Error('이 게시물은 이미 지워졌어요.');
    err.status = status;
    err.gone = true;
    return err;
  }
  if (e.code === 190) msg = `토큰이 만료됐거나 올바르지 않아요. '계정 연결' 메뉴에서 토큰을 다시 넣어 주세요. (${e.message || ''})`;
  if (e.code === 10 || e.code === 200) msg = `권한이 부족해요. 토큰을 만들 때 게시 권한을 체크했는지 확인해 주세요. (${e.message || ''})`;
  const err = new Error(msg);
  err.status = status;
  return err;
}

const apilog = require('./apilog');
function logMeta(method, url, status, ok, t0, err) {
  const { platform, target } = apilog.metaTarget(url);
  apilog.add({ kind: 'meta', platform, method, target, status, ok, ms: Date.now() - t0, ...(err ? { note: String(err).slice(0, 120) } : {}) });
}

async function call(method, url, params = {}, formData, timeoutMs) {
  const t0 = Date.now();
  try {
    const out = await callRaw(method, url, params, formData, timeoutMs);
    logMeta(method, url, 200, true, t0);
    return out;
  } catch (e) {
    logMeta(method, url, e.status || 0, false, t0, e.message);
    throw e;
  }
}
async function callRaw(method, url, params = {}, formData, timeoutMs) {
  let res;
  if (method === 'GET') {
    const qs = new URLSearchParams(params).toString();
    res = await fetch(`${url}?${qs}`, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {});
  } else if (formData) {
    res = await fetch(url, { method: 'POST', body: formData });
  } else {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw friendlyError(data, res.status);
  return data;
}

// 컨테이너가 처리 완료될 때까지 대기 (인스타: status_code, 스레드: status)
async function waitReady(base, containerId, token, field) {
  for (let i = 0; i < 20; i++) {
    const d = await call('GET', `${base}/${containerId}`, { fields: field, access_token: token });
    const s = d[field];
    if (!s || s === 'FINISHED' || s === 'PUBLISHED') return;
    if (s === 'ERROR' || s === 'EXPIRED') throw new Error(`사진 처리에 실패했어요 (${s}${d.error_message ? `: ${d.error_message}` : ''}). 사진 비율이나 공개 주소를 확인해 주세요.`);
    await sleep(i < 3 ? 1000 : 2000);
  }
  throw new Error('사진 처리가 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.');
}

// 공개 주소로 사진이 실제로 열리는지 먼저 확인 (터널이 꺼졌거나 주소가 바뀐 경우를 바로 알려 주려고)
async function checkReachable(url) {
  let res;
  try {
    res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new Error(`공개 주소로 사진이 열리지 않아요 (${url.split('/uploads/')[0]}). tunnel.bat 창이 켜져 있는지, 주소가 지금 터널 창에 나온 주소와 같은지 확인해 주세요.`);
  }
  if (!res.ok) throw new Error(`공개 주소로 사진을 열었더니 오류가 났어요 (HTTP ${res.status}). 터널 주소가 바뀌었는지 확인해 주세요.`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) throw new Error(`공개 주소가 사진 대신 다른 페이지를 보여줘요 (${ct}). 터널 주소를 다시 확인해 주세요.`);
}
async function retryFetchFail(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!/가져올 수 없|download|9004/i.test(e.message)) throw e;
    await sleep(5000);
    return fn();
  }
}

function photoUrls(photos, publicBaseUrl, platformName) {
  if (!photos.length) return [];
  if (!publicBaseUrl) {
    throw new Error(`${platformName}에 사진을 올리려면 '계정 연결' 메뉴에서 공개 주소(터널 주소)를 먼저 넣어 주세요. Meta 서버가 사진을 가져가야 해서 localhost로는 안 돼요.`);
  }
  if (/localhost|127\.0\.0\.1|192\.168\.|10\.\d+\./.test(publicBaseUrl)) {
    throw new Error('공개 주소에 localhost나 내부 IP는 쓸 수 없어요. 터널(cloudflared 등)로 만든 https 주소를 넣어 주세요.');
  }
  return photos.map((p) => `${publicBaseUrl}/uploads/${p.file}`);
}

// ---------- 페이스북 페이지 ----------
async function postFacebook(conn, text, photos) {
  const { pageId, token } = conn;
  if (!pageId || !token) throw new Error('페이스북 페이지가 연결되지 않았어요.');
  const base = `${FB()}/${VER()}`;
  const uploadPhoto = async (p, published, caption) => {
    const fd = new FormData();
    fd.append('source', new Blob([fs.readFileSync(p.path)], { type: 'image/jpeg' }), 'photo.jpg');
    fd.append('published', String(published));
    if (caption) fd.append('caption', caption);
    fd.append('access_token', token);
    return call('POST', `${base}/${pageId}/photos`, {}, fd);
  };

  let postId;
  if (!photos.length) {
    postId = (await call('POST', `${base}/${pageId}/feed`, { message: text, access_token: token })).id;
  } else if (photos.length === 1) {
    const r = await uploadPhoto(photos[0], true, text);
    postId = r.post_id || r.id;
  } else {
    const ids = [];
    for (const p of photos) ids.push((await uploadPhoto(p, false)).id);
    const params = { message: text, access_token: token };
    ids.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
    postId = (await call('POST', `${base}/${pageId}/feed`, params)).id;
  }
  return { id: postId, url: `https://www.facebook.com/${postId}` };
}

// ---------- 인스타그램 ----------
const igBase = (token) => (token.startsWith('IG') ? `${IG()}/${VER()}` : `${FB()}/${VER()}`);

// 인스타그램 계정 ID 찾기: IG 토큰은 /me, 페이스북 로그인(EAA) 토큰은 연결된 페이지의 instagram_business_account
async function findIgUserId(token) {
  if (token.startsWith('IG')) {
    const me = await call('GET', `${IG()}/${VER()}/me`, { fields: 'user_id,username', access_token: token });
    return me.user_id || me.id;
  }
  const d = await call('GET', `${FB()}/${VER()}/me/accounts`, { fields: 'instagram_business_account', access_token: token });
  const hit = (d.data || []).find((p) => p.instagram_business_account?.id);
  if (!hit) throw new Error('이 토큰으로 연결된 인스타그램 비즈니스 계정을 찾지 못했어요. 인스타그램 계정 ID(INSTAGRAM_USER_ID)를 직접 넣어 주세요.');
  return hit.instagram_business_account.id;
}
async function postInstagram(conn, text, photos, publicBaseUrl) {
  const { token } = conn;
  if (!token) throw new Error('인스타그램이 연결되지 않았어요.');
  if (!photos.length) throw new Error('인스타그램은 사진이 꼭 있어야 올릴 수 있어요. 사진을 1장 이상 넣어 주세요.');
  if (photos.length > 10) throw new Error('인스타그램은 한 번에 사진 10장까지 올릴 수 있어요.');
  if (text.length > 2200) throw new Error('인스타그램 문구는 2,200자까지예요.');
  const urls = photoUrls(photos, publicBaseUrl, '인스타그램');

  // 'IG'로 시작하는 토큰 = 인스타그램 로그인 방식(graph.instagram.com), 아니면 페이스북 로그인 방식(graph.facebook.com + IG 사용자 ID)
  const igLogin = token.startsWith('IG');
  const base = igLogin ? `${IG()}/${VER()}` : `${FB()}/${VER()}`;
  let igId = conn.igUserId;
  if (!igId) igId = await findIgUserId(token);

  await checkReachable(urls[0]);

  let creationId;
  if (urls.length === 1) {
    // 새로 만든 터널 주소는 Meta 쪽에서 바로 못 찾을 때가 있어서 한 번 더 시도
    creationId = (await retryFetchFail(() => call('POST', `${base}/${igId}/media`, { image_url: urls[0], caption: text, access_token: token }))).id;
  } else {
    const children = [];
    for (const u of urls) {
      const c = (await call('POST', `${base}/${igId}/media`, { image_url: u, is_carousel_item: 'true', access_token: token })).id;
      await waitReady(base, c, token, 'status_code');
      children.push(c);
    }
    creationId = (await call('POST', `${base}/${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: text, access_token: token })).id;
  }
  await waitReady(base, creationId, token, 'status_code');
  let mediaId;
  try {
    mediaId = (await call('POST', `${base}/${igId}/media_publish`, { creation_id: creationId, access_token: token })).id;
  } catch (e) {
    // 인스타그램은 '활동 제한' 같은 오류를 돌려주면서도 실제로는 올려 둘 때가 있어서, 정말 올라갔는지 확인한다
    mediaId = await findPublished(base, igId, creationId, text, token);
    if (!mediaId) {
      if (/보호|제한|block|restrict|spam/i.test(e.message)) {
        throw new Error('인스타그램이 계정 보호를 위해 잠시 게시를 막았어요. 짧은 시간에 여러 번 올리거나 지우면 생겨요. 몇 시간 뒤에 한 번만 다시 시도해 주세요.');
      }
      throw e;
    }
  }
  let url = '';
  try {
    url = (await call('GET', `${base}/${mediaId}`, { fields: 'permalink', access_token: token })).permalink || '';
  } catch {}
  return { id: mediaId, url };
}

// media_publish가 오류를 냈을 때: 컨테이너가 PUBLISHED이거나, 방금 올린 같은 문구의 게시물이 있으면 그 ID를 돌려준다
async function findPublished(base, igId, creationId, text, token) {
  const head = text.trim().slice(0, 40);
  for (let i = 0; i < 3; i++) {
    await sleep(2500);
    try {
      const st = await call('GET', `${base}/${creationId}`, { fields: 'status_code', access_token: token });
      const recent = await call('GET', `${base}/${igId}/media`, { fields: 'id,caption,timestamp', limit: '5', access_token: token });
      const fresh = (recent.data || []).find((m) => Date.now() - new Date(m.timestamp).getTime() < 10 * 60 * 1000 && (m.caption || '').trim().startsWith(head));
      if (fresh) return fresh.id;
      if (st.status_code === 'PUBLISHED' && recent.data?.[0]) return recent.data[0].id;
    } catch {}
  }
  return null;
}

// ---------- 스레드 ----------
async function postThreads(conn, text, photos, publicBaseUrl) {
  const { token } = conn;
  if (!token) throw new Error('스레드가 연결되지 않았어요.');
  if (text.length > 500) throw new Error(`스레드는 글자 수가 500자까지예요. (지금 ${text.length}자) 문구를 줄여 주세요.`);
  if (photos.length > 20) throw new Error('스레드는 사진 20장까지 올릴 수 있어요.');
  const base = `${TH()}/v1.0`;
  const urls = photoUrls(photos, publicBaseUrl, '스레드');

  let creationId;
  if (!urls.length) {
    creationId = (await call('POST', `${base}/me/threads`, { media_type: 'TEXT', text, access_token: token })).id;
  } else if (urls.length === 1) {
    creationId = (await call('POST', `${base}/me/threads`, { media_type: 'IMAGE', image_url: urls[0], text, access_token: token })).id;
  } else {
    const children = [];
    for (const u of urls) {
      children.push((await call('POST', `${base}/me/threads`, { media_type: 'IMAGE', image_url: u, is_carousel_item: 'true', access_token: token })).id);
    }
    for (const c of children) await waitReady(base, c, token, 'status');
    creationId = (await call('POST', `${base}/me/threads`, { media_type: 'CAROUSEL', children: children.join(','), text, access_token: token })).id;
  }
  await waitReady(base, creationId, token, 'status');
  const postId = (await call('POST', `${base}/me/threads_publish`, { creation_id: creationId, access_token: token })).id;
  let url = '';
  try {
    url = (await call('GET', `${base}/${postId}`, { fields: 'permalink', access_token: token })).permalink || '';
  } catch {}
  return { id: postId, url };
}

// ---------- 연결 테스트 ----------
async function testConnection(platform, conns) {
  if (platform === 'facebook') {
    const { pageId, token } = conns.facebook;
    if (!pageId || !token) throw new Error('페이지 ID와 토큰을 모두 넣어 주세요.');
    const d = await call('GET', `${FB()}/${VER()}/${pageId}`, { fields: 'name', access_token: token });
    return `페이스북 페이지 '${d.name}' 연결 확인`;
  }
  if (platform === 'instagram') {
    const { token, igUserId } = conns.instagram;
    if (!token) throw new Error('토큰을 넣어 주세요.');
    if (token.startsWith('IG')) {
      const d = await call('GET', `${IG()}/${VER()}/me`, { fields: 'user_id,username', access_token: token });
      return `인스타그램 @${d.username} 연결 확인`;
    }
    const id = igUserId || (await findIgUserId(token));
    const d = await call('GET', `${FB()}/${VER()}/${id}`, { fields: 'username', access_token: token });
    return `인스타그램 @${d.username} 연결 확인`;
  }
  if (platform === 'threads') {
    const { token } = conns.threads;
    if (!token) throw new Error('토큰을 넣어 주세요.');
    const d = await call('GET', `${TH()}/v1.0/me`, { fields: 'username', access_token: token });
    return `스레드 @${d.username} 연결 확인`;
  }
  throw new Error('알 수 없는 플랫폼');
}

// ---------- 게시물 삭제 ----------
async function callDelete(url, token) {
  const t0 = Date.now();
  const res = await fetch(`${url}?access_token=${encodeURIComponent(token)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  const ok = res.ok && !data.error;
  logMeta('DELETE', url, res.status, ok, t0, ok ? '' : data.error?.message);
  if (!ok) throw friendlyError(data, res.status);
  return data;
}

async function deletePublication(platform, conns, pub) {
  if (platform === 'instagram') {
    // 2025년 12월부터 페이스북 로그인 방식 토큰 + instagram_manage_contents 권한으로 삭제 가능
    const { token } = conns.instagram;
    if (!token) throw new Error('인스타그램이 연결되지 않았어요.');
    if (token.startsWith('IG')) throw new Error('지금 연결 방식(인스타그램 로그인 토큰)으로는 Meta가 삭제를 지원하지 않아요. "보기"를 눌러 인스타그램 앱에서 직접 지워 주세요.');
    try {
      const d = await callDelete(`${FB()}/${VER()}/${pub.id}`, token);
      if (d.success === false) throw new Error('인스타그램이 삭제를 끝내지 못했어요. 인스타그램 앱에서 확인해 주세요.');
    } catch (e) {
      if (!e.gone && /권한/.test(e.message)) throw new Error(`삭제 권한이 없어요. 토큰을 만들 때 instagram_manage_contents 권한을 추가하거나, 인스타그램 앱에서 직접 지워 주세요. (${e.message})`);
      throw e;
    }
    return;
  }
  if (platform === 'facebook') {
    await callDelete(`${FB()}/${VER()}/${pub.id}`, conns.facebook.token);
    return;
  }
  if (platform === 'threads') {
    try {
      await callDelete(`${TH()}/v1.0/${pub.id}`, conns.threads.token);
    } catch (e) {
      if (/permission|권한/i.test(e.message)) throw new Error(`스레드 삭제 권한(threads_delete)이 없어요. 토큰을 만들 때 threads_delete를 추가해 주세요. (${e.message})`);
      throw e;
    }
    return;
  }
  throw new Error('알 수 없는 플랫폼');
}

// ---------- 반응: 모든 플랫폼에서 '좋아요'와 '답글' 두 가지만 ----------
// 권한 부족(10, 200)은 어떤 권한이 필요한지 알려 준다
function permHint(e, perm) {
  if (e && !e.gone && /권한|permission/i.test(e.message)) return `${perm} 권한이 필요해요. 토큰을 만들 때 ${perm}을 체크했는지 확인해 주세요.`;
  return e?.message || '불러오지 못했어요.';
}
const NEED = {
  instagram: { comments: 'instagram_manage_comments' },
  facebook: { counts: 'pages_read_engagement', comments: 'pages_read_user_content' },
  threads: { counts: 'threads_manage_insights', comments: 'threads_read_replies' },
};

// 좋아요·답글 수
async function fetchCounts(platform, conns, pub) {
  if (platform === 'instagram') {
    const { token } = conns.instagram;
    const d = await call('GET', `${igBase(token)}/${pub.id}`, { fields: 'like_count,comments_count,permalink', access_token: token });
    return { likes: d.like_count ?? 0, comments: d.comments_count ?? 0, permalink: d.permalink || '' };
  }
  if (platform === 'facebook') {
    const d = await call('GET', `${FB()}/${VER()}/${pub.id}`, {
      fields: 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),permalink_url',
      access_token: conns.facebook.token,
    });
    return { likes: d.reactions?.summary?.total_count ?? 0, comments: d.comments?.summary?.total_count ?? 0, permalink: d.permalink_url || '' };
  }
  if (platform === 'threads') {
    const d = await call('GET', `${TH()}/v1.0/${pub.id}/insights`, { metric: 'likes,replies', access_token: conns.threads.token });
    const m = {};
    for (const it of d.data || []) m[it.name] = it.values?.[0]?.value ?? it.total_value?.value ?? 0;
    return { likes: m.likes ?? 0, comments: m.replies ?? 0, permalink: '' };
  }
  throw new Error('알 수 없는 플랫폼');
}

// 답글(댓글) 내용 최신 50개 + 그 아래 답글
async function fetchComments(platform, conns, pub) {
  if (platform === 'instagram') {
    const { token } = conns.instagram;
    const c = await call('GET', `${igBase(token)}/${pub.id}/comments`, {
      fields: 'id,text,username,timestamp,like_count,replies{id,text,username,timestamp}', limit: '50', access_token: token,
    });
    return (c.data || []).map((x) => ({
      id: x.id, text: x.text || '', username: x.username || '', at: x.timestamp || '', likes: x.like_count ?? 0,
      replies: (x.replies?.data || []).map((r) => ({ id: r.id, text: r.text || '', username: r.username || '', at: r.timestamp || '' })),
    }));
  }
  if (platform === 'facebook') {
    const c = await call('GET', `${FB()}/${VER()}/${pub.id}/comments`, {
      fields: 'id,message,from{name},created_time,like_count,comments.limit(20){id,message,from{name},created_time}',
      order: 'reverse_chronological', filter: 'toplevel', limit: '50', access_token: conns.facebook.token,
    });
    return (c.data || []).map((x) => ({
      id: x.id, text: x.message || '', username: x.from?.name || 'Facebook 사용자', at: x.created_time || '', likes: x.like_count ?? 0,
      replies: (x.comments?.data || []).map((r) => ({ id: r.id, text: r.message || '', username: r.from?.name || 'Facebook 사용자', at: r.created_time || '' })),
    }));
  }
  if (platform === 'threads') {
    const c = await call('GET', `${TH()}/v1.0/${pub.id}/replies`, { fields: 'id,text,username,timestamp', access_token: conns.threads.token });
    return (c.data || []).map((x) => ({ id: x.id, text: x.text || '', username: x.username || '', at: x.timestamp || '', likes: 0, replies: [] }));
  }
  throw new Error('알 수 없는 플랫폼');
}

// 반응 새로고침용 (게시 현황 칩): 좋아요·답글만
async function fetchMetrics(platform, conns, pub) {
  try {
    const c = await fetchCounts(platform, conns, pub);
    return { 좋아요: c.likes, 답글: c.comments };
  } catch (e) {
    if (e.gone) throw e;
    throw new Error(permHint(e, NEED[platform]?.counts || '읽기'));
  }
}

// 반응 화면·게시물 화면용: 수 + 답글 내용
async function reactions(platform, conns, pub) {
  if (!conns[platform]?.token) throw new Error('계정이 연결되지 않았어요.');
  const out = { counts: null, comments: [], errors: {}, permalink: pub.url || '' };
  try {
    const c = await fetchCounts(platform, conns, pub);
    out.counts = { likes: c.likes, comments: c.comments };
    if (c.permalink) out.permalink = c.permalink;
  } catch (e) {
    if (e.gone) throw e; // 지워진 게시물은 부른 쪽에서 정리
    out.errors.counts = permHint(e, NEED[platform]?.counts || '읽기');
  }
  try {
    out.comments = await fetchComments(platform, conns, pub);
  } catch (e) {
    if (e.gone) throw e;
    out.errors.comments = permHint(e, NEED[platform]?.comments || '답글 읽기');
  }
  if (!out.counts && !out.errors.comments) out.counts = { likes: 0, comments: out.comments.length };
  return out;
}

// ---------- SNS 앱에서 직접 지웠는지 확인 ----------
// true: 아직 있음 / false: 확실히 지워짐 / null: 확인 못 함(네트워크·권한 문제 등)
async function exists(platform, conns, pub) {
  const token = conns[platform]?.token;
  if (!token || !pub?.id) return null;
  const base = platform === 'instagram' ? igBase(token) : platform === 'facebook' ? `${FB()}/${VER()}` : `${TH()}/v1.0`;
  try {
    await call('GET', `${base}/${pub.id}`, { fields: 'id', access_token: token }, null, 8000);
    return true;
  } catch (e) {
    return e.gone ? false : null;
  }
}

async function publish(platform, conns, text, photos) {
  if (platform === 'facebook') return postFacebook(conns.facebook, text, photos);
  if (platform === 'instagram') return postInstagram(conns.instagram, text, photos, conns.publicBaseUrl);
  if (platform === 'threads') return postThreads(conns.threads, text, photos, conns.publicBaseUrl);
  throw new Error('알 수 없는 플랫폼');
}

module.exports = { publish, testConnection, deletePublication, fetchMetrics, exists, reactions };
