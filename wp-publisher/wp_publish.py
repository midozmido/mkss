#!/usr/bin/env python3
"""
wp_publish.py — نشر المقالات آليًا على ووردبريس عبر REST API + Application Password.

الاستخدام السريع:
    python3 wp_publish.py doctor                    # اختبار الاتصال والصلاحيات
    python3 wp_publish.py publish --all --dry-run   # معاينة بدون نشر
    python3 wp_publish.py publish --all             # نشر/تحديث كل مقالات content/
    python3 wp_publish.py publish content/x.md --status publish
    python3 wp_publish.py list                      # آخر المقالات على الموقع

البيانات بتتقرأ من متغيرات البيئة أو ملف .env (شوف .env.example):
    WP_SITE_URL, WP_USERNAME, WP_APP_PASSWORD

متغيرات اختيارية:
    WP_CONTENT_DIR   مكان ملفات المقالات (الافتراضي: ./content)
    WP_STATE_FILE    سجل النشر (الافتراضي: ./.published.json)
    WP_ENV_FILE      مكان ملف .env (الافتراضي: ./.env)
    WP_ALLOW_HTTP=1  السماح بموقع http:// — الباسورد بيتبعت مكشوف، للتطوير المحلي بس
    WP_ALLOW_LOCAL_FETCH=1  السماح بتنزيل صور من عناوين محلية/خاصة (للاختبار)
    WP_MAX_RETRIES   عدد محاولات إعادة القراءة عند عطل مؤقت (الافتراضي 4)
    WP_TIMEOUT       مهلة كل نداء بالثواني (الافتراضي 45)
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import ipaddress
import json
import mimetypes
import os
import re
import socket
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse

try:
    import requests
except ImportError:
    sys.exit("محتاج مكتبة requests:  pip install -r requirements.txt")

from markdown_blocks import md_to_blocks, plain_excerpt

ROOT = Path(__file__).resolve().parent
CONTENT_DIR = Path(os.environ.get("WP_CONTENT_DIR") or ROOT / "content")
STATE_FILE = Path(os.environ.get("WP_STATE_FILE") or ROOT / ".published.json")

# مفاتيح الـ SEO لأشهر البلجنات — بنكتبهم وبنتحقق أي واحد ثبت فعلًا
SEO_META_KEYS = {
    "Yoast": {"title": "_yoast_wpseo_title", "description": "_yoast_wpseo_metadesc"},
    "RankMath": {"title": "rank_math_title", "description": "rank_math_description"},
    "AIOSEO": {"title": "_aioseo_title", "description": "_aioseo_description"},
}

VALID_STATUSES = frozenset(("draft", "publish", "pending", "private", "future"))

REQUIRED_ROUTES = ["/wp/v2/posts", "/wp/v2/media", "/wp/v2/categories", "/wp/v2/tags"]
REQUIRED_CAPS = [
    ("publish_posts", "نشر مقالات"),
    ("edit_posts", "تعديل مقالات"),
    ("upload_files", "رفع صور"),
    ("manage_categories", "إنشاء تصنيفات ووسوم"),
]

# صور بنتعرّف عليها من البايتات نفسها، مش من الامتداد
_IMAGE_MAGIC: list[tuple[bytes, str]] = [
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"BM", "image/bmp"),
    (b"II*\x00", "image/tiff"),
    (b"MM\x00*", "image/tiff"),
]
MAX_IMAGE_BYTES = 24 * 1024 * 1024


# ---------------------------------------------------------------- الإعدادات


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except ValueError:
        return default
    return value if value >= 0 else default


def load_dotenv(path: Path) -> None:
    """قارئ .env بسيط — بدون مكتبات. متغيرات البيئة الموجودة بتفضل أقوى."""
    if not path.is_file():
        return
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw in content.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


@dataclass
class Config:
    site: str
    user: str
    app_password: str

    @classmethod
    def from_env(cls) -> "Config":
        load_dotenv(Path(os.environ.get("WP_ENV_FILE") or ROOT / ".env"))
        site = os.environ.get("WP_SITE_URL", "").strip().rstrip("/")
        user = os.environ.get("WP_USERNAME", "").strip()
        password = os.environ.get("WP_APP_PASSWORD", "").strip()

        missing = [
            name
            for name, value in (
                ("WP_SITE_URL", site),
                ("WP_USERNAME", user),
                ("WP_APP_PASSWORD", password),
            )
            if not value
        ]
        if missing:
            sys.exit(
                "ناقص بيانات الاتصال: "
                + ", ".join(missing)
                + "\nاعمل ملف .env من .env.example أو صدّرهم كمتغيرات بيئة."
            )

        if not site.startswith(("http://", "https://")):
            site = "https://" + site
        if "@" in urlparse(site).netloc:
            sys.exit(
                "WP_SITE_URL فيه بيانات دخول (user:pass@) — شيلها. "
                "الباسورد مكانه WP_APP_PASSWORD بس، وإلا بيظهر في كل رسالة خطأ."
            )
        if site.startswith("http://") and os.environ.get("WP_ALLOW_HTTP") != "1":
            sys.exit(
                f"الموقع {site} على http مش https — الباسورد هيتبعت مكشوف على الشبكة.\n"
                "استخدم https، أو لو ده سيرفر تطوير محلي شغّل بـ WP_ALLOW_HTTP=1."
            )

        # ووردبريس بيتجاهل المسافات في الـ application password
        return cls(site=site, user=user, app_password=password.replace(" ", ""))

    @property
    def api(self) -> str:
        return f"{self.site}/wp-json/wp/v2"


# ---------------------------------------------------------------- الأخطاء


class WPError(RuntimeError):
    """خطأ من ووردبريس أو من الأداة، بيحمل جسم الرد لما يكون متاح."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "",
        data: Any = None,
        status: int | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.data = data if data is not None else {}
        self.status = status

    @property
    def term_id(self) -> int | None:
        """
        ووردبريس بيرجّع رقم التصنيف الموجود في `data` — كرقم مجرّد في الحقيقي،
        وكـ {"term_id": N} في بعض الأشكال. بنقبل الاتنين.
        """
        raw = self.data.get("term_id") if isinstance(self.data, dict) else self.data
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return None
        return value or None


