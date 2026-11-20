// LLM 프롬프트 모음. AI 결과 형식(JSON)을 여기서 정의한다.

function storeToText(store) {
  const products = (store.products || [])
    .filter((p) => p && p.name)
    .map((p) => `- ${p.name}${p.price ? ` (${p.price})` : ''}`)
    .join('\n') || '- (입력 없음)';
  return [
    `가게 이름: ${store.name || '(입력 없음)'}`,
    `업종: ${store.category}`,
    `주소: ${store.address}`,
    `상품·서비스 (참고용):\n${products}`,
    `가게 홍보 목표: ${store.goal || '(입력 없음)'}`,
    `기타 정보: ${store.etc || '(입력 없음)'}`,
  ].join('\n');
}

function pastPostsText(posts) {
  const list = posts.filter((p) => p.topic).slice(0, 5);
  if (!list.length) return '(아직 없음)';
  return list
    .map((p) => {
      const done = Object.entries(p.publications || {}).filter(([, v]) => v.status === 'published').map(([k]) => k);
      return `- ${p.createdAt.slice(0, 10)} "${p.topic}"${done.length ? ` → 게시: ${done.join(', ')}` : ' (임시저장)'}`;
    })
    .join('\n');
}

const POST_SYSTEM = `너는 마케팅 담당자가 없는 소상공인 사장님 대신 SNS 게시물을 만드는 도우미다.
사장님이 홍보하고 싶은 것과 참고 사진을 주면, 인스타그램·페이스북·스레드에 바로 올릴 문구와 홍보 카드 이미지용 짧은 문구를 만든다.

규칙:
1. 가게 정보, 사장님 요청, 참고 사진에 실제로 있는 내용만 쓴다. 정해지지 않은 가격·기간·혜택·수치는 지어내지 말고 [가격], [기간], [혜택 내용]처럼 대괄호 빈칸으로 남긴다.
2. 참고 사진이 있으면 사진에 보이는 것(메뉴, 분위기, 색감, 공간)을 자연스럽게 문구에 녹인다. 사진에 없는 것을 있다고 쓰지 않는다.
3. 사장님 말투로 1인칭("저희 가게")을 쓴다. 과장 광고 표현(최고, 1등, 무조건 등)을 쓰지 않는다.
4. 플랫폼별:
   - instagram: 3~7줄, 이모지 조금, 끝에 줄바꿈 두 번 뒤 해시태그 6~10개 (지역명·업종·상품명 포함)
   - facebook: 4~8줄, 정보 위주, 위치·영업 정보 포함, 해시태그 0~3개
   - threads: 2~4줄, 대화하듯 짧게, 전체 450자 이내, 해시태그는 최대 1개
5. headline은 홍보 카드 이미지에 크게 들어갈 제목(공백 포함 14자 이내), subline은 그 아래 작은 글(24자 이내).
6. imagePrompt는 AI 이미지 생성 모델에 줄 영어 프롬프트. 글자(텍스트)가 들어가지 않는 사진풍 장면으로 묘사한다.

반드시 아래 JSON 형식으로만 답한다.
{
  "headline": "카드 큰 제목",
  "subline": "카드 작은 글",
  "captions": {
    "instagram": "인스타그램 문구 전체 (해시태그 포함, 줄바꿈은 \\n)",
    "facebook": "페이스북 문구 전체",
    "threads": "스레드 문구 전체"
  },
  "checklist": ["올리기 전에 사장님이 확인할 것"],
  "imagePrompt": "English prompt for an image model"
}`;

function buildPostPrompt(store, input, refCount, pastPosts) {
  return {
    system: POST_SYSTEM,
    user: [
      `[가게 정보]\n${storeToText(store)}`,
      `[이번에 홍보할 것]\n${input.topic}`,
      `[강조하고 싶은 내용]\n${input.detail || '(없음)'}`,
      `[원하는 분위기]\n${input.tone || '친근하게'}`,
      `[참고 사진]\n${refCount ? `${refCount}장 첨부 (아래 이미지)` : '없음'}`,
      `[최근 게시물]\n${pastPostsText(pastPosts)}`,
      '위 내용으로 게시물을 만들어 주세요. 최근 게시물과 문구가 너무 비슷하지 않게 해 주세요.',
    ].join('\n\n'),
  };
}

const IDEA_SYSTEM = `너는 소상공인 사장님에게 오늘 올릴 SNS 게시물 아이디어를 주는 도우미다.
가게 정보와 최근 게시물을 보고, 지금 올리기 좋은 아이디어 3개를 준다.
- 가게 정보에 있는 상품·서비스를 활용하고, 입력에 없는 행사·가격을 지어내지 않는다.
- 최근에 올린 주제는 피한다.
- 쉬운 말로 짧게.
반드시 아래 JSON 형식으로만 답한다.
{ "ideas": [ { "topic": "홍보할 것 (한 줄)", "detail": "강조할 내용 (한 줄)", "why": "추천 이유 (한 줄)" } ] }`;

function buildIdeasPrompt(store, pastPosts) {
  return {
    system: IDEA_SYSTEM,
    user: `[가게 정보]\n${storeToText(store)}\n\n[최근 게시물]\n${pastPostsText(pastPosts)}\n\n오늘 올릴 게시물 아이디어 3개를 주세요.`,
  };
}

module.exports = { storeToText, buildPostPrompt, buildIdeasPrompt };
