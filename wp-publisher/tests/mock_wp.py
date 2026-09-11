"""
سيرفر ووردبريس مزيّف — يحاكي الجزء المستخدم من WordPress REST API v2.

بيستخدم المكتبة القياسية بس، فالاختبارات تشتغل بدون أي تثبيت.
بيتحقق من Basic auth فعليًا، وبيحفظ حالة حقيقية (مقالات، تصنيفات، صور)،
وبيقدر يحاكي أعطال حقيقية عبر السيناريوهات.

الاستخدام في الاختبارات:
    from mock_wp import MockWP
    with MockWP() as wp:
        os.environ["WP_SITE_URL"] = wp.url
        ...
        wp.posts          # المقالات المتخزّنة
        wp.requests       # سجل كل النداءات اللي وصلت

السيناريوهات:
    ok             العادي
    bad_auth       401 على أي نداء مصادَق (باسورد غلط)
    strip_auth     401 دايمًا — يحاكي سيرفر بيرمي ترويسة Authorization
    no_publish     اليوزر مالوش publish_posts → 403 على إنشاء مقال
    no_upload      403 على رفع الصور
    not_json       /wp-json/ بيرجّع HTML مش JSON (بلجن أمان بيعترض)
    flaky          أول نداءين 500 وبعد كده طبيعي (اختبار الـ retry)
    rest_disabled  404 على كل حاجة
    no_meta        بيرفض حقول الـ meta (بلجن سيو مش مسجّل حقوله)
"""
from __future__ import annotations

import base64
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DEFAULT_USER = "test-publisher"
DEFAULT_PASSWORD = "abcdefghijklmnopqrstuvwx"  # 24 حرف زي باسوردات ووردبريس

ROUTES = [
    "/",
    "/wp/v2",
    "/wp/v2/posts",
    "/wp/v2/posts/(?P<id>[\\d]+)",
    "/wp/v2/pages",
    "/wp/v2/media",
    "/wp/v2/categories",
    "/wp/v2/tags",
    "/wp/v2/users",
    "/wp/v2/users/me",
]

ALL_CAPS = {
    "publish_posts": True,
    "edit_posts": True,
    "upload_files": True,
    "manage_categories": True,
    "edit_others_posts": True,
}