def _plain_text(body: str, limit: int = 220) -> str:
    """صفحة خطأ HTML مش رسالة — بنشيل الوسوم قبل ما نعرضها للمستخدم."""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", body, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _error_from_response(resp: requests.Response, context: str) -> WPError:
    code, message = "", ""
    data: Any = {}
    try:
        payload = resp.json()
        if isinstance(payload, dict):
            code = str(payload.get("code", ""))
            message = str(payload.get("message", ""))
            data = payload.get("data")
    except ValueError:
        message = _plain_text(resp.text)
    return WPError(
        f"{resp.status_code} على {context} — {message or _plain_text(resp.text)}",
        code=code,
        data=data,  # ووردبريس بيرجّع term_id كرقم مجرّد هنا أحيانًا
        status=resp.status_code,
    )


# ---------------------------------------------------------------- الـ client


class WPClient:
    def __init__(self, cfg: Config, timeout: int | None = None, max_retries: int | None = None):
        self.cfg = cfg
        self.timeout = timeout if timeout is not None else _env_int("WP_TIMEOUT", 45)
        # عدد محاولات القراءة — قابل للتعديل علشان CI والاختبارات
        self.max_retries = (
            max_retries if max_retries is not None else _env_int("WP_MAX_RETRIES", 4)
        )
        token = base64.b64encode(f"{cfg.user}:{cfg.app_password}".encode("utf-8")).decode("ascii")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Basic {token}",
                "Accept": "application/json",
                "User-Agent": "wp-publisher/1.0",
            }
        )
        self._allowed_host = (urlparse(cfg.site).hostname or "").lower()
        self._route_form = "pretty"  # أو "query" لو الروابط الدائمة Plain
        self._index: dict | None = None

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json_body: Any = None,
        data: bytes | None = None,
        headers: dict | None = None,
        retries: int | None = None,
    ) -> Any:
        url = self._url(path)

        # الباسورد مينفعش يروح لمضيف تاني — لا بإعادة توجيه ولا بمسار غلط
        host = (urlparse(url).hostname or "").lower()
        if host != self._allowed_host:
            raise WPError(f"رفض إرسال بيانات الدخول لمضيف مختلف: {host}")

        # الكتابة مش بتتكرّر أبدًا: إعادة POST ممكن تعمل مقال مكرر
        writing = method.upper() not in ("GET", "HEAD", "OPTIONS")
        attempts = 0 if writing else (self.max_retries if retries is None else retries)

        delay = 2.0
        last: Exception | None = None
        for attempt in range(attempts + 1):
            try:
                resp = self.session.request(
                    method,
                    url,
                    params=params,
                    json=json_body,
                    data=data,
                    headers=headers,
                    timeout=self.timeout,
                    allow_redirects=False,
                )
            except requests.RequestException as exc:
                last = exc
                if attempt == attempts:
                    break
                time.sleep(delay)
                delay *= 2
                continue

            if resp.is_redirect or resp.is_permanent_redirect:
                raise WPError(
                    f"الموقع بيعمل redirect من {url} لـ {resp.headers.get('Location', '?')} — "
                    "ظبّط WP_SITE_URL على العنوان النهائي (www/https) علشان الباسورد "
                    "ميتبعتش لمضيف تاني."
                )

            if resp.status_code in (429, 500, 502, 503, 504) and attempt < attempts:
                time.sleep(delay)
                delay *= 2
                continue

            if resp.status_code == 401:
                raise WPError(
                    "401 — اليوزر أو الـ application password غلط، أو السيرفر بيحجب "
                    "ترويسة Authorization (شوف قسم استكشاف الأخطاء في README).",
                    code="rest_unauthorized",
                    status=401,
                )
            if not resp.ok:
                raise _error_from_response(resp, f"{method} {url}")

            if not resp.content:
                return None
            try:
                return resp.json()
            except ValueError:
                raise WPError(
                    f"الرد مش JSON من {url} — يمكن REST API مقفول، أو الروابط الدائمة "
                    "Plain، أو فيه بلجن أمان بيعترض.\n"
                    f"    الرد: {_plain_text(resp.text)}"
                )

        raise WPError(f"فشل الاتصال بـ {url} بعد {attempts + 1} محاولة: {last}")

    # --- استعلامات

    def me(self) -> dict:
        return self.request("GET", "/users/me", params={"context": "edit"})

    # --- بناء العنوان: /wp-json/ أو ?rest_route= لو الروابط الدائمة "Plain"

    def _rest_url(self, rest_path: str) -> str:
        if self._route_form == "query":
            return f"{self.cfg.site}/?rest_route={rest_path}"
        return f"{self.cfg.site}/wp-json{rest_path}"

    def _url(self, path: str) -> str:
        """path زي '/posts' → مسار wp/v2 كامل."""
        if path.startswith("http"):
            return path
        return self._rest_url(f"/wp/v2{path}")

    def index(self) -> dict:
        """
        جذر الـ REST API. بيجرّب الشكلين: /wp-json/ وكمان ?rest_route=/
        لأن التركيب الافتراضي لووردبريس (Plain permalinks) مفيهوش الأول خالص
        وبيرجّع صفحة 404 HTML.
        """
        if self._index is not None:
            return self._index

        errors = []
        for form in ("pretty", "query"):
            self._route_form = form
            try:
                data = self.request("GET", self._rest_url("/"), retries=1)
            except WPError as exc:
                errors.append(f"{form}: {exc}")
                continue
            if isinstance(data, dict) and "routes" in data:
                self._index = data
                return data
            errors.append(f"{form}: رد بدون routes")

        self._route_form = "pretty"
        raise WPError(
            "مش قادر أوصل لـ REST API بأي شكل من الشكلين.\n"
            "    جرّب: Settings → Permalinks واختار أي تركيب غير Plain، "
            "واتأكد إن مفيش بلجن أمان بيحجب /wp-json/.\n"
            "    " + "\n    ".join(errors)
        )

    def routes(self) -> list[str]:
        return sorted((self.index().get("routes") or {}).keys())

    def gmt_offset_hours(self) -> float:
        """
        فرق توقيت الموقع بالساعات. ووردبريس بيفهم حقل `date` بتوقيت الموقع،
        والأداة ممكن تشتغل على سيرفر بتوقيت تاني (CI بيبقى UTC عادة) — فمن غير
        ده الجدولة بتنشر في وقت غلط أو تنشر فورًا.
        """
        override = os.environ.get("WP_SITE_GMT_OFFSET")
        if override:
            try:
                return float(override)
            except ValueError:
                pass
        try:
            value = self.index().get("gmt_offset")
            return float(value) if value is not None else 0.0
        except (WPError, TypeError, ValueError):
            return 0.0

    def find_by_slug(self, slug: str, post_type: str = "posts") -> dict | None:
        """
        بيدوّر بالـ slug. slug فاضي = مفيش بحث (وإلا كان هيرجّع أحدث مقال أصلًا).

        ووردبريس بيخزّن الـ slug غير اللاتيني مشفّر بالنسبة المئوية بحروف صغيرة
        (متحقَّق من 6.9.7: "دليل السيو" → "%d8%af%d9%84..."). فالمطابقة الحرفية
        مكانت بتلاقي أي slug عربي أبدًا، وكل تشغيل بدون سجل كان بيعمل مقال جديد.

        وبنستعلم بالشكلين — الخام والمشفّر — لأن مش كل تركيبة سيرفر بتنضّف
        قيمة الاستعلام زي ووردبريس.
        """
        if not slug or not slug.strip():
            return None

        attempts = [slug]
        encoded = quote(slug, safe="-_~").lower()
        if encoded != slug:
            attempts.append(encoded)

        for candidate in attempts:
            items = self.request(
                "GET",
                f"/{post_type}",
                params={"slug": candidate, "status": "any", "context": "edit", "per_page": 5},
            )
            for post in items or []:
                stored = str(post.get("slug") or "")
                if stored == slug or unquote(stored) == slug:
                    return post
        return None

    def get_post(self, post_id: int) -> dict | None:
        try:
            return self.request("GET", f"/posts/{post_id}", params={"context": "edit"})
        except WPError as exc:
            if exc.status == 404:
                return None
            raise

    def resolve_term(self, name: str, taxonomy: str) -> int:
        """يرجّع id التصنيف/الوسم، ويعمله لو مش موجود."""
        wanted = name.strip()
        target_slug = _slugify(wanted)

        # بحث مضبوط بالـ slug — صف واحد، مش صفحة نتايج
        if target_slug:
            found = self.request("GET", f"/{taxonomy}", params={"slug": target_slug, "per_page": 5})
            # مش بنثق إن السيرفر طبّق الفلتر — بلجن أو نسخة قديمة ممكن تتجاهله
            for term in found or []:
                if term.get("slug") == target_slug:
                    return int(term["id"])

        # بحث بالاسم مع تصفّح الصفحات (موقع فيه مئات التصنيفات)
        page = 1
        while page <= 50:
            try:
                found = self.request(
                    "GET", f"/{taxonomy}", params={"search": wanted, "per_page": 100, "page": page}
                )
            except WPError as exc:
                # ووردبريس بيرجّع 400 لصفحة بعد النهاية، مش قائمة فاضية
                if "invalid_page_number" in exc.code:
                    break
                raise
            if not found:
                break
            for term in found:
                if _norm_term(term.get("name", "")) == _norm_term(wanted):
                    return int(term["id"])
            if len(found) < 100:
                break
            page += 1

        try:
            created = self.request("POST", f"/{taxonomy}", json_body={"name": wanted})
            return int(created["id"])
        except WPError as exc:
            if exc.code != "term_exists":
                raise
            # اتعمل في نفس اللحظة من مكان تاني. الرقم بييجي في جسم الخطأ،
            # ولو بشكل مش متوقع بنعيد الاستعلام بدل ما نفشل المقال.
            if exc.term_id:
                return exc.term_id
            for params in ({"slug": target_slug}, {"search": wanted}):
                for term in self.request("GET", f"/{taxonomy}", params={**params, "per_page": 100}) or []:
                    if _norm_term(term.get("name", "")) == _norm_term(wanted):
                        return int(term["id"])
            raise

    # --- الوسائط

    def find_media(self, filename: str) -> dict | None:
        stem = Path(filename).stem
        if not stem:
            return None
        items = self.request(
            "GET", "/media", params={"search": stem, "per_page": 100, "context": "edit"}
        )
        for item in items or []:
            existing = unquote(Path(urlparse(item.get("source_url", "")).path).name)
            if existing == filename:
                return item
        return None

    def upload_media(self, filename: str, blob: bytes, mime: str, alt: str = "") -> dict:
        media = self.request(
            "POST",
            "/media",
            data=blob,
            headers={
                "Content-Type": mime,
                # الاسم لازم ASCII: latin-1 هي ترميز ترويسات HTTP، والعربي بيكسرها
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )
        if alt:
            self.set_media_alt(int(media["id"]), alt)
        return media

    def set_media_alt(self, media_id: int, alt: str) -> None:
        try:
            self.request("POST", f"/media/{media_id}", json_body={"alt_text": alt})
        except WPError:
            pass  # النص البديل تحسين، مش سبب لفشل النشر


def _norm_term(name: str) -> str:
    import html as _html

    return _html.unescape(name).strip().casefold()


def _slugify(text: str) -> str:
    text = unicodedata.normalize("NFKC", str(text)).strip().lower()
    text = re.sub(r"[ً-ْـ]", "", text)  # حركات وتطويل
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"[^\w؀-ۿ-]", "", text)
    return re.sub(r"-{2,}", "-", text).strip("-")[:190]


