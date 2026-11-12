"""같이가게 MVP 서버 (Flask)

실행:  python app.py   →  브라우저에서 http://127.0.0.1:5000
"""
import os
import secrets
import socket
import uuid

from flask import Flask, abort, jsonify, request, send_from_directory, session

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import ai
import db

BASE = os.path.dirname(os.path.abspath(__file__))
UPLOADS = os.path.join(BASE, "uploads")
ALLOWED = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024  # 업로드 1건 최대 8MB
os.makedirs(UPLOADS, exist_ok=True)
db.init()


def _secret_key():
    """역할 쿠키 서명용 키. 환경변수가 없으면 data/secret.key 에 만들어 둔다."""
    if os.getenv("SECRET_KEY"):
        return os.getenv("SECRET_KEY")
    path = os.path.join(BASE, "data", "secret.key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


app.secret_key = _secret_key()
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
ROLES = ("owner", "student")


def _role():
    return session.get("role")


def _need(role):
    """선택한 역할이 아니면 막는다. 학생은 사장님 기능을, 사장님은 학생 기능을 쓸 수 없다."""
    if _role() != role:
        abort(403, "사장님 전용 기능이에요." if role == "owner" else "학생 전용 기능이에요.")


def _student_can_see(p):
    return (p["status"] == "open" and p.get("invited") in (None, db.ME)) or db.ME in p["applicants"] or p.get("chosen") == db.ME


def _for_student(p):
    """학생에게 보낼 때는 다른 지원자 정보와 AI 점수를 뺀다."""
    p = dict(p)
    p["applicants"] = [a for a in p["applicants"] if a == db.ME]
    for k in ("scores", "scoreLive", "pitch", "saved_by_owner"):
        p.pop(k, None)
    return p


def _num(v, default=0):
    try:
        return int(str(v).replace(",", "").strip() or default)
    except ValueError:
        return default


def _project_or_404(pid):
    p = db.get(pid)
    if not p:
        abort(404, "프로젝트를 찾을 수 없어요.")
    return p


# ---------- 화면 ----------
@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/uploads/<path:name>")
def uploaded(name):
    return send_from_directory(UPLOADS, name)


# ---------- API ----------
@app.post("/api/role")
def choose_role():
    role = request.get_json(force=True).get("role")
    if role not in ROLES:
        abort(400, "사장님 또는 학생 중에서 골라 주세요.")
    session.clear()
    session["role"] = role
    return jsonify(role=role)


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(role=None)


@app.get("/api/bootstrap")
def bootstrap():
    role = _role()
    if role not in ROLES:
        return jsonify(role=None)
    projects = db.all_projects()
    students = db.students_view(projects)
    if role == "owner":
        return jsonify(role=role, projects=[p for p in projects if p.get("mine")], students=students, me=None,
                       aiLive=ai.enabled(), bookmarks=db.get_meta("bookmarks", []))
    return jsonify(role=role, projects=[_for_student(p) for p in projects if _student_can_see(p)],
                   students={db.ME: students[db.ME]}, me=db.ME, aiLive=ai.enabled(), myProfile=db.my_profile())


def _text(v, n):
    return str(v or "").strip()[:n]


@app.post("/api/profile")
def save_profile():
    """학생이 자기 프로필을 올리거나 고친다."""
    _need("student")
    d = request.get_json(force=True)
    if not _text(d.get("name"), 20) or not _text(d.get("headline"), 60):
        abort(400, "이름과 한 줄 소개를 채워 주세요.")
    if not d.get("tags"):
        abort(400, "잘하는 작업을 하나 이상 골라 주세요.")
    works = [{"title": _text(w.get("title"), 40), "kind": _text(w.get("kind"), 10) or "작업",
              "tags": [_text(t, 10) for t in (w.get("tags") or []) if _text(t, 10)][:3], "img": w.get("img") or None}
             for w in (d.get("works") or []) if _text(w.get("title"), 40)][:12]
    services = [{"name": _text(v.get("name"), 30), "price": _text(v.get("price"), 15)}
                for v in (d.get("services") or []) if _text(v.get("name"), 30)][:6]
    db.save_my_profile({
        "name": _text(d["name"], 20), "school": _text(d.get("school"), 30), "major": _text(d.get("major"), 30),
        "headline": _text(d["headline"], 60), "tags": [_text(t, 10) for t in d["tags"]][:5],
        "region": _text(d.get("region"), 30) or "경산", "avail": _text(d.get("avail"), 30),
        "intro": _text(d.get("intro"), 600), "open": bool(d.get("open")), "works": works, "services": services,
    })
    me = db.students_view(db.all_projects())[db.ME]
    return jsonify(students={db.ME: me}, myProfile=db.my_profile())


@app.post("/api/bookmarks/toggle")
def toggle_bookmark():
    _need("owner")
    sid = request.get_json(force=True).get("id")
    if sid not in db.STUDENTS:
        abort(404, "학생을 찾을 수 없어요.")
    marks = db.get_meta("bookmarks", [])
    marks = [m for m in marks if m != sid] if sid in marks else marks + [sid]
    return jsonify(bookmarks=db.set_meta("bookmarks", marks))


@app.post("/api/reset")
def reset():
    _need("owner")
    db.reset()
    return jsonify(ok=True)


@app.post("/api/upload")
def upload():
    if _role() not in ROLES:
        abort(403, "먼저 사장님 또는 학생으로 시작해 주세요.")
    f = request.files.get("file")
    if not f or not f.filename:
        abort(400, "파일이 없어요.")
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED:
        abort(400, "이미지 파일(png, jpg, gif, webp)만 올릴 수 있어요.")
    name = uuid.uuid4().hex + ext
    f.save(os.path.join(UPLOADS, name))
    return jsonify(url="/uploads/" + name, name=f.filename)


@app.post("/api/ai/brief")
def ai_brief():
    _need("owner")
    body = request.get_json(force=True)
    data, live = ai.brief(body.get("text", ""), body.get("shop", "우리 가게"))
    return jsonify(data=data, live=live)


@app.post("/api/projects")
def create_project():
    _need("owner")
    d = request.get_json(force=True)
    if not d.get("title") or not d.get("types") or not _num(d.get("pay")):
        abort(400, "작업 종류, 제목, 보수를 채워 주세요.")
    p = db._base(
        id="p" + uuid.uuid4().hex[:8], mine=True, shop=d.get("shop") or "카페 온담", title=d["title"][:60],
        types=d["types"], items=[i for i in d.get("items", []) if i], pay=_num(d["pay"]),
        days=_num(d.get("days"), 7) or 7, revisions=_num(d.get("revisions"), 1) or 1, visit=_num(d.get("visit")),
        area="영남대 정문 인근", materials=d.get("materials") or "로고, 메뉴 정보", desc=d.get("text", ""),
        apply=d.get("apply") or ["포트폴리오"], refImgs=d.get("refImgs", [])[:10], hue=5,
    )
    invite = d.get("invite")
    if invite in db.STUDENTS:  # 학생 포트폴리오에서 바로 보낸 지명 의뢰
        p["invited"] = invite
        p["applicants"] = [invite]
    return jsonify(db.save(p, new=True))


@app.post("/api/projects/<pid>/match")
def match(pid):
    _need("owner")
    p = _project_or_404(pid)
    p["scores"], p["scoreLive"] = ai.match(p, db.students_view(db.all_projects()))
    return jsonify(db.save(p))


@app.post("/api/projects/<pid>/action")
def action(pid):
    """프로젝트 상태를 바꾸는 모든 동작을 한 곳에서 처리한다."""
    p = _project_or_404(pid)
    body = request.get_json(force=True)
    t, a = body.get("type"), body.get("payload") or {}
    owner_actions = {"choose", "feedback", "check", "rate", "complete"}
    student_actions = {"apply", "save", "add_drafts", "request_review", "fbcheck", "final"}
    if t in owner_actions:
        _need("owner")
        if not p.get("mine"):
            abort(403, "내 의뢰만 관리할 수 있어요.")
    elif t in student_actions:
        _need("student")
        if t in ("apply", "save"):
            if not _student_can_see(p):
                abort(403, "지원할 수 없는 의뢰예요.")
        elif p.get("chosen") != db.ME:
            abort(403, "내가 맡은 프로젝트만 작업할 수 있어요.")

    if t == "apply":                                   # 학생: 지원
        if db.ME not in p["applicants"] and p["status"] == "open":
            p["applicants"].append(db.ME)
            p["pitch"] = a.get("pitch", "")
    elif t == "save":                                  # 학생: 관심 담기
        p["saved"] = not p.get("saved")
    elif t == "choose":                                # 사장님: 학생 선택
        if a.get("student") not in p["applicants"]:
            abort(400, "지원자 중에서 골라 주세요.")
        p["chosen"], p["status"] = a["student"], "matched"
    elif t == "add_drafts":                            # 학생: 초안 업로드
        p["drafts"] += a.get("drafts", [])[:10]
    elif t == "request_review":                        # 학생: 중간 확인 요청
        if not p["drafts"]:
            abort(400, "초안을 먼저 올려 주세요.")
        p["status"] = "review"
    elif t == "feedback":                              # 사장님: 피드백 → AI 정리
        raw = (a.get("raw") or "").strip()
        if len(raw) < 4:
            abort(400, "피드백을 적어 주세요.")
        data, live = ai.feedback(raw, p)
        p["feedback"] = {"raw": raw, "items": data.get("items", []), "outOfScope": data.get("outOfScope", []),
                         "done": {}, "live": live}
    elif t == "fbcheck":                               # 학생: 수정 항목 체크
        if p.get("feedback"):
            p["feedback"]["done"][str(a.get("k"))] = bool(a.get("v"))
    elif t == "final":                                 # 학생: 최종 제출
        p["status"] = "final"
    elif t == "check":                                 # 사장님: 체크리스트
        p["checks"][str(a.get("k"))] = bool(a.get("v"))
    elif t == "rate":
        p["rating"] = max(1, min(5, _num(a.get("n"), 5)))
        p["review"] = a.get("review", p.get("review", ""))[:200]
    elif t == "complete":                              # 사장님: 완료 확인
        if not p["rating"]:
            abort(400, "별점을 먼저 남겨 주세요.")
        p["review"] = a.get("review", p.get("review", ""))[:200]
        p["status"] = "done"
    else:
        abort(400, "알 수 없는 동작이에요.")
    saved = db.save(p)
    return jsonify(saved if _role() == "owner" else _for_student(saved))


@app.errorhandler(400)
@app.errorhandler(403)
@app.errorhandler(404)
@app.errorhandler(413)
def err(e):
    msg = getattr(e, "description", "") or "요청을 처리하지 못했어요."
    if getattr(e, "code", 0) == 413:
        msg = "파일이 너무 커요. 8MB 이하로 올려 주세요."
    return jsonify(error=msg), getattr(e, "code", 400)


def _lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    ip = _lan_ip()
    print("\n  같이가게 MVP 실행 중")
    print(f"  - 내 컴퓨터:        http://127.0.0.1:{port}")
    if ip:
        print(f"  - 같은 와이파이:    http://{ip}:{port}")
    print(f"  - AI: {'Claude 연결됨' if ai.enabled() else '규칙 기반 예시 (.env에 ANTHROPIC_API_KEY를 넣으면 실제 AI)'}")
    print("  끄려면 Ctrl + C\n")
    app.run(host="0.0.0.0", port=port, debug=False)
