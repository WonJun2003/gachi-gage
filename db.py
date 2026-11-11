"""SQLite 저장소. 프로젝트 한 건을 JSON 문서 하나로 저장한다."""
import json
import os
import sqlite3
import threading
import time

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "data", "gachi.db")
_lock = threading.Lock()

# 데모용 학생 (MVP에서는 로그인 대신 고정된 학생 목록을 쓴다)
def _student(id, name, school, major, headline, tags, region, avail, intro, works, services, reviews, done=0, open=True):
    """works: (제목, 구분, 태그) / services: (작업, 가격) / reviews: (아이디, 별점, 후기)"""
    return {"id": id, "name": name, "school": school, "major": major, "headline": headline, "tags": tags,
            "region": region, "avail": avail, "intro": intro, "open": open, "done": done,
            "works": [{"title": t, "kind": k, "tags": g} for t, k, g in works],
            "services": [{"name": n, "price": p} for n, p in services],
            "reviews": [{"user": u, "rating": r, "text": x} for u, r, x in reviews],
            "pf": [t for t, _, _ in works[:3]]}


YU = "영남대학교"
STUDENTS = {s["id"]: s for s in [
    _student("s4", "최유지", YU, "시각디자인학과", "가게의 분위기를 담는 사진과 SNS 콘텐츠",
             ["SNS 제작", "사진 촬영", "메뉴판"], "경산, 대구", "주말 방문 가능",
             "카페와 작은 식당의 분위기를 살리는 사진을 찍어요. 촬영한 사진으로 인스타 게시물과 메뉴판까지 이어서 만들 수 있어요.",
             [("비둘기 카페 신메뉴 촬영", "작업", ["사진"]), ("나오늘장사안해카페 릴스 제작", "작업", ["SNS"]),
              ("메뉴판 디자인", "작업", ["디자인"]), ("홈페이지 UI UX 제작", "수업과제", ["홈페이지"])],
             [("메뉴 사진 5장", "8만원~"), ("인스타 게시물 3개", "10만원~"), ("메뉴판 1종", "12만원~")],
             [("xo****53", 5, "학생의 디자인 미감이 뛰어나고 성실합니다"), ("ca****12", 5, "사진 톤을 가게 분위기에 맞춰 줘서 만족해요"),
              ("mi****07", 4, "일정을 잘 지켜 줬어요"), ("bb****88", 5, "수정 요청도 빠르게 반영해 줬어요"),
              ("ro****21", 5, "게시물 올린 뒤 문의가 늘었어요"), ("ha****30", 4, "다음에도 맡기고 싶어요")], done=6),
    _student("s5", "임윤정", YU, "산업디자인학과", "매장 굿즈와 패키지로 가게를 기억하게",
             ["홍보물 제작", "로고", "SNS 제작"], "경산", "평일 방문 가능",
             "테이크아웃 컵 슬리브, 스티커, 쇼핑백처럼 손님 손에 남는 디자인을 좋아해요.",
             [("베이커리 쇼핑백 디자인", "작업", ["패키지"]), ("카페 스티커 굿즈", "작업", ["굿즈"]),
              ("꽃집 로고 리뉴얼", "수업과제", ["로고"])],
             [("로고 시안 2종", "15만원~"), ("스티커·슬리브 디자인", "10만원~")],
             [("fl****44", 5, "로고 시안이 기대 이상이었어요")], done=1),
    _student("s6", "정하늘", YU, "시각디자인학과", "손글씨 메뉴판과 따뜻한 전단지",
             ["메뉴판", "홍보물 제작"], "대구", "주말 방문 가능",
             "손으로 그린 일러스트와 손글씨로 동네 가게다운 메뉴판을 만들어요.",
             [("국밥집 벽 메뉴판", "작업", ["메뉴판"]), ("동네 서점 행사 전단지", "작업", ["전단지"]),
              ("시장 상인회 포스터", "수업과제", ["포스터"])],
             [("메뉴판 1종", "12만원~"), ("A5 전단지 1종", "7만원~")],
             [("gu****19", 5, "손님들이 메뉴판 예쁘다고 많이 말해요"), ("bo****02", 4, "그림이 따뜻해서 좋았어요")], done=2),
    _student("s7", "강우현", YU, "시각디자인학과", "브랜드 로고부터 간판 시안까지",
             ["로고", "홍보물 제작", "SNS 제작"], "경산", "주말 방문 가능",
             "가게 이름과 이야기를 듣고 로고, 간판, SNS 프로필까지 한 톤으로 맞춰 드려요.",
             [("수제버거집 로고", "작업", ["로고"]), ("헤어살롱 간판 시안", "작업", ["간판"]),
              ("지역 축제 BI", "수업과제", ["브랜딩"])],
             [("로고 시안 2종", "15만원~"), ("SNS 프로필·하이라이트 커버", "6만원~")],
             [], done=0, open=False),
    _student("s1", "이서윤", YU, "시각디자인학과 3학년", "자연광으로 담는 카페 메뉴 사진",
             ["사진 촬영", "SNS 제작", "메뉴판"], "경산", "평일 오후·주말 방문 가능",
             "카페 메뉴 사진을 자연광으로 찍는 걸 좋아해요. 촬영부터 인스타 카드뉴스까지 한 번에 해 드릴게요.",
             [("카페 메뉴 촬영", "작업", ["사진"]), ("인스타 카드뉴스", "수업과제", ["SNS"]), ("브런치 메뉴판", "작업", ["디자인"])],
             [("메뉴 사진 5장", "8만원~"), ("인스타 카드뉴스 3장", "9만원~")],
             [("da****77", 5, "꼼꼼하고 친절했어요"), ("cr****45", 4, "사진이 밝고 깔끔해요")], done=2),
    _student("s2", "박도현", YU, "미디어커뮤니케이션학과 4학년", "15초 안에 가게를 보여주는 릴스",
             ["숏폼 영상", "SNS 제작"], "대구", "주말 방문 가능",
             "릴스 위주로 작업해 왔어요. 사진보다 짧은 영상으로 신메뉴를 보여주는 걸 제안드려요.",
             [("음식점 릴스", "작업", ["영상"]), ("팝업스토어 영상", "작업", ["영상"]), ("동아리 홍보 영상", "수업과제", ["영상"])],
             [("릴스 1편", "8만원~"), ("릴스 3편 패키지", "20만원~")],
             [("po****11", 5, "조회수가 평소의 다섯 배 나왔어요")], done=4),
    _student("s3", "최민준", YU, "경영학과 3학년", "숫자로 보는 우리 가게 SNS 전략",
             ["마케팅 기획", "SNS 제작"], "경산", "평일 저녁 방문 가능",
             "게시물 문구와 해시태그 전략을 맡을 수 있어요. 디자인은 템플릿을 활용합니다.",
             [("상권 분석 보고서", "수업과제", ["분석"]), ("SNS 운영 기획안", "작업", ["기획"]), ("손님 설문 조사", "작업", ["조사"])],
             [("한 달 SNS 운영 계획", "10만원~"), ("상권·경쟁 가게 분석", "8만원~")],
             [], done=1),
]}
ME = "s1"