# ---------------------------------------------------------------- الصور


def _detect_image_mime(blob: bytes, filename: str) -> str:
    for magic, mime in _IMAGE_MAGIC:
        if blob.startswith(magic):
            return mime
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return "image/webp"
    head = blob[:400].lstrip().lower()
    if head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in head):
        raise WPError(
            f"{filename}: ملفات SVG مرفوضة — ممكن تحتوي كود، وووردبريس بيحجبها "
            "افتراضيًا. استخدم PNG أو JPG أو WebP."
        )
    raise WPError(f"{filename}: الملف ده مش صورة (البايتات مش بتطابق أي صيغة معروفة).")


_MIME_SUFFIX = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
}


def _ascii_filename(name: str, blob: bytes, mime: str) -> str:
    """
    اسم ملف ASCII آمن لترويسة HTTP، وفيه بصمة محتوى.

    الامتداد بييجي من النوع المكتشف مش من إدخال المستخدم. والبصمة ضرورية:
    الاعتماد على الاسم لوحده كان بيخلّي صورتين مختلفتين اسمهم hero.png
    يتعاملوا كصورة واحدة، فالمقال التاني بياخد صورة المقال الأول.
    """
    stem = Path(name).stem
    folded = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode("ascii")
    folded = re.sub(r"[^A-Za-z0-9._-]+", "-", folded).strip("-.")
    folded = re.sub(r"-{2,}", "-", folded)
    if not folded:
        folded = "image"
    digest = hashlib.sha256(blob).hexdigest()[:10]
    return f"{folded[:80]}-{digest}{_MIME_SUFFIX.get(mime, '.img')}"


