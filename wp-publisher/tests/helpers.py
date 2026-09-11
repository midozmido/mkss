"""أدوات مشتركة لاختبارات الناشر — تشغيل معزول بالكامل عن بيئة المطوّر."""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from mock_wp import MockWP  # noqa: E402

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 120
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 120


class PublisherTestCase(unittest.TestCase):
    """
    يقوم سيرفر ووردبريس مزيّف + مجلد محتوى مؤقت لكل اختبار.

    كل تشغيل معزول: WP_ENV_FILE=/dev/null يمنع أي .env عند المطوّر من التسرب،
    والمحتوى والسجل في مجلد مؤقت، والسيرفر بيتقفل في tearDown.
    """

    scenario = "ok"
    password: str | None = None

    def setUp(self) -> None:
        self.wp = MockWP(self.scenario)
        self.wp.start()
        self.addCleanup(self.wp.stop)
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.content = Path(self._tmp.name)

    # --- بناء المقالات

    def article(self, name: str, front_matter: str = "", body: str = "نص المقال للاختبار.") -> Path:
        path = self.content / name
        text = f"---\n{front_matter}\n---\n\n{body}\n" if front_matter else f"{body}\n"
        path.write_text(text, encoding="utf-8")
        return path

    def image(self, name: str, blob: bytes = PNG_BYTES) -> Path:
        path = self.content / name
        path.write_bytes(blob)
        return path

    # --- تشغيل الأداة

    # بيئة المطوّر مش بتتنسخ — متغير زي WP_MAX_RETRIES أو proxy عنده
    # كان بيخلّي نتيجة الاختبار تختلف من جهاز لجهاز
    INHERIT = ("PATH", "HOME", "LANG", "LC_ALL", "PYTHONPATH", "SYSTEMROOT", "TMPDIR")

    def env(self, **extra: str) -> dict[str, str]:
        env = {
            **{k: v for k, v in os.environ.items() if k in self.INHERIT},
            "NO_PROXY": "127.0.0.1,localhost",
            "no_proxy": "127.0.0.1,localhost",
            "WP_MAX_RETRIES": "2",
            "WP_TIMEOUT": "15",
            "WP_ALLOW_LOCAL_FETCH": "0",
            "WP_SITE_GMT_OFFSET": "0",
            "WP_SITE_URL": self.wp.url,
            "WP_USERNAME": self.wp.user,
            "WP_APP_PASSWORD": self.password or self.wp.password,
            "WP_ENV_FILE": "/dev/null",
            "WP_CONTENT_DIR": str(self.content),
            "WP_STATE_FILE": str(self.content / ".published.json"),
            "WP_ALLOW_HTTP": "1",  # السيرفر المزيّف على http محلي
        }
        env.update(extra)
        return env

    def run_cli(self, *args: str, timeout: int = 90, **env_extra: str):
        """يشغّل الأداة كعملية منفصلة — يختبر argv وأكواد الخروج والمخرجات الحقيقية."""
        result = subprocess.run(
            [sys.executable, "wp_publish.py", *args],
            capture_output=True,
            text=True,
            env=self.env(**env_extra),
            cwd=str(ROOT),
            timeout=timeout,
        )
        result.output = result.stdout + result.stderr
        return result

    # --- تأكيدات مساعدة

    def assertNoTraceback(self, result) -> None:
        self.assertNotIn(
            "Traceback", result.stderr, f"طلع traceback بدل رسالة خطأ واضحة:\n{result.stderr}"
        )

    def assertFailsCleanly(self, result, *, contains: str = "") -> None:
        self.assertNotEqual(result.returncode, 0, f"المفروض يفشل لكنه نجح:\n{result.output}")
        self.assertNoTraceback(result)
        if contains:
            self.assertIn(contains, result.output, f"الرسالة مش بتوضّح السبب:\n{result.output}")