def _base(**kw):
    p = {"mine": False, "desc": "", "status": "open", "applicants": [], "chosen": None, "scores": None,
         "scoreLive": None, "drafts": [], "feedback": None, "checks": {}, "rating": 0, "review": "",
         "refImgs": [], "saved": False, "materials": "", "apply": ["포트폴리오"], "deadline": 7}
    p.update(kw)
    return p


SEED = [
    _base(id="p1", mine=True, shop="카페 온담", title="신메뉴 사진 및 인스타 게시물 제작", types=["사진 촬영", "SNS 제작"],
          items=["사진 5장", "인스타 게시물 3개"], pay=200000, days=7, revisions=1, visit=1, area="영남대 정문 인근",
          materials="로고 파일, 메뉴 정보, 참고 이미지", desc="겨울 신메뉴 3종이 나왔는데 인스타에 올릴 사진이 없어요.",
          apply=["관련 작업물(포트폴리오)", "진행 제안(촬영·제작 방식)", "방문 가능 일정"], deadline=3,
          applicants=["s2", "s3"], hue=0),
    _base(id="p2", shop="마라공방", title="배달앱 메뉴 사진 리뉴얼", types=["사진 촬영"], items=["메뉴 사진 8장"], pay=150000,
          days=5, revisions=2, visit=1, area="영남대 정문 인근", materials="메뉴 목록", deadline=1, hue=1),
    _base(id="p3", shop="꽃집 들담", title="연말 시즌 전단지 디자인", types=["홍보물 제작"], items=["A5 전단지 1종"], pay=120000,
          days=10, revisions=2, visit=0, area="경산 중방동", materials="로고, 상품 사진", deadline=6, hue=3),
    _base(id="p4", shop="분식 오늘", title="메뉴판 리디자인", types=["메뉴판"], items=["벽 메뉴판 1종", "테이블 메뉴판 1종"],
          pay=250000, days=14, revisions=2, visit=1, area="영남대 서편", materials="현재 메뉴판 사진", deadline=9, hue=4),
    _base(id="p5", shop="헤어 살롱 결", title="오픈 1주년 릴스 2편", types=["SNS 제작"], items=["릴스 2편"], pay=180000,
          days=7, revisions=1, visit=1, area="경산 사동", materials="매장 사진", deadline=4, hue=2),
]