def _media_roots(article_dir: Path) -> list[Path]:
    roots = [article_dir, CONTENT_DIR, ROOT / "images", ROOT]
    resolved: list[Path] = []
    for root in roots:
        try:
            resolved.append(root.resolve())
        except OSError:
            continue
    return resolved


def read_local_image(source: str, article_dir: Path) -> tuple[str, bytes, str]:
    """بيقرأ صورة محلية، محصورة جوه مجلدات المشروع ومتحقَّق إنها صورة فعلًا."""
    raw = Path(source)
    candidate = raw if raw.is_absolute() else (article_dir / source)
    try:
        path = candidate.resolve()
    except (OSError, ValueError) as exc:  # ValueError = NUL في المسار
        raise WPError(f"مسار صورة غير صالح: {source} — {exc}")

    roots = _media_roots(article_dir)
    if not any(path == root or root in path.parents for root in roots):
        raise WPError(
            f"مسار الصورة بره مجلدات المشروع: {source}\n"
            f"    حُط الصورة في {ROOT / 'images'} أو جنب المقال، وحُط مسار نسبي."
        )
    if not path.is_file():
        raise WPError(f"الصورة مش موجودة: {path}")

    size = path.stat().st_size
    if size > MAX_IMAGE_BYTES:
        raise WPError(f"{path.name}: حجم الصورة {size // 1024 // 1024}MB أكبر من الحد المسموح.")

    blob = path.read_bytes()
    return path.name, blob, _detect_image_mime(blob, path.name)


def _assert_public_host(url: str) -> None:
    """يمنع تنزيل صورة من عنوان داخلي (SSRF) — إلا لو مسموح صريح للاختبار."""
    if os.environ.get("WP_ALLOW_LOCAL_FETCH") == "1":
        return
    host = urlparse(url).hostname
    if not host:
        raise WPError(f"عنوان صورة غير صالح: {url}")
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as exc:
        raise WPError(f"مش قادر أحلّل اسم المضيف {host} — {exc}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise WPError(
                f"العنوان {host} بيحلّ لـ {ip} وهو عنوان داخلي — مرفوض.\n"
                "    نزّل الصورة محليًا وحُط مسارها، أو شغّل بـ WP_ALLOW_LOCAL_FETCH=1 "
                "لو ده سيرفر اختبار."
            )


def fetch_remote_image(url: str) -> tuple[str, bytes, str]:
    """ينزّل صورة من URL خارجي — بدون ترويسة المصادقة، وبحد أقصى للحجم."""
    if not url.lower().startswith(("https://", "http://")):
        raise WPError(f"عنوان صورة غير مدعوم: {url}")
    if url.lower().startswith("http://") and os.environ.get("WP_ALLOW_HTTP") != "1":
        raise WPError(f"عنوان الصورة على http مش https: {url}")
    _assert_public_host(url)

    try:
        with requests.get(
            url,
            timeout=45,
            stream=True,
            allow_redirects=False,
            headers={"User-Agent": "wp-publisher/1.0"},
        ) as resp:
            if resp.is_redirect or resp.is_permanent_redirect:
                raise WPError(f"عنوان الصورة بيعمل redirect — حُط العنوان النهائي: {url}")
            resp.raise_for_status()
            declared = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if declared and not declared.startswith("image/"):
                raise WPError(f"{url} مش صورة (Content-Type: {declared})")

            chunks, total = [], 0
            for chunk in resp.iter_content(65536):
                total += len(chunk)
                if total > MAX_IMAGE_BYTES:
                    raise WPError(f"الصورة من {url} أكبر من الحد المسموح.")
                chunks.append(chunk)
    except requests.RequestException as exc:
        raise WPError(f"مش قادر أنزّل الصورة من {url} — {exc}")

    blob = b"".join(chunks)
    if not blob:
        raise WPError(f"الصورة من {url} فاضية.")

    name = Path(urlparse(url).path).name or "image"
    mime = _detect_image_mime(blob, name)
    if not Path(name).suffix:
        name += mimetypes.guess_extension(mime) or ".jpg"
    return name, blob, mime


# ---------------------------------------------------------------- المقالات


@dataclass
class Article:
    path: Path
    meta: dict = field(default_factory=dict)
    body: str = ""

    @classmethod
    def load(cls, path: Path) -> "Article":
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise WPError(f"{path.name}: مش قادر أقرا الملف — {exc}")

        meta, body = _split_front_matter(raw, path.name)

        # المفاتيح الفاضية (`slug:` بدون قيمة) بتبقى None — لازم تتشال قبل أي استخدام،
        # وإلا الـ slug بيبقى نص "None" وكل المقالات تفضي على نفس المقال وتمسح بعضها
        meta = {k: v for k, v in meta.items() if v not in (None, "", [], {})}

        if not meta.get("title"):
            heading = _find_title_heading(body)
            if heading:
                title, start, end = heading
                meta["title"] = title.strip()
                body = body[:start] + body[end:]
        if not str(meta.get("title", "")).strip():
            raise WPError(
                f"{path.name}: مفيش عنوان — حدّد title في الـ front matter أو ابدأ بـ '# العنوان'"
            )

        # بننضّف الـ slug اللي المستخدم كتبه بنفس قواعد ووردبريس، وإلا اللي بيرجع
        # مختلف عن اللي بعتناه والمقال يتكرّر كل تشغيل
        slug = _slugify(meta.get("slug") or "") or _slugify(meta["title"])
        if not slug:
            raise WPError(
                f"{path.name}: مش قادر أولّد slug من العنوان — حدّد slug بنفسك في الـ front matter."
            )
        meta["slug"] = slug

        status = str(meta.get("status") or "").strip()
        if status:
            if status not in VALID_STATUSES:
                raise WPError(
                    f"{path.name}: status غير صالح {status!r} — "
                    f"المسموح: {', '.join(sorted(VALID_STATUSES))}"
                )
            if status == "future" and not meta.get("date"):
                raise WPError(
                    f"{path.name}: status: future محتاج تاريخ مستقبلي في حقل date، "
                    "وإلا ووردبريس بينشر المقال فورًا."
                )
            meta["status"] = status

        if "author" in meta:
            try:
                meta["author"] = int(meta["author"])
            except (TypeError, ValueError):
                raise WPError(f"{path.name}: author لازم يكون رقم (id اليوزر)، مش {meta['author']!r}")

        body = body.strip()
        if not body:
            raise WPError(
                f"{path.name}: المقال فاضي — النشر كان هيمسح محتوى المقال الموجود على الموقع."
            )
        return cls(path=path, meta=meta, body=body)


