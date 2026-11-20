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
  if (e.code === 190) msg = `토큰이 만료됐거나 올바르지 않아요. '계정 연결' 메뉴에서 토큰을 다시 넣어 주세요. (${e.message || ''})`;
  if (e.code === 10 || e.code === 200) msg = `권한이 부족해요. 토큰을 만들 때 게시 권한을 체크했는지 확인해 주세요. (${e.message || ''})`;
  const err = new Error(msg);
  err.status = status;
  return err;
}

async function call(method, url, params = {}, formData) {
  let res;
  if (method === 'GET') {
    const qs = new URLSearchParams(params).toString();
    res = await fetch(`${url}?${qs}`);
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
  if (!igId) {
    if (!igLogin) throw new Error('페이스북 로그인 방식 토큰이면 인스타그램 비즈니스 계정 ID도 넣어 주세요.');
    const me = await call('GET', `${base}/me`, { fields: 'user_id,username', access_token: token });
    igId = me.user_id || me.id;
  }

  let creationId;
  if (urls.length === 1) {
    creationId = (await call('POST', `${base}/${igId}/media`, { image_url: urls[0], caption: text, access_token: token })).id;
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
  const mediaId = (await call('POST', `${base}/${igId}/media_publish`, { creation_id: creationId, access_token: token })).id;
  let url = '';
  try {
    url = (await call('GET', `${base}/${mediaId}`, { fields: 'permalink', access_token: token })).permalink || '';
  } catch {}
  return { id: mediaId, url };
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
    if (!igUserId) throw new Error('페이스북 로그인 방식 토큰이면 인스타그램 비즈니스 계정 ID도 넣어 주세요.');
    const d = await call('GET', `${FB()}/${VER()}/${igUserId}`, { fields: 'username', access_token: token });
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
  const res = await fetch(`${url}?access_token=${encodeURIComponent(token)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw friendlyError(data, res.status);
  return data;
}

async function deletePublication(platform, conns, pub) {
  if (platform === 'instagram') {
    throw new Error('인스타그램은 공식 API로 게시물을 지울 수 없어요. "게시물 보기"를 눌러 인스타그램 앱에서 직접 삭제해 주세요.');
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

// ---------- 반응(좋아요·댓글 등) ----------
async function fetchMetrics(platform, conns, pub) {
  if (platform === 'instagram') {
    const { token } = conns.instagram;
    const base = token.startsWith('IG') ? `${IG()}/${VER()}` : `${FB()}/${VER()}`;
    const d = await call('GET', `${base}/${pub.id}`, { fields: 'like_count,comments_count', access_token: token });
    return { 좋아요: d.like_count ?? 0, 댓글: d.comments_count ?? 0 };
  }
  if (platform === 'facebook') {
    const d = await call('GET', `${FB()}/${VER()}/${pub.id}`, {
      fields: 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares',
      access_token: conns.facebook.token,
    });
    return { 반응: d.reactions?.summary?.total_count ?? 0, 댓글: d.comments?.summary?.total_count ?? 0, 공유: d.shares?.count ?? 0 };
  }
  if (platform === 'threads') {
    try {
      const d = await call('GET', `${TH()}/v1.0/${pub.id}/insights`, { metric: 'views,likes,replies,reposts', access_token: conns.threads.token });
      const m = {};
      const names = { views: '조회', likes: '좋아요', replies: '답글', reposts: '리포스트' };
      for (const item of d.data || []) m[names[item.name] || item.name] = item.values?.[0]?.value ?? item.total_value?.value ?? 0;
      return m;
    } catch (e) {
      throw new Error(`스레드 반응을 보려면 threads_manage_insights 권한이 필요해요. (${e.message})`);
    }
  }
  throw new Error('알 수 없는 플랫폼');
}

async function publish(platform, conns, text, photos) {
  if (platform === 'facebook') return postFacebook(conns.facebook, text, photos);
  if (platform === 'instagram') return postInstagram(conns.instagram, text, photos, conns.publicBaseUrl);
  if (platform === 'threads') return postThreads(conns.threads, text, photos, conns.publicBaseUrl);
  throw new Error('알 수 없는 플랫폼');
}

module.exports = { publish, testConnection, deletePublication, fetchMetrics };
