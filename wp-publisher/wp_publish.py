#!/usr/bin/env python3
"""
wp_publish.py — نشر المقالات آليًا على ووردبريس عبر REST API + Application Password.

الاستخدام السريع:
    python3 wp_publish.py doctor                 # اختبار الاتصال والصلاحيات
    python3 wp_publish.py publish --all --dry-run # معاينة بدون نشر
    python3 wp_publish.py publish --all           # نشر/تحديث كل مقالات content/
    python3 wp_publish.py publish content/x.md --status publish
    python3 wp_publish.py list                    # آخر المقالات على الموقع

البيانات بتتقرأ من متغيرات البيئة أو ملف .env (شوف .env.example):
    WP_SITE_URL, WP_USERNAME, WP_APP_PASSWORD
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:
    sys.exit("محتاج مكتبة requests:  pip install -r requirements.txt")

from markdown_blocks import md_to_blocks, plain_excerpt

ROOT = Path(__file__).resolve().parent
CONTENT_DIR = ROOT / "content"
STATE_FILE = ROOT / ".published.json"

# مفاتيح الـ SEO لأشهر بلجنين — بنحاول نكتبهم، وبننبّه لو الموقع مش سامح
SEO_META_KEYS = {
    "yoast": {"title": "_yoast_wpseo_title", "description": "_yoast_wpseo_metadesc"},
    "rankmath": {"title": "rank_math_title", "description": "rank_math_description"},
    "aioseo": {"title": "_aioseo_title", "description": "_aioseo_description"},
}


# ---------------------------------------------------------------- الإعدادات


def load_dotenv(path: Path) -> None:
    """قارئ .env بسيط — بدون مكتبات."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip("'\"")
        os.environ.setdefault(key, value)


@dataclass
class Config:
    site: str
    user: str
    app_password: str

    @classmethod
    def from_env(cls) -> "Config":
        load_dotenv(ROOT / ".env")
        site = os.environ.get("WP_SITE_URL", "").strip().rstrip("/")
        user = os.environ.get("WP_USERNAME", "").strip()
        pw = os.environ.get("WP_APP_PASSWORD", "").strip()
        missing = [
            name
            for name, val in (
                ("WP_SITE_URL", site),
                ("WP_USERNAME", user),
                ("WP_APP_PASSWORD", pw),
            )
            if not val
        ]
        if missing:
            sys.exit(
                "ناقص بيانات الاتصال: "
                + ", ".join(missing)
                + "\nاعمل ملف .env من .env.example أو صدّرهم كمتغيرات بيئة."
            )
        if not site.startswith(("http://", "https://")):
            site = "https://" + site
        # ووردبريس بيتجاهل المسافات في الـ application password، بنشيلها لأمان أكبر
        return cls(site=site, user=user, app_password=pw.replace(" ", ""))

    @property
    def api(self) -> str:
        return f"{self.site}/wp-json/wp/v2"


# ---------------------------------------------------------------- الـ client


class WPError(RuntimeError):
    pass