class _State:
    def __init__(self, scenario: str, user: str, password: str):
        self.scenario = scenario
        self.user = user
        self.password = password
        self.posts: dict[int, dict] = {}
        self.terms: dict[str, dict[int, dict]] = {"categories": {}, "tags": {}}
        self.media: dict[int, dict] = {}
        self.requests: list[dict] = []
        self.next_id = 100
        self.call_count = 0
        self.lock = threading.Lock()

    def new_id(self) -> int:
        self.next_id += 1
        return self.next_id


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    state: _State

    # --- مساعدات

    def log_message(self, *args):  # صامت
        pass

    def _send(self, code: int, payload, *, raw: str | None = None) -> None:
        if raw is not None:
            body = raw.encode("utf-8")
            ctype = "text/html; charset=utf-8"
        else:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            ctype = "application/json; charset=utf-8"
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code: int, wp_code: str, message: str, extra: dict | None = None) -> None:
        data = {"status": code}
        if extra:
            data.update(extra)
        self._send(code, {"code": wp_code, "message": message, "data": data})

    def _authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            decoded = base64.b64decode(header[6:]).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return False
        user, _, password = decoded.partition(":")
        st = self.state
        # ووردبريس بيتجاهل المسافات في الـ application password
        return user == st.user and password.replace(" ", "") == st.password.replace(" ", "")

    def _body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _json_body(self) -> dict:
        raw = self._body()
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    # --- بوابة السيناريوهات

    def _scenario_intercept(self, path: str) -> bool:
        """يرجّع True لو السيناريو تدخّل وخلّص الرد."""
        st = self.state
        sc = st.scenario

        if sc == "rest_disabled":
            self._error(404, "rest_no_route", "No route was found matching the URL")
            return True
        if sc == "not_json":
            self._send(200, None, raw="<!DOCTYPE html><html><body>Blocked by security plugin</body></html>")
            return True
        if sc == "flaky":
            with st.lock:
                st.call_count += 1
                count = st.call_count
            if count <= 2:
                self._error(503, "service_unavailable", "Service temporarily unavailable")
                return True
        if sc == "strip_auth":
            self._error(401, "rest_not_logged_in", "You are not currently logged in.")
            return True
        if sc == "bad_auth" and not self._authorized():
            self._error(401, "rest_cannot_view", "Sorry, you are not allowed to do that.")
            return True
        return False

    # --- الموجّه

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def _route(self, method: str) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        st = self.state

        with st.lock:
            st.requests.append(
                {
                    "method": method,
                    "path": path,
                    "query": query,
                    "has_auth": bool(self.headers.get("Authorization")),
                    "content_type": self.headers.get("Content-Type"),
                    "disposition": self.headers.get("Content-Disposition"),
                }
            )

        if self._scenario_intercept(path):
            return

        if not path.startswith("/wp-json"):
            self._error(404, "rest_no_route", "No route was found matching the URL")
            return

        rest = path[len("/wp-json") :] or "/"

        # جذر الـ API — مش محتاج مصادقة
        if rest in ("/", ""):
            self._send(200, {"name": "Mock WP", "url": "http://mock", "routes": {r: {} for r in ROUTES}})
            return

        if not self._authorized():
            self._error(401, "rest_cannot_view", "Sorry, you are not allowed to do that.")
            return

        handlers = [
            (r"^/wp/v2/users/me$", self._users_me),
            (r"^/wp/v2/posts$", self._posts_collection),
            (r"^/wp/v2/posts/(\d+)$", self._posts_single),
            (r"^/wp/v2/(categories|tags)$", self._terms_collection),
            (r"^/wp/v2/media$", self._media_collection),
            (r"^/wp/v2/media/(\d+)$", self._media_single),
        ]
        for pattern, handler in handlers:
            match = re.match(pattern, rest)
            if match:
                handler(method, query, *match.groups())
                return

        self._error(404, "rest_no_route", f"No route was found matching {rest}")

    # --- نقاط النهاية

    def _users_me(self, method: str, query: dict) -> None:
        caps = dict(ALL_CAPS)
        roles = ["editor"]
        if self.state.scenario == "no_publish":
            caps["publish_posts"] = False
            roles = ["contributor"]
        if self.state.scenario == "no_upload":
            caps["upload_files"] = False
        self._send(
            200,
            {
                "id": 7,
                "name": self.state.user,
                "slug": self.state.user.lower().replace(" ", "-"),
                "roles": roles,
                "capabilities": caps,
            },
        )

    def _posts_collection(self, method: str, query: dict) -> None:
        st = self.state
        if method == "GET":
            items = list(st.posts.values())
            if query.get("slug"):
                items = [p for p in items if p["slug"] == query["slug"]]
            status = query.get("status", "publish")
            if status != "any":
                wanted = status.split(",")
                items = [p for p in items if p["status"] in wanted]
            per_page = int(query.get("per_page", 10))
            self._send(200, items[:per_page])
            return

        if st.scenario == "no_publish":
            self._error(403, "rest_cannot_create", "Sorry, you are not allowed to create posts as this user.")
            return

        payload = self._json_body()
        if not payload.get("title"):
            self._error(400, "rest_missing_callback_param", "Missing parameter(s): title")
            return
        if st.scenario == "no_meta" and payload.get("meta"):
            self._error(400, "rest_invalid_param", "Invalid parameter(s): meta")
            return

        with st.lock:
            post_id = st.new_id()
            post = self._make_post(post_id, payload)
            st.posts[post_id] = post
        self._send(201, post)

    def _posts_single(self, method: str, query: dict, post_id: str) -> None:
        st = self.state
        pid = int(post_id)
        post = st.posts.get(pid)
        if not post:
            self._error(404, "rest_post_invalid_id", "Invalid post ID.")
            return
        if method == "GET":
            self._send(200, post)
            return

        payload = self._json_body()
        if st.scenario == "no_meta" and payload.get("meta"):
            self._error(400, "rest_invalid_param", "Invalid parameter(s): meta")
            return
        with st.lock:
            updated = self._make_post(pid, payload, base=post)
            st.posts[pid] = updated
        self._send(200, updated)

    def _make_post(self, post_id: int, payload: dict, base: dict | None = None) -> dict:
        """
        يبني/يحدّث مقال. المهم: ووردبريس الحقيقي بيحدّث الحقول المبعوتة بس،
        والحقول اللي مش في الطلب تفضل زي ما هي. المحاكاة لازم تعمل نفس الحاجة،
        وإلا الاختبارات تخفي بق حقيقي.
        """
        post = dict(base) if base else {}
        new = not base

        if new:
            post.update(
                {
                    "title": {"raw": "", "rendered": ""},
                    "content": {"raw": "", "rendered": ""},
                    "excerpt": {"raw": "", "rendered": ""},
                    "status": "draft",
                    "date": "2026-01-01T00:00:00",
                    "categories": [],
                    "tags": [],
                    "featured_media": 0,
                    "comment_status": "open",
                    "meta": {},
                    "author": 7,
                }
            )

        post["id"] = post_id
        for field in ("title", "content", "excerpt"):
            if payload.get(field) is not None:
                post[field] = {"raw": payload[field], "rendered": payload[field]}
        for field in (
            "slug",
            "status",
            "date",
            "categories",
            "tags",
            "featured_media",
            "comment_status",
            "author",
        ):
            if field in payload:
                post[field] = payload[field]
        if payload.get("meta"):
            post["meta"] = {**post.get("meta", {}), **payload["meta"]}

        post.setdefault("slug", f"post-{post_id}")
        post["link"] = f"http://{self.headers.get('Host', 'mock')}/{post['slug']}/"
        return post

    def _terms_collection(self, method: str, query: dict, taxonomy: str) -> None:
        st = self.state
        store = st.terms[taxonomy]
        if method == "GET":
            items = list(store.values())
            if query.get("slug"):
                items = [t for t in items if t["slug"] == query["slug"]]
            search = (query.get("search") or "").casefold()
            if search:
                items = [t for t in items if search in t["name"].casefold()]
            self._send(200, items)
            return

        payload = self._json_body()
        name = (payload.get("name") or "").strip()
        if not name:
            self._error(400, "rest_missing_callback_param", "Missing parameter(s): name")
            return
        for term in store.values():
            if term["name"].casefold() == name.casefold():
                # ووردبريس بيرجّع الـ id جوه الخطأ
                self._error(
                    400, "term_exists", "A term with the provided name already exists.",
                    {"term_id": term["id"]},
                )
                return
        with st.lock:
            tid = st.new_id()
            slug = re.sub(r"[^\w؀-ۿ-]", "", name.lower().replace(" ", "-"))
            term = {"id": tid, "name": name, "slug": slug, "taxonomy": taxonomy}
            store[tid] = term
        self._send(201, term)

    def _media_collection(self, method: str, query: dict) -> None:
        st = self.state
        if method == "GET":
            items = list(st.media.values())
            search = (query.get("search") or "").casefold()
            if search:
                items = [m for m in items if search in m["source_url"].casefold()]
            self._send(200, items)
            return

        if st.scenario == "no_upload":
            self._error(403, "rest_cannot_create", "Sorry, you are not allowed to upload media on this site.")
            return

        disposition = self.headers.get("Content-Disposition") or ""
        match = re.search(r'filename="?([^";]+)"?', disposition)
        if not match:
            self._error(400, "rest_upload_no_content_disposition", "No Content-Disposition supplied.")
            return
        blob = self._body()
        if not blob:
            self._error(400, "rest_upload_no_data", "No data supplied.")
            return

        filename = match.group(1)
        with st.lock:
            mid = st.new_id()
            item = {
                "id": mid,
                "slug": filename.rsplit(".", 1)[0],
                "source_url": f"http://{self.headers.get('Host', 'mock')}/uploads/{filename}",
                "mime_type": self.headers.get("Content-Type", "application/octet-stream"),
                "alt_text": "",
                "byte_size": len(blob),
            }
            st.media[mid] = item
        self._send(201, item)

    def _media_single(self, method: str, query: dict, media_id: str) -> None:
        st = self.state
        mid = int(media_id)
        item = st.media.get(mid)
        if not item:
            self._error(404, "rest_post_invalid_id", "Invalid attachment ID.")
            return
        if method == "POST":
            payload = self._json_body()
            if "alt_text" in payload:
                item["alt_text"] = payload["alt_text"]
        self._send(200, item)


