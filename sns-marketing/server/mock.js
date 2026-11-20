// API 키가 없거나 AI 호출이 실패할 때 쓰는 규칙 기반 데모 결과.
// 실제 AI 결과와 같은 JSON 형식을 돌려준다.

const tag = (s) => `#${String(s || '').replace(/[^\p{L}\p{N}]/gu, '')}`;

function findProduct(store, topic) {
  return (store.products || []).find((p) => p.name && topic.includes(p.name)) || null;
}

function mockPost(store, input) {
  const name = store.name || '저희 가게';
  const p = findProduct(store, input.topic);
  const price = p?.price || '[가격]';
  const town = (store.address || '').split(' ')[1] || '우리동네';
  const event = /이벤트|할인|행사/.test(`${input.tone} ${input.detail}`);
  const detail = input.detail ? `${input.detail}\n` : '';

  const instagram = [
    `안녕하세요, ${name}입니다 😊`,
    `${input.topic} 소개해 드릴게요!`,
    detail.trim(),
    p ? `💰 ${price}` : '',
    event ? '🎁 [혜택 내용] · 기간: [기간]' : '',
    `📍 ${store.address}`,
    '',
    [tag(town), tag(store.category), tag(name), tag(p?.name || input.topic.split(' ')[0]), '#동네가게', '#소상공인', `${tag(town)}${(store.category || '').replace(/\s/g, '')}`].join(' '),
  ].filter((l) => l !== undefined && l !== null).join('\n').replace(/\n{3,}/g, '\n\n');

  const facebook = [
    `[${name}] ${input.topic}`,
    '',
    detail.trim() || `${name}의 ${input.topic}을(를) 알려드립니다.`,
    p ? `- 가격: ${price}` : '',
    `- 위치: ${store.address}`,
    store.etc ? `- 안내: ${store.etc}` : '',
    '',
    '많은 관심 부탁드립니다.',
  ].filter(Boolean).join('\n');

  const threads = `${name}에서 ${input.topic} 준비했어요 ✨\n${input.detail || '근처 오시면 한번 들러 주세요!'}\n${tag(town + (store.category || ''))}`.slice(0, 450);

  return {
    headline: (p?.name || input.topic).slice(0, 14),
    subline: (event ? '이번 주 [혜택 내용]' : p?.price ? price : name).slice(0, 24),
    captions: { instagram, facebook, threads },
    checklist: ['[대괄호] 빈칸을 실제 내용으로 바꾸기', '가격·기간이 정확한지 확인하기'],
    imagePrompt: `A warm, inviting photo for a small local ${store.category} shop, featuring ${input.topic}, natural light, Korean neighborhood, no text`,
  };
}

function mockIdeas(store, pastPosts) {
  const used = new Set(pastPosts.map((p) => p.topic));
  const products = (store.products || []).filter((p) => p.name);
  const ideas = [];
  for (const p of products) {
    if (ideas.length >= 2) break;
    if ([...used].some((t) => t.includes(p.name))) continue;
    ideas.push({ topic: p.name, detail: p.price ? `가격 ${p.price}` : '', why: '등록하신 상품 중 아직 소개하지 않은 상품이에요.' });
  }
  ideas.push({ topic: '가게 분위기·내부 사진 소개', detail: store.etc || '', why: '처음 오는 손님이 가게를 미리 보고 올 수 있어요.' });
  if (ideas.length < 3) ideas.push({ topic: '방문 후기 부탁 이벤트', detail: '후기 남기면 [혜택 내용]', why: '후기가 쌓이면 검색했을 때 믿음이 생겨요.' });
  return { ideas: ideas.slice(0, 3) };
}

module.exports = { mockPost, mockIdeas };
