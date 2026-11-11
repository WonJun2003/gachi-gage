"""AI 기능. ANTHROPIC_API_KEY가 있으면 Claude를 부르고, 없으면 규칙 기반 예시로 답한다."""
import json
import os
import re

MODEL = os.getenv("CLAUDE_MODEL", "claude-haiku-5-5")
_client = None


def enabled():
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def _ask_json(prompt):
    """Claude에게 묻고 JSON으로 받는다. 실패하면 None."""
    global _client
    if not enabled():
        return None
    try:
        import anthropic
        if _client is None:
            _client = anthropic.Anthropic()
        msg = _client.messages.create(
            model=MODEL, max_tokens=1200,
            system="너는 한국 소상공인과 대학생을 연결하는 플랫폼의 도우미다. 항상 요청한 JSON만 출력한다.",
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        m = re.search(r"\{.*\}", text, re.S)
        return json.loads(m.group(0)) if m else None
    except Exception as e:  # 네트워크·키 오류 등은 규칙 기반으로 대체
        print("[AI] 호출 실패, 규칙 기반으로 대체:", e)
        return None


# ---------- 1. 의뢰서 자동 작성 ----------
def _fb_brief(t):
    types, items = [], []
    if re.search("사진|촬영|찍", t):
        types.append("사진 촬영"); items.append("사진 5장")
    if re.search("인스타|sns|SNS|게시물|홍보", t):
        types.append("SNS 제작"); items.append("인스타 게시물 3개")
    if re.search("릴스|숏폼|영상", t):
        if "SNS 제작" not in types:
            types.append("SNS 제작")
        items.append("릴스 1편")
    if "메뉴판" in t:
        types.append("메뉴판"); items.append("메뉴판 1종")
    if re.search("전단|포스터|현수막", t):
        types.append("홍보물 제작"); items.append("전단지 1종")
    if "로고" in t:
        types.append("로고"); items.append("로고 시안 2종")
    if not types:
        types, items = ["SNS 제작"], ["인스타 게시물 3개"]
    visit = 1 if ("사진 촬영" in types or re.search("릴스|영상", t)) else 0
    return {"title": ("신메뉴 " if "신메뉴" in t else "") + " · ".join(types) + " 프로젝트", "types": types,
            "items": items, "pay": min(400000, 80000 + len(items) * 60000), "days": 7, "revisions": 1,
            "visit": visit, "materials": "로고, 메뉴 정보, 참고 이미지",
            "apply": ["관련 작업물(포트폴리오)", "진행 제안", "방문 가능 일정"],
            "tips": ["수정 횟수를 미리 정해 두면 작업 중 마찰을 줄일 수 있어요.",
                     "참고하고 싶은 다른 가게 계정이 있다면 링크를 함께 올려 주세요."]}


def brief(text, shop):
    prompt = f"""소상공인의 요청을 대학생 실무 프로젝트 의뢰서로 바꿔.
가게: {shop}
사장님 설명: \"\"\"{text}\"\"\"
대학생(전공자) 대상 소규모 프로젝트 기준으로 현실적인 범위와 보수를 정해.
작업 종류는 다음 중에서만 고른다: 사진 촬영, SNS 제작, 메뉴판, 홍보물 제작, 로고.
JSON 형식:
{{"title":"한 줄 제목(25자 이내)","types":["..."],"items":["사진 5장" 같은 수량 표현],"pay":원 단위 정수,"days":선정 후 작업 일수,"revisions":수정 횟수,"visit":매장 방문 횟수,"materials":"사장님이 제공할 자료","apply":["지원할 때 학생이 낼 것"],"tips":["사장님께 드리는 짧은 조언 2개(마찰 예방 관점)"]}}"""
    data = _ask_json(prompt)
    return (data, True) if data else (_fb_brief(text), False)


# ---------- 2. 지원자 적합도 ----------
def _fb_match(p, students):
    out = {}
    for sid in p["applicants"]:
        s = students[sid]
        sc = 55 + s["done"] * 4
        for t in p["types"]:
            if any(g.split(" ")[0] in t or t.split(" ")[0] in g for g in s["tags"]):
                sc += 14
        if "SNS 제작" in p["types"] and any(re.search("SNS|숏폼", g) for g in s["tags"]):
            sc += 8
        visit = f" 매장 방문 일정({s['avail']})도 확인해 보세요." if p.get("visit") else ""
        out[sid] = {"score": min(97, sc),
                    "reason": f"{', '.join(s['tags'])} 경험이 있고 완료 프로젝트 {s['done']}건이에요.{visit}"}
    return out


def match(p, students):
    lst = [{"id": sid, "name": students[sid]["name"], "major": students[sid]["major"],
            "skills": students[sid]["tags"], "completed": students[sid]["done"],
            "portfolio": students[sid]["pf"], "message": students[sid]["intro"],
            "available": students[sid]["avail"]} for sid in p["applicants"]]
    proj = {k: p[k] for k in ("title", "types", "items", "visit", "days")}
    prompt = f"""소상공인 프로젝트와 지원한 대학생들을 비교해 적합도를 매겨.
프로젝트: {json.dumps(proj, ensure_ascii=False)}
지원자: {json.dumps(lst, ensure_ascii=False)}
각 지원자마다 0~100 점수와 사장님이 읽을 추천 이유 1~2문장(구체적으로, 걱정되는 점이 있으면 함께).
JSON 형식: {{"지원자id":{{"score":정수,"reason":"..."}}}}"""
    data = _ask_json(prompt)
    if data and all(sid in data for sid in p["applicants"]):
        return data, True
    return _fb_match(p, students), False


# ---------- 3. 피드백 정리 ----------
def _fb_feedback(text):
    parts = [s.strip() for s in re.split(r"[.\n,]|그리고|또", text) if len(s.strip()) > 3] or [text]
    items = [re.sub(r"\s*(해주세요|해 주세요|했으면 좋겠어요|면 좋겠어요)$", "", s).strip() + " 반영" for s in parts[:5]]
    return {"items": items, "outOfScope": []}


def feedback(text, p):
    prompt = f"""사장님이 대학생 작업 초안에 남긴 피드백을 학생이 바로 작업할 수 있는 수정 목록으로 바꿔.
프로젝트: {p['title']} / 납품: {', '.join(p['items'])}
피드백: \"\"\"{text}\"\"\"
감정적인 표현은 빼고 구체적인 작업 단위로 3~5개. 합의한 납품 항목 밖의 새 요청은 outOfScope에 따로 적어.
JSON 형식: {{"items":["..."],"outOfScope":["..."]}}"""
    data = _ask_json(prompt)
    return (data, True) if data and data.get("items") else (_fb_feedback(text), False)