def _find_title_heading(body: str) -> tuple[str, int, int] | None:
    """
    يلاقي أول '# عنوان' برة أي كتلة كود. يرجّع (العنوان، بداية السطر، نهايته).

    البحث الأعمى بـ regex كان بيسحب سطر تعليق من جوه ``` ويعتبره عنوان المقال.
    """
    in_fence = False
    offset = 0
    for line in body.split("\n"):
        length = len(line) + 1  # +1 للسطر الجديد
        if re.match(r"^\s*(?:```|~~~)", line):
            in_fence = not in_fence
        elif not in_fence:
            match = re.match(r"^#\s+(.+?)\s*$", line)
            if match:
                return match.group(1), offset, offset + length
        offset += length
    return None


def _split_front_matter(raw: str, name: str) -> tuple[dict, str]:
    lines = raw.replace("\r\n", "\n").split("\n")
    first = next((i for i, line in enumerate(lines) if line.strip()), None)
    if first is None or lines[first].strip() != "---":
        return {}, raw
    # الفاصل سطر لوحده بس — '---' جوه قيمة كان بيقطع البيانات نصّها
    closing = next(
        (i for i in range(first + 1, len(lines)) if lines[i].strip() in ("---", "...")), None
    )
    if closing is None:
        return {}, raw
    head = "\n".join(lines[first + 1 : closing])
    body = "\n".join(lines[closing + 1 :])

    try:
        import yaml

        try:
            meta = yaml.safe_load(head) or {}
        except yaml.YAMLError as exc:
            raise WPError(f"{name}: الـ front matter مش صالح — {exc}")
    except ImportError:
        meta = _mini_yaml(head)

    if not isinstance(meta, dict):
        raise WPError(f"{name}: الـ front matter لازم يكون قائمة مفاتيح، مش {type(meta).__name__}")
    return meta, body


def _mini_yaml(text: str) -> dict:
    """بديل بسيط لـ PyYAML: key: value، و [a, b]، والقوائم بـ '- '."""
    out: dict[str, Any] = {}
    key: str | None = None
    for raw in text.splitlines():
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        if raw.lstrip().startswith("- ") and key:
            if not isinstance(out.get(key), list):
                out[key] = []
            out[key].append(raw.lstrip()[2:].strip().strip("'\""))
            continue
        if ":" not in raw:
            continue
        key, _, value = raw.partition(":")
        key, value = key.strip(), value.strip()
        if not value:
            out[key] = None
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
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return [v.strip() for v in str(value).split(",") if v.strip()]


def _looks_arabic(text: str) -> bool:
    """نسبة الحروف العربية للحروف كلها — بعد شيل الكود والروابط والوسوم."""
    cleaned = re.sub(r"```.*?```", " ", text, flags=re.S)
    cleaned = re.sub(r"`[^`]*`", " ", cleaned)
    cleaned = re.sub(r"https?://\S+", " ", cleaned)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    arabic = len(re.findall(r"[ء-ي]", cleaned))
    latin = len(re.findall(r"[A-Za-z]", cleaned))
    if arabic + latin == 0:
        return False
    return arabic / (arabic + latin) > 0.3


def _normalize_date(value: str) -> str:
    """ووردبريس بيرفض تاريخ بدون وقت — بنكمّله."""
    text = str(value).strip().replace(" ", "T", 1)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return f"{text}T00:00:00"
    return text


def _parse_date(value: str) -> "datetime | None":
    text = _normalize_date(value)[:19]
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _to_gmt(value: str, offset_hours: float) -> str:
    """
    يحوّل تاريخ المقال (بتوقيت الموقع) لـ UTC.

    ووردبريس بيفهم حقل `date` بتوقيت الموقع، والأداة ممكن تشتغل على سيرفر
    بتوقيت مختلف (الـ CI بيبقى UTC عادة). بنبعت `date_gmt` علشان مفيش لبس،
    وووردبريس هو اللي يحسب التوقيت المحلي.
    """
    parsed = _parse_date(value)
    if parsed is None:
        raise WPError(
            f"تاريخ غير مفهوم: {value!r} — استخدم 2026-10-01 أو 2026-10-01T09:00:00"
        )
    return (parsed - timedelta(hours=offset_hours)).strftime("%Y-%m-%dT%H:%M:%S")


def _is_future_gmt(gmt_value: str) -> bool:
    parsed = _parse_date(gmt_value)
    if parsed is None:
        return False
    return parsed > datetime.utcnow()


# ---------------------------------------------------------------- بناء الطلب