class WPClient:
    def __init__(self, cfg: Config, timeout: int = 45):
        self.cfg = cfg
        self.timeout = timeout
        token = base64.b64encode(
            f"{cfg.user}:{cfg.app_password}".encode("utf-8")
        ).decode("ascii")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Basic {token}",
                "Accept": "application/json",
                "User-Agent": "wp-publisher/1.0",
            }
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json_body: Any = None,
        data: bytes | None = None,
        headers: dict | None = None,
        retries: int = 4,
    ) -> Any:
        url = path if path.startswith("http") else f"{self.cfg.api}{path}"
        delay = 2.0
        last: Exception | None = None

        for attempt in range(retries + 1):
            try:
                resp = self.session.request(
                    method,
                    url,
                    params=params,
                    json=json_body,
                    data=data,
                    headers=headers,
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                last = exc
                if attempt == retries:
                    break
                time.sleep(delay)
                delay *= 2
                continue

            # 5xx و 429 بيستحقوا إعادة محاولة، الباقي لأ
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue

            if resp.status_code == 401:
                raise WPError(
                    "401 — اليوزر أو الـ application password غلط، أو السيرفر بيحجب "
                    "ترويسة Authorization (شوف قسم استكشاف الأخطاء في README)."
                )
            if resp.status_code == 403:
                raise WPError(
                    f"403 — اليوزر مالوش صلاحية العملية دي: {_err_text(resp)}"
                )
            if not resp.ok:
                raise WPError(f"{resp.status_code} على {method} {url} — {_err_text(resp)}")

            if not resp.content:
                return None
            try:
                return resp.json()
            except ValueError:
                raise WPError(
                    f"الرد مش JSON من {url} — يمكن REST API مقفول أو فيه بلجن بيعترض.\n"
                    f"أول 200 حرف: {resp.text[:200]!r}"
                )

        raise WPError(f"فشل الاتصال بـ {url} بعد {retries + 1} محاولات: {last}")

    # --- استعلامات

    def me(self) -> dict:
        return self.request("GET", "/users/me", params={"context": "edit"})

    def routes(self) -> list[str]:
        root = self.request("GET", f"{self.cfg.site}/wp-json/")
        return sorted((root or {}).get("routes", {}).keys())

    def find_by_slug(self, slug: str, post_type: str = "posts") -> dict | None:
        items = self.request(
            "GET",
            f"/{post_type}",
            params={"slug": slug, "status": "any", "context": "edit", "per_page": 1},
        )
        return items[0] if items else None

    def resolve_term(self, name: str, taxonomy: str) -> int:
        """يرجّع id التصنيف/الوسم، ويعمله لو مش موجود."""
        wanted = name.strip()
        found = self.request(
            "GET", f"/{taxonomy}", params={"search": wanted, "per_page": 100}
        )
        target = _slugify(wanted)
        for term in found or []:
            if term.get("name", "").strip().casefold() == wanted.casefold() or term.get(
                "slug"
            ) == target:
                return int(term["id"])
        try:
            created = self.request("POST", f"/{taxonomy}", json_body={"name": wanted})
            return int(created["id"])
        except WPError as exc:
            # term_exists: ووردبريس بيرجّع الـ id جوه الخطأ
            match = re.search(r'"term_id":\s*(\d+)', str(exc))
            if match:
                return int(match.group(1))
            raise

    def upload_media(self, source: str, base_dir: Path, alt: str = "") -> dict:
        """يرفع صورة من مسار محلي أو URL، وبيعيد استخدام الموجود بنفس الاسم."""
        if source.startswith(("http://", "https://")):
            filename, blob, mime = _fetch_remote_image(source)
        else:
            path = (
                Path(source)
                if Path(source).is_absolute()
                else (base_dir / source).resolve()
            )
            if not path.is_file():
                raise WPError(f"الصورة مش موجودة: {path}")
            filename = path.name
            blob = path.read_bytes()
            mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"

        stem = Path(filename).stem
        existing = self.request(
            "GET",
            "/media",
            params={"search": stem, "per_page": 100, "context": "edit"},
        )
        for item in existing or []:
            if Path(item.get("source_url", "")).name == filename:
                return item  # مرفوعة قبل كده — مش بنكرّرها

        media = self.request(
            "POST",
            "/media",
            data=blob,
            headers={
                "Content-Type": mime,
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )
        if alt:
            try:
                self.request(
                    "POST", f"/media/{media['id']}", json_body={"alt_text": alt}
                )
            except WPError:
                pass
        return media



def _fetch_remote_image(url: str) -> tuple[str, bytes, str]:
    """ينزّل صورة من URL خارجي. session نضيف بدون Authorization."""
    try:
        resp = requests.get(url, timeout=45, headers={"User-Agent": "wp-publisher/1.0"})
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise WPError(f"مش قادر أنزّل الصورة من {url} — {exc}")

    mime = (resp.headers.get("Content-Type") or "").split(";")[0].strip()
    if not mime.startswith("image/"):
        raise WPError(f"{url} مش صورة (Content-Type: {mime or 'غير معروف'})")

    filename = Path(url.split("?")[0]).name
    if not Path(filename).suffix:
        filename += mimetypes.guess_extension(mime) or ".jpg"
    return filename, resp.content, mime


def _err_text(resp: requests.Response) -> str:
    try:
        payload = resp.json()
        return payload.get("message") or json.dumps(payload, ensure_ascii=False)[:300]
    except ValueError:
        return resp.text[:300]


def _slugify(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).strip().lower()
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"[^\w؀-ۿ-]", "", text)
    return re.sub(r"-{2,}", "-", text).strip("-")


# ---------------------------------------------------------------- المقالات


@dataclass
class Article:
    path: Path
    meta: dict = field(default_factory=dict)
    body: str = ""

    @classmethod
    def load(cls, path: Path) -> "Article":
        raw = path.read_text(encoding="utf-8")
        meta, body = _split_front_matter(raw)
        if not meta.get("title"):
            heading = re.search(r"^#\s+(.+)$", body, re.M)
            if heading:
                meta["title"] = heading.group(1).strip()
                body = body.replace(heading.group(0), "", 1)
        if not meta.get("title"):
            raise WPError(f"{path.name}: مفيش عنوان — حدّد title في الـ front matter أو ابدأ بـ '# العنوان'")
        meta.setdefault("slug", _slugify(str(meta["title"])))
        return cls(path=path, meta=meta, body=body.strip())


def _split_front_matter(raw: str) -> tuple[dict, str]:
    if not raw.lstrip().startswith("---"):
        return {}, raw
    parts = raw.lstrip().split("---", 2)
    if len(parts) < 3:
        return {}, raw
    head, body = parts[1], parts[2]
    try:
        import yaml

        meta = yaml.safe_load(head) or {}
    except ImportError:
        meta = _mini_yaml(head)
    if not isinstance(meta, dict):
        meta = {}
    return meta, body


def _mini_yaml(text: str) -> dict:
    """بديل بسيط لـ PyYAML: key: value، و [a, b]، والقوائم بـ '- '."""
    out: dict[str, Any] = {}
    key: str | None = None
    for raw in text.splitlines():
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        if raw.lstrip().startswith("- ") and key:
            out.setdefault(key, [])
            if isinstance(out[key], list):
                out[key].append(raw.lstrip()[2:].strip().strip("'\""))
            continue
        if ":" not in raw:
            continue
        key, _, value = raw.partition(":")
        key, value = key.strip(), value.strip()
        if not value:
            out[key] = []
        elif value.startswith("[") and value.endswith("]"):
            out[key] = [v.strip().strip("'\"") for v in value[1:-1].split(",") if v.strip()]
        elif value.lower() in ("true", "false"):
            out[key] = value.lower() == "true"
        else:
            out[key] = value.strip("'\"")
    return out


def _as_list(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [v.strip() for v in str(value).split(",") if v.strip()]


def build_payload(
    client: WPClient, art: Article, override_status: str | None, verbose: bool
) -> dict:
    meta = art.meta
    direction = meta.get("dir") or ("rtl" if _looks_arabic(art.body) else None)
    status = override_status or str(meta.get("status", "draft"))

    payload: dict[str, Any] = {
        "title": str(meta["title"]),
        "slug": str(meta["slug"]),
        "content": md_to_blocks(art.body, direction),
        "status": status,
        "excerpt": str(meta.get("excerpt") or plain_excerpt(art.body)),
        "comment_status": str(meta.get("comment_status", "open")),
    }

    if meta.get("date"):
        payload["date"] = str(meta["date"])
        if status == "publish" and _is_future(str(meta["date"])):
            payload["status"] = "future"  # نشر مجدول

    if meta.get("author"):
        payload["author"] = int(meta["author"])

    cats = _as_list(meta.get("categories"))
    if cats:
        payload["categories"] = [client.resolve_term(c, "categories") for c in cats]
    tags = _as_list(meta.get("tags"))
    if tags:
        payload["tags"] = [client.resolve_term(t, "tags") for t in tags]

    if meta.get("featured_image"):
        media = client.upload_media(
            str(meta["featured_image"]), art.path.parent, str(meta.get("featured_alt", ""))
        )
        payload["featured_media"] = int(media["id"])
        if verbose:
            print(f"    صورة بارزة: #{media['id']} {media.get('source_url', '')}")

    return payload


def _looks_arabic(text: str) -> bool:
    arabic = len(re.findall(r"[؀-ۿ]", text))
    return arabic > max(20, len(text) * 0.15)


def _is_future(value: str) -> bool:
    from datetime import datetime

    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value[:19], fmt) > datetime.now()
        except ValueError:
            continue
    return False


def apply_seo(client: WPClient, post_id: int, art: Article, verbose: bool) -> None:
    seo_title = art.meta.get("seo_title")
    seo_desc = art.meta.get("seo_description")
    if not (seo_title or seo_desc):
        return
    meta_payload: dict[str, str] = {}
    for keys in SEO_META_KEYS.values():
        if seo_title:
            meta_payload[keys["title"]] = str(seo_title)
        if seo_desc:
            meta_payload[keys["description"]] = str(seo_desc)
    try:
        client.request("POST", f"/posts/{post_id}", json_body={"meta": meta_payload})
        if verbose:
            print("    SEO meta: تم")
    except WPError as exc:
        print(
            f"    تنبيه: مش قادر أكتب SEO meta ({exc}). "
            "بلجن السيو محتاج يسجّل الحقول في REST — اكتب العنوان والوصف يدويًا، "
            "أو استخدم مهارة seo-pro عبر MCP.",
            file=sys.stderr,
        )


# ---------------------------------------------------------------- الأوامر


def cmd_doctor(cfg: Config, args: argparse.Namespace) -> int:
    print(f"الموقع: {cfg.site}")
    print(f"اليوزر: {cfg.user}")
    print(f"الباسورد: {'*' * 4}{cfg.app_password[-4:]} ({len(cfg.app_password)} حرف بعد شيل المسافات)")
    client = WPClient(cfg)

    print("\n[1/4] REST API شغال؟")
    routes = client.routes()
    needed = ["/wp/v2/posts", "/wp/v2/media", "/wp/v2/categories", "/wp/v2/tags"]
    for route in needed:
        print(f"      {'✓' if route in routes else '✗'} {route}")

    print("\n[2/4] المصادقة")
    me = client.me()
    print(f"      ✓ داخل كـ: {me.get('name')} (id={me.get('id')}, slug={me.get('slug')})")
    roles = me.get("roles") or []
    print(f"      الأدوار: {', '.join(roles) or 'غير معروف'}")

    print("\n[3/4] الصلاحيات المطلوبة للنشر")
    caps = me.get("capabilities") or {}
    for cap, label in (
        ("publish_posts", "نشر مقالات"),
        ("edit_posts", "تعديل مقالات"),
        ("upload_files", "رفع صور"),
        ("manage_categories", "إنشاء تصنيفات ووسوم"),
    ):
        ok = bool(caps.get(cap))
        print(f"      {'✓' if ok else '✗'} {label} ({cap})")

    print("\n[4/4] عدد المقالات الحالية")
    posts = client.request(
        "GET", "/posts", params={"per_page": 1, "status": "any", "_fields": "id"}
    )
    print(f"      قراءة المقالات: {'✓ تمام' if isinstance(posts, list) else '✗'}")

    print("\nالخلاصة: الأتمتة جاهزة ✓" if caps.get("publish_posts") else "\nالخلاصة: اليوزر مالوش صلاحية النشر ✗")
    return 0


def cmd_list(cfg: Config, args: argparse.Namespace) -> int:
    client = WPClient(cfg)
    posts = client.request(
        "GET",
        "/posts",
        params={
            "per_page": args.limit,
            "status": "any",
            "context": "edit",
            "_fields": "id,date,status,link,title,slug",
        },
    )
    if not posts:
        print("مفيش مقالات.")
        return 0
    for p in posts:
        title = (p.get("title") or {}).get("raw") or (p.get("title") or {}).get("rendered", "")
        print(f"#{p['id']:<6} [{p['status']:<8}] {p['date'][:10]}  {title}")
        print(f"        {p.get('link', '')}")
    return 0


def cmd_publish(cfg: Config, args: argparse.Namespace) -> int:
    files = _collect_files(args)
    if not files:
        if args.all:
            print(f"مفيش ملفات .md في {CONTENT_DIR} — ابدأ من content/_template.md")
        else:
            print("حدّد ملفات، أو استخدم --all لنشر كل content/*.md")
        return 1

    client = WPClient(cfg)
    if not args.dry_run:
        me = client.me()
        print(f"داخل كـ {me.get('name')} على {cfg.site}\n")

    done, failed = 0, 0
    for path in files:
        print(f"→ {path.name}")
        try:
            art = Article.load(path)
            existing = None if args.dry_run else client.find_by_slug(str(art.meta["slug"]))
            payload = (
                _preview_payload(art, args.status)
                if args.dry_run
                else build_payload(client, art, args.status, args.verbose)
            )

            if args.dry_run:
                print(f"    العنوان: {payload['title']}")
                print(f"    الرابط:  {cfg.site}/{payload['slug']}")
                print(f"    الحالة:  {payload['status']}")
                print(f"    تصنيفات: {', '.join(_as_list(art.meta.get('categories'))) or '—'}")
                print(f"    وسوم:    {', '.join(_as_list(art.meta.get('tags'))) or '—'}")
                print(f"    الحجم:   {len(payload['content'])} حرف HTML")
                done += 1
                continue

            if existing:
                post = client.request("POST", f"/posts/{existing['id']}", json_body=payload)
                action = "تحديث"
            else:
                post = client.request("POST", "/posts", json_body=payload)
                action = "إنشاء"

            apply_seo(client, int(post["id"]), art, args.verbose)
            print(f"    ✓ {action} #{post['id']} [{post['status']}] → {post.get('link')}")
            _record(path, post)
            done += 1
        except (WPError, OSError) as exc:
            print(f"    ✗ {exc}", file=sys.stderr)
            failed += 1

    print(f"\nالنتيجة: {done} نجح، {failed} فشل.")
    if args.dry_run:
        print("(معاينة فقط — مفيش حاجة نزلت على الموقع)")
    return 1 if failed else 0


def _preview_payload(art: Article, override_status: str | None) -> dict:
    direction = art.meta.get("dir") or ("rtl" if _looks_arabic(art.body) else None)
    return {
        "title": str(art.meta["title"]),
        "slug": str(art.meta["slug"]),
        "status": override_status or str(art.meta.get("status", "draft")),
        "content": md_to_blocks(art.body, direction),
    }


def _collect_files(args: argparse.Namespace) -> list[Path]:
    if args.files:
        return [Path(f).resolve() for f in args.files]
    if args.all:
        return sorted(p for p in CONTENT_DIR.glob("*.md") if not p.name.startswith("_"))
    return []


def _record(path: Path, post: dict) -> None:
    """سجل بسيط لآخر نشر — للمراجعة، مش للـ idempotency (ده بالـ slug)."""
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8")) if STATE_FILE.is_file() else {}
    except (ValueError, OSError):
        state = {}
    state[path.name] = {
        "id": post.get("id"),
        "slug": post.get("slug"),
        "status": post.get("status"),
        "link": post.get("link"),
        "synced_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    try:
        STATE_FILE.write_text(
            json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError:
        pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="wp_publish.py",
        description="نشر المقالات آليًا على ووردبريس عبر REST API",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_doctor = sub.add_parser("doctor", help="اختبار الاتصال والمصادقة والصلاحيات")
    p_doctor.set_defaults(func=cmd_doctor)

    p_list = sub.add_parser("list", help="عرض آخر المقالات على الموقع")
    p_list.add_argument("--limit", type=int, default=10)
    p_list.set_defaults(func=cmd_list)

    p_pub = sub.add_parser("publish", help="نشر أو تحديث مقالات من ملفات Markdown")
    p_pub.add_argument("files", nargs="*", help="ملفات .md محددة")
    p_pub.add_argument("--all", action="store_true", help="كل ملفات content/*.md")
    p_pub.add_argument(
        "--status",
        choices=["draft", "publish", "pending", "private"],
        help="يتخطى الحالة المكتوبة في الملف",
    )
    p_pub.add_argument("--dry-run", action="store_true", help="معاينة بدون أي كتابة")
    p_pub.add_argument("-v", "--verbose", action="store_true")
    p_pub.set_defaults(func=cmd_publish)

    args = parser.parse_args(argv)
    cfg = Config.from_env()
    try:
        return args.func(cfg, args)
    except WPError as exc:
        print(f"خطأ: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
