// LLM 호출 계층: Gemini(기본, 무료 티어) / Groq(대안, 무료 티어) / mock(데모 모드)
// - 게시물 문구: 참고 사진을 Gemini가 직접 보고 작성 (Groq은 글만)
// - AI 이미지: Gemini 이미지 모델 (무료 키에서는 막혀 있을 수 있음 → 화면에서 안내)

const { buildPostPrompt, buildIdeasPrompt } = require('./prompts');
const { mockPost, mockIdeas } = require('./mock');

function providerName() {
  const p = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
  if (p !== 'auto') return p;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.GROQ_API_KEY) return 'groq';
  return 'mock';
}

function modelName() {
  const p = providerName();
  if (p === 'gemini') return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (p === 'groq') return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  return 'rule-based-demo';
}

const GEMINI_BASE = () => process.env.GEMINI_HOST || 'https://generativelanguage.googleapis.com';

async function geminiRequest(model, body) {
  const res = await fetch(`${GEMINI_BASE()}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// images: [{ buffer, mime }]
async function callGemini(system, user, images = []) {
  const parts = [{ text: user }, ...images.map((im) => ({ inlineData: { mimeType: im.mime || 'image/jpeg', data: im.buffer.toString('base64') } }))];
  const data = await geminiRequest(process.env.GEMINI_MODEL || 'gemini-2.5-flash', {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
  });
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

async function callGroq(system, user) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    }),
  });
  if (!res.ok) {
    const err = new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function parseJson(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('JSON을 찾지 못했어요');
  return JSON.parse(t.slice(s, e + 1));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function askJson(system, user, images = []) {
  const p = providerName();
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = p === 'gemini' ? await callGemini(system, user, images) : p === 'groq' ? await callGroq(system, user) : null;
      if (text === null) throw new Error(`알 수 없는 LLM_PROVIDER: ${p}`);
      return parseJson(text);
    } catch (e) {
      lastErr = e;
      if (e.status && e.status !== 429 && e.status < 500) break;
      await sleep(e.status === 429 ? 3000 : 800);
    }
  }
  throw lastErr;
}

const str = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d);
const allowFallback = () => (process.env.FALLBACK_TO_MOCK || 'true') !== 'false';

// 스레드: 500자, 해시태그 1개 제한 맞추기
function fitThreads(text) {
  let t = text;
  const tags = t.match(/#[^\s#]+/g) || [];
  tags.slice(1).forEach((h) => (t = t.replace(h, '')));
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > 500 ? `${t.slice(0, 497)}…` : t;
}

function normalizePost(raw, fallback) {
  const c = raw?.captions || {};
  return {
    headline: str(raw?.headline, fallback.headline).slice(0, 20),
    subline: str(raw?.subline, fallback.subline).slice(0, 30),
    captions: {
      instagram: str(c.instagram, fallback.captions.instagram).slice(0, 2200),
      facebook: str(c.facebook, fallback.captions.facebook),
      threads: fitThreads(str(c.threads, fallback.captions.threads)),
    },
    checklist: Array.isArray(raw?.checklist) ? raw.checklist.map(String).filter(Boolean).slice(0, 5) : fallback.checklist,
    imagePrompt: str(raw?.imagePrompt, fallback.imagePrompt),
  };
}

async function generatePost(store, input, refImages, pastPosts) {
  const mock = mockPost(store, input);
  if (providerName() === 'mock') return { ...mock, source: 'mock' };
  const { system, user } = buildPostPrompt(store, input, refImages.length, pastPosts);
  try {
    const raw = await askJson(system, user, providerName() === 'gemini' ? refImages.slice(0, 4) : []);
    return { ...normalizePost(raw, mock), source: providerName() };
  } catch (e) {
    console.error('[llm] 게시물 생성 실패:', e.message);
    if (!allowFallback()) throw e;
    return { ...mock, source: 'mock', fallbackReason: e.message };
  }
}

async function generateIdeas(store, pastPosts) {
  const mock = mockIdeas(store, pastPosts);
  if (providerName() === 'mock') return { ...mock, source: 'mock' };
  const { system, user } = buildIdeasPrompt(store, pastPosts);
  try {
    const raw = await askJson(system, user);
    const ideas = (Array.isArray(raw?.ideas) ? raw.ideas : [])
      .filter((i) => str(i?.topic))
      .map((i) => ({ topic: str(i.topic), detail: str(i.detail), why: str(i.why) }))
      .slice(0, 3);
    return { ideas: ideas.length ? ideas : mock.ideas, source: providerName() };
  } catch (e) {
    console.error('[llm] 아이디어 생성 실패:', e.message);
    if (!allowFallback()) throw e;
    return { ...mock, source: 'mock', fallbackReason: e.message };
  }
}

// AI 이미지 생성/보정. source가 있으면 그 사진을 보정, 없으면 새로 생성.
async function generateImage({ prompt, source }) {
  if (providerName() !== 'gemini') {
    throw new Error('AI 이미지는 Gemini API 키가 있어야 쓸 수 있어요. 대신 자동 보정과 홍보 카드를 이용해 주세요.');
  }
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
  const parts = [{ text: prompt }];
  if (source) parts.push({ inlineData: { mimeType: source.mime || 'image/jpeg', data: source.buffer.toString('base64') } });
  try {
    const data = await geminiRequest(model, {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    const out = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData || p.inline_data);
    const inline = out?.inlineData || out?.inline_data;
    if (!inline?.data) throw new Error('이미지가 돌아오지 않았어요. 요청을 조금 바꿔서 다시 시도해 주세요.');
    return { buffer: Buffer.from(inline.data, 'base64'), mime: inline.mimeType || inline.mime_type || 'image/png' };
  } catch (e) {
    console.error('[llm] 이미지 생성 실패:', e.message);
    if (e.status === 429 || e.status === 403 || /quota|billing|free tier|RESOURCE_EXHAUSTED/i.test(e.message)) {
      throw new Error('지금 API 키로는 AI 이미지 생성을 쓸 수 없어요 (무료 키는 이미지 생성이 막혀 있거나 한도가 작아요). 자동 보정과 홍보 카드는 계속 쓸 수 있어요.');
    }
    if (e.status === 404) throw new Error(`이미지 모델(${model})을 찾을 수 없어요. .env의 GEMINI_IMAGE_MODEL을 확인해 주세요.`);
    throw e;
  }
}

module.exports = { providerName, modelName, generatePost, generateIdeas, generateImage };