def build_payload(
    client: WPClient | None,
    art: Article,
    override_status: str | None,
    *,
    is_update: bool,
    verbose: bool = False,
    state_entry: dict | None = None,
) -> dict:
    meta = art.meta
    direction = meta.get("dir") or ("rtl" if _looks_arabic(art.body) else None)

    payload: dict[str, Any] = {
        "title": str(meta["title"]),
        "content": md_to_blocks(art.body, direction),
    }

    # على التحديث بنبعت الـ slug بس لو المستخدم غيّره في الملف. غير كده بنسيبه،
    # علشان تعديل الرابط الدائم من لوحة التحكم ميترجعش كل تشغيل.
    recorded_slug = (state_entry or {}).get("requested_slug")
    if not is_update or recorded_slug != str(meta["slug"]):
        payload["slug"] = str(meta["slug"])

    excerpt = str(meta.get("excerpt") or plain_excerpt(art.body))
    if excerpt:
        payload["excerpt"] = excerpt

    date_gmt = None
    if meta.get("date"):
        offset = client.gmt_offset_hours() if client is not None else 0.0
        date_gmt = _to_gmt(str(meta["date"]), offset)
        payload["date_gmt"] = date_gmt

    # الحالة: على التحديث مش بنبعتها إلا لو مطلوبة صريح، وإلا كل تشغيل
    # بيرجّع المقالات المنشورة لـ draft
    explicit_status = override_status or meta.get("status")
    if explicit_status or not is_update:
        status = str(explicit_status or "draft")
        if date_gmt and status == "publish" and _is_future_gmt(date_gmt):
            status = "future"  # نشر مجدول
        payload["status"] = status
    if meta.get("comment_status"):
        payload["comment_status"] = str(meta["comment_status"])
    if meta.get("author"):
        payload["author"] = int(meta["author"])

    if client is not None:
        cats = _as_list(meta.get("categories"))
        if cats:
            payload["categories"] = [client.resolve_term(c, "categories") for c in cats]
        tags = _as_list(meta.get("tags"))
        if tags:
            payload["tags"] = [client.resolve_term(t, "tags") for t in tags]

        if meta.get("featured_image"):
            media = resolve_featured_media(
                client, art, str(meta.get("featured_alt", "")), verbose, state_entry
            )
            payload["featured_media"] = int(media["id"])

    return payload


def resolve_featured_media(
    client: WPClient,
    art: Article,
    alt: str,
    verbose: bool,
    state_entry: dict | None,
) -> dict:
    """بيرفع الصورة البارزة، وبيعيد استخدام المرفوعة قبل كده بدل ما يكرّرها."""
    source = str(art.meta["featured_image"])

    # أسرع مسار: الصورة اللي اتربطت بالمقال ده قبل كده
    recorded = (state_entry or {}).get("featured_media")
    recorded_source = (state_entry or {}).get("featured_source")
    if recorded and recorded_source == source:
        try:
            existing = client.request("GET", f"/media/{recorded}", params={"context": "edit"})
            if existing:
                if alt and existing.get("alt_text") != alt:
                    client.set_media_alt(int(existing["id"]), alt)
                if verbose:
                    print(f"    صورة بارزة: #{existing['id']} (موجودة، اتعيد استخدامها)")
                return existing
        except WPError:
            pass  # اتمسحت من المكتبة — نرفع تاني

    if source.startswith(("http://", "https://")):
        name, blob, mime = fetch_remote_image(source)
    else:
        name, blob, mime = read_local_image(source, art.path.parent)

    filename = _ascii_filename(name, blob, mime)
    found = client.find_media(filename)
    if found:
        if alt and found.get("alt_text") != alt:
            client.set_media_alt(int(found["id"]), alt)
        if verbose:
            print(f"    صورة بارزة: #{found['id']} (موجودة بنفس الاسم)")
        return found

    media = client.upload_media(filename, blob, mime, alt or Path(name).stem)
    if verbose:
        print(f"    صورة بارزة: #{media['id']} {media.get('source_url', '')}")
    return media


def apply_seo(client: WPClient, post_id: int, art: Article, verbose: bool) -> None:
    """يكتب عنوان ووصف السيو، وبيتحقق أي بلجن قبلهم فعلًا."""
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
        updated = client.request("POST", f"/posts/{post_id}", json_body={"meta": meta_payload})
    except WPError as exc:
        print(
            f"    تنبيه: الموقع رفض حقول السيو ({exc}). المقال نزل عادي — "
            "اكتب العنوان والوصف من لوحة التحكم.",
            file=sys.stderr,
        )
        return

    stored = (updated or {}).get("meta") or {}
    accepted = [
        plugin
        for plugin, keys in SEO_META_KEYS.items()
        if (not seo_title or stored.get(keys["title"]) == str(seo_title))
        and (not seo_desc or stored.get(keys["description"]) == str(seo_desc))
    ]
    if accepted:
        if verbose:
            print(f"    SEO meta: ثبتت في {', '.join(accepted)}")
    else:
        print(
            "    تنبيه: حقول السيو اتبعتت لكن الموقع مخزّنهاش — بلجن السيو محتاج "
            "يسجّل الحقول في REST. المقال نزل عادي، اكتبهم من لوحة التحكم.",
            file=sys.stderr,
        )


# ---------------------------------------------------------------- تحديد الهدف


def resolve_existing(
    client: WPClient,
    art: Article,
    state_entry: dict | None,
    *,
    state: dict | None = None,
    key: str = "",
    site: str = "",
) -> tuple[dict | None, list[str]]:
    """
    بيلاقي المقال الموجود على الموقع، بالـ id المسجّل الأول وبعدين بالـ slug.
    بيرجّع (المقال أو None، تحذيرات).
    """
    warnings: list[str] = []
    slug = str(art.meta["slug"])
    recorded_id = (state_entry or {}).get("id")

    if recorded_id:
        post = client.get_post(int(recorded_id))
        if post and post.get("status") in ("trash", "auto-draft"):
            raise WPError(
                f"المقال #{post['id']} حالته {post.get('status')} — التحديث كان هيكتب "
                "جواه ومحدش هيشوفه.\n"
                "    استعيده من سلة المحذوفات، أو غيّر الـ slug علشان يتعمل مقال جديد."
            )
        if post:
            if unquote(str(post.get("slug") or "")) != slug and post.get("slug") != slug:
                warnings.append(
                    f"الموقع حافظ على slug مختلف للمقال ده: {post.get('slug')!r} "
                    f"(انت طلبت {slug!r}) — بنحدّث نفس المقال #{post['id']}."
                )
            return post, warnings
        warnings.append(f"المقال المسجّل #{recorded_id} مش موجود على الموقع — بندوّر بالـ slug.")

    post = client.find_by_slug(slug)
    if post:
        title = (post.get("title") or {}).get("raw") or ""
        # مقال مسجّل لملف تاني = تصادم slug. الكتابة فوقه بتمسح مقال منشور،
        # فبنوقف بدل ما ننبّه ونكمل.
        owner = _post_owner(state or {}, int(post["id"]), key, site)
        if owner:
            raise WPError(
                f"الـ slug {slug!r} بيوصل لمقال #{post['id']} ({title[:40]!r}) "
                f"المسجّل للملف {owner!r}.\n"
                "    غيّر الـ slug في واحد من الملفين — الكتابة فوقه هتمسح المقال."
            )
        if recorded_id and int(post["id"]) != int(recorded_id):
            warnings.append(
                f"تنبيه: فيه مقال #{post['id']} بنفس الـ slug ({title[:40]!r}) مختلف عن "
                "المسجّل لملفك — التحديث هيكتب فوقه. غيّر الـ slug لو مش بتاعك."
            )
        elif not recorded_id:
            # مقال موجود على الموقع والأداة عمرها ما نشرته من الملف ده. ممكن يكون
            # مقال المستخدم (بيربط الملف بيه) وممكن يكون مقال تاني بنفس الـ slug.
            warnings.append(
                f"المقال #{post['id']} ({title[:40]!r}) موجود على الموقع بنفس الـ slug "
                "والأداة عمرها ما نشرته من الملف ده — التحديث هيكتب فوقه.\n"
                "      لو ده مش مقال الملف ده، أوقف وغيّر الـ slug."
            )
    return post, warnings