class MockWP:
    """سيرفر ووردبريس مزيّف يشتغل في thread — يُستخدم كـ context manager."""

    def __init__(
        self,
        scenario: str = "ok",
        user: str = DEFAULT_USER,
        password: str = DEFAULT_PASSWORD,
    ):
        self.state = _State(scenario, user, password)
        handler = type("BoundHandler", (_Handler,), {"state": self.state})
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    # --- دورة الحياة

    def start(self) -> "MockWP":
        self.thread.start()
        return self

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def __enter__(self) -> "MockWP":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()

    # --- وصول مريح للحالة

    @property
    def url(self) -> str:
        host, port = self.server.server_address[:2]
        return f"http://{host}:{port}"

    @property
    def user(self) -> str:
        return self.state.user

    @property
    def password(self) -> str:
        return self.state.password

    @property
    def posts(self) -> list[dict]:
        return list(self.state.posts.values())

    @property
    def media(self) -> list[dict]:
        return list(self.state.media.values())

    def terms(self, taxonomy: str) -> list[dict]:
        return list(self.state.terms[taxonomy].values())

    @property
    def requests(self) -> list[dict]:
        return list(self.state.requests)

    def post_by_slug(self, slug: str) -> dict | None:
        return next((p for p in self.posts if p["slug"] == slug), None)

    def env(self) -> dict[str, str]:
        """متغيرات البيئة اللي الأداة محتاجاها علشان تكلّم السيرفر ده."""
        return {
            "WP_SITE_URL": self.url,
            "WP_USERNAME": self.user,
            "WP_APP_PASSWORD": self.password,
        }


if __name__ == "__main__":  # تشغيل يدوي للتجربة
    import sys

    scenario = sys.argv[1] if len(sys.argv) > 1 else "ok"
    with MockWP(scenario) as wp:
        print(f"سيرفر ووردبريس مزيّف [{scenario}] على {wp.url}")
        print(f"WP_SITE_URL={wp.url} WP_USERNAME={wp.user} WP_APP_PASSWORD={wp.password}")
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            pass
