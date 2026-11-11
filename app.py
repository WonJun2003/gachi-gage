"""같이가게 MVP 서버 (Flask)

실행:  python app.py   →  브라우저에서 http://127.0.0.1:5000
"""
import os
import socket
import uuid

from flask import Flask, abort, jsonify, request, send_from_directory

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
@app.get("/api/bootstrap")
def bootstrap():
    projects = db.all_projects()
    return jsonify(projects=projects, students=db.students_view(projects), me=db.ME, aiLive=ai.enabled(),
                   bookmarks=db.get_meta("bookmarks", []))


@app.post("/api/bookmarks/toggle")
def toggle_bookmark():
    sid = request.get_json(force=True).get("id")
    if sid not in db.STUDENTS:
        abort(404, "학생을 찾을 수 없어요.")
    marks = db.get_meta("bookmarks", [])
    marks = [m for m in marks if m != sid] if sid in marks else marks + [sid]
    return jsonify(bookmarks=db.set_meta("bookmarks", marks))


@app.post("/api/reset")
def reset():
    db.reset()
    return jsonify(ok=True)


@app.post("/api/upload")
def upload():
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
    body = request.get_json(force=True)
    data, live = ai.brief(body.get("text", ""), body.get("shop", "우리 가게"))
    return jsonify(data=data, live=live)


@app.post("/api/projects")
def create_project():
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
    p = _project_or_404(pid)
    p["scores"], p["scoreLive"] = ai.match(p, db.STUDENTS)
    return jsonify(db.save(p))


@app.post("/api/projects/<pid>/action")
def action(pid):
    """프로젝트 상태를 바꾸는 모든 동작을 한 곳에서 처리한다."""
    p = _project_or_404(pid)
    body = request.get_json(force=True)
    t, a = body.get("type"), body.get("payload") or {}

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
    return jsonify(db.save(p))


@app.errorhandler(400)
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