def _conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.execute("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, created REAL, data TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, data TEXT)")
    return c


def get_meta(key, default=None):
    with _lock, _conn() as c:
        r = c.execute("SELECT data FROM meta WHERE key=?", (key,)).fetchone()
    return json.loads(r[0]) if r else default


def set_meta(key, value):
    with _lock, _conn() as c:
        c.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (key, json.dumps(value, ensure_ascii=False)))
    return value


def students_view(projects):
    """기본 학생 정보에 같이가게에서 완료한 프로젝트(작업물·후기)를 더해 돌려준다."""
    out = {}
    for sid, s in STUDENTS.items():
        s = json.loads(json.dumps(s))
        for p in projects:
            if p.get("chosen") == sid and p.get("status") == "done":
                s["works"].insert(0, {"title": f"{p['shop']} {p['title']}", "kind": "같이가게", "tags": p["types"][:1],
                                      "img": next((d["img"] for d in p["drafts"] if d.get("img")), None)})
                if p.get("review"):
                    s["reviews"].insert(0, {"user": p["shop"], "rating": p["rating"], "text": p["review"]})
                s["done"] += 1
        out[sid] = s
    return out


def init():
    with _lock, _conn() as c:
        if c.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0:
            _seed(c)


def _seed(c):
    now = time.time()
    for i, p in enumerate(SEED):
        c.execute("INSERT INTO projects VALUES (?,?,?)", (p["id"], now - i, json.dumps(p, ensure_ascii=False)))


def reset():
    with _lock, _conn() as c:
        c.execute("DELETE FROM projects")
        c.execute("DELETE FROM meta")
        _seed(c)


def all_projects():
    with _lock, _conn() as c:
        rows = c.execute("SELECT data FROM projects ORDER BY created DESC").fetchall()
    return [json.loads(r[0]) for r in rows]


def get(pid):
    with _lock, _conn() as c:
        r = c.execute("SELECT data FROM projects WHERE id=?", (pid,)).fetchone()
    return json.loads(r[0]) if r else None


def save(p, new=False):
    with _lock, _conn() as c:
        data = json.dumps(p, ensure_ascii=False)
        if new:
            c.execute("INSERT INTO projects VALUES (?,?,?)", (p["id"], time.time(), data))
        else:
            c.execute("UPDATE projects SET data=? WHERE id=?", (data, p["id"]))
    return p