# ---------------------------------------------------------------- الأوامر


def cmd_doctor(cfg: Config, args: argparse.Namespace) -> int:
    print(f"الموقع: {cfg.site}")
    print(f"اليوزر: {cfg.user}")
    print("الباسورد: مضبوط ✓")  # مفيش أي حرف من السر ولا طوله
    client = WPClient(cfg)
    problems: list[str] = []

    print("\n[1/4] REST API شغال؟")
    try:
        routes = client.routes()
    except WPError as exc:
        print(f"      ✗ {exc}")
        print("\nالخلاصة: مش قادر أوصل لـ REST API ✗")
        return 2
    for route in REQUIRED_ROUTES:
        present = route in routes
        print(f"      {'✓' if present else '✗'} {route}")
        if not present:
            problems.append(f"المسار {route} مش متاح")

    print("\n[2/4] المصادقة")
    me = client.me()
    print(f"      ✓ داخل كـ: {me.get('name')} (id={me.get('id')}, slug={me.get('slug')})")
    print(f"      الأدوار: {', '.join(me.get('roles') or []) or 'غير معروف'}")

    print("\n[3/4] الصلاحيات المطلوبة للنشر")
    caps = me.get("capabilities") or {}
    for cap, label in REQUIRED_CAPS:
        present = bool(caps.get(cap))
        print(f"      {'✓' if present else '✗'} {label} ({cap})")
        if not present:
            problems.append(f"صلاحية {cap} ناقصة")

    print("\n[4/4] قراءة المقالات")
    posts = client.request(
        "GET", "/posts", params={"per_page": 1, "status": "any", "_fields": "id"}
    )
    readable = isinstance(posts, list)
    print(f"      {'✓ تمام' if readable else '✗'}")
    if not readable:
        problems.append("مش قادر أقرا المقالات")

    if problems:
        print("\nالخلاصة: الأتمتة مش جاهزة ✗")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("\nالخلاصة: الأتمتة جاهزة ✓")
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
    for post in posts:
        title_obj = post.get("title") or {}
        title = title_obj.get("raw") or title_obj.get("rendered", "")
        print(f"#{post['id']:<6} [{post['status']:<8}] {str(post.get('date',''))[:10]}  {title}")
        print(f"        {post.get('link', '')}")
    return 0


def cmd_publish(cfg: Config, args: argparse.Namespace) -> int:
    files = _collect_files(args)
    if not files:
        if args.all:
            print(f"مفيش ملفات .md في {CONTENT_DIR} — ابدأ من content/_template.md")
        else:
            print("حدّد ملفات، أو استخدم --all لنشر كل content/*.md")
        return 1

    if args.dry_run:  # المعاينة قراءة فقط، مش محتاجة قفل
        return _publish_files(cfg, args, files)
    with PublishLock(STATE_FILE.parent / f"{STATE_FILE.name}.lock"):
        return _publish_files(cfg, args, files)


def _publish_files(cfg: Config, args: argparse.Namespace, files: list[Path]) -> int:
    client = WPClient(cfg)
    me = client.me()
    print(f"داخل كـ {me.get('name')} على {cfg.site}")
    if args.dry_run:
        print("(معاينة — مفيش أي كتابة على الموقع)")
    print()

    state = _load_state()
    done = failed = 0

    for path in files:
        print(f"→ {path.name}")
        try:
            art = Article.load(path)
            key = _state_key(path)
            entry = _state_entry(state, key, cfg.site)
            existing, warnings = resolve_existing(
                client, art, entry, state=state, key=key, site=cfg.site
            )
            for warning in warnings:
                print(f"    ! {warning}")

            if args.dry_run:
                payload = build_payload(
                    None, art, args.status, is_update=bool(existing), state_entry=entry
                )
                if existing:
                    current = (existing.get("title") or {}).get("raw") or ""
                    print(
                        f"    سيتم التحديث #{existing['id']} "
                        f"[{existing.get('status')}] {current[:60]!r}"
                    )
                else:
                    print("    سيتم الإنشاء (مقال جديد)")
                print(f"    العنوان: {payload['title']}")
                print(f"    الرابط:  {cfg.site}/{payload['slug']}")
                print(f"    الحالة:  {payload.get('status', '(بدون تغيير)')}")
                print(f"    تصنيفات: {', '.join(_as_list(art.meta.get('categories'))) or '—'}")
                print(f"    وسوم:    {', '.join(_as_list(art.meta.get('tags'))) or '—'}")
                print(f"    الحجم:   {len(payload['content'])} حرف HTML")
                done += 1
                continue

            payload = build_payload(
                client,
                art,
                args.status,
                is_update=bool(existing),
                verbose=args.verbose,
                state_entry=entry,
            )
            if existing:
                post = client.request("POST", f"/posts/{existing['id']}", json_body=payload)
                action = "تحديث"
            else:
                post = client.request("POST", "/posts", json_body=payload)
                action = "إنشاء"

            apply_seo(client, int(post["id"]), art, args.verbose)
            wanted = payload.get("status")
            if wanted and post.get("status") != wanted:
                print(
                    f"    ! طلبنا الحالة {wanted!r} والموقع خلّاها {post.get('status')!r} "
                    "— راجع التاريخ وتوقيت الموقع وصلاحيات اليوزر."
                )
            print(f"    ✓ {action} #{post['id']} [{post.get('status')}] → {post.get('link')}")
            state[key] = {
                "site": cfg.site,
                "id": post.get("id"),
                "slug": post.get("slug"),
                "requested_slug": str(art.meta["slug"]),
                "status": post.get("status"),
                "link": post.get("link"),
                "featured_media": payload.get("featured_media"),
                "featured_source": art.meta.get("featured_image"),
                "synced_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            _save_state(state)
            done += 1

        except WPError as exc:
            print(f"    ✗ {exc}", file=sys.stderr)
            failed += 1
        except Exception as exc:  # ملف واحد بايظ مش بيوقّف الدفعة
            print(f"    ✗ خطأ غير متوقع: {type(exc).__name__}: {exc}", file=sys.stderr)
            failed += 1

    print(f"\nالنتيجة: {done} نجح، {failed} فشل.")
    if args.dry_run:
        print("(معاينة فقط — مفيش حاجة نزلت على الموقع)")
    return 1 if failed else 0


def _collect_files(args: argparse.Namespace) -> list[Path]:
    if args.files:
        return [Path(f).resolve() for f in args.files]
    if args.all:
        return sorted(p for p in CONTENT_DIR.glob("*.md") if not p.name.startswith("_"))
    return []


def _state_key(path: Path) -> str:
    """
    مفتاح السجل = المسار النسبي من مجلد المحتوى.

    الاسم المجرّد مكانش كفاية: ملفين اسمهم index.md في مجلدين مختلفين كانوا
    بياخدوا نفس السجل، فالتاني بيكتب فوق مقال الأول.
    """
    resolved = path.resolve()
    try:
        return resolved.relative_to(CONTENT_DIR.resolve()).as_posix()
    except ValueError:
        return resolved.as_posix()


def _state_entry(state: dict, key: str, site: str) -> dict | None:
    """سجل الملف ده لهذا الموقع، أو None لو مش موجود أو تالف أو لموقع تاني."""
    entry = state.get(key)
    if not isinstance(entry, dict):
        return None  # سجل تالف مينفعش يقفل النشر للأبد
    if entry.get("site") and entry["site"] != site:
        return None  # أرقام مقالات موقع تاني
    # الرقم لازم يبقى رقم — سجل مكتوب بالإيد أو نصّه ناقص مينفعش يرمي استثناء
    entry = dict(entry)
    try:
        entry["id"] = int(entry["id"]) if entry.get("id") is not None else None
    except (TypeError, ValueError):
        entry["id"] = None
    return entry


def _post_owner(state: dict, post_id: int, exclude_key: str, site: str) -> str | None:
    """اسم الملف اللي مسجّل إنه صاحب المقال ده — لو فيه ملف تاني."""
    for key, entry in state.items():
        if key == exclude_key or not isinstance(entry, dict):
            continue
        if entry.get("site") and entry["site"] != site:
            continue
        try:
            if int(entry.get("id") or 0) == int(post_id):
                return key
        except (TypeError, ValueError):
            continue
    return None


class PublishLock:
    """
    قفل بسيط بملف — تشغيلين في نفس الوقت كانوا بيعملوا مقالات مكررة
    (الاتنين بيدوّروا فمبيلاقوش حاجة، والاتنين بينشئوا).
    """

    STALE_SECONDS = 1800

    def __init__(self, path: Path):
        self.path = path
        self.acquired = False

    def __enter__(self) -> "PublishLock":
        for attempt in (1, 2):
            try:
                fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                age = time.time() - self._mtime()
                if age > self.STALE_SECONDS and attempt == 1:
                    self._unlink()  # تشغيل قديم مات وسايب القفل
                    continue
                raise WPError(
                    f"فيه نشر تاني شغال (قفل: {self.path}).\n"
                    "    استنى لحد ما يخلص، أو امسح الملف ده لو التشغيل القديم وقع."
                )
            except OSError as exc:
                return self  # مش قادرين نعمل قفل (نظام ملفات للقراءة) — نكمل
            else:
                with os.fdopen(fd, "w") as handle:
                    handle.write(f"{os.getpid()} {time.strftime('%Y-%m-%dT%H:%M:%S')}\n")
                self.acquired = True
                return self
        return self

    def __exit__(self, *exc) -> None:
        if self.acquired:
            self._unlink()

    def _mtime(self) -> float:
        try:
            return self.path.stat().st_mtime
        except OSError:
            return 0.0

    def _unlink(self) -> None:
        try:
            self.path.unlink()
        except OSError:
            pass

def _load_state() -> dict:
    try:
        if STATE_FILE.is_file():
            loaded = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                return loaded
    except (ValueError, OSError):
        pass
    return {}


def _save_state(state: dict) -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass  # السجل تحسين، مش شرط للنشر


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="wp_publish.py",
        description="نشر المقالات آليًا على ووردبريس عبر REST API",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_doctor = sub.add_parser("doctor", help="اختبار الاتصال والمصادقة والصلاحيات")
    p_doctor.set_defaults(func=cmd_doctor)

    p_list = sub.add_parser("list", help="عرض آخر المقالات على الموقع")
    p_list.add_argument(
        "--limit",
        type=lambda v: max(1, min(100, int(v))),
        default=10,
        help="عدد المقالات (1-100، حد ووردبريس)",
    )
    p_list.set_defaults(func=cmd_list)

    p_pub = sub.add_parser("publish", help="نشر أو تحديث مقالات من ملفات Markdown")
    p_pub.add_argument("files", nargs="*", help="ملفات .md محددة")
    p_pub.add_argument("--all", action="store_true", help="كل ملفات content/*.md")
    p_pub.add_argument(
        "--status",
        choices=["draft", "publish", "pending", "private"],
        help="يتخطى الحالة المكتوبة في الملف (وبيتطبّق على المقالات الموجودة كمان)",
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
