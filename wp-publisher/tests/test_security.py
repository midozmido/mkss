"""
أمان الأداة — بتحمل بيانات دخول لموقع حقيقي، فكل واحد من دول ناقل هجوم مثبت.
"""
import http.server
import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import PNG_BYTES, PublisherTestCase  # noqa: E402


class TestLocalFileAccess(PublisherTestCase):
    """featured_image كان بيقرا أي ملف على الجهاز ويرفعه للموقع."""

    def test_absolute_path_outside_project_rejected(self):
        self.article("a.md", "title: تسريب\nslug: leak\nfeatured_image: /etc/passwd")
        result = self.run_cli("publish", "--all")
        self.assertFailsCleanly(result)
        self.assertEqual(len(self.wp.media), 0, "ملف من بره المشروع اترفع للموقع")

    def test_path_traversal_rejected(self):
        self.article("a.md", "title: تسلق\nslug: trav\nfeatured_image: ../../../../etc/hostname")
        result = self.run_cli("publish", "--all")
        self.assertFailsCleanly(result)
        self.assertEqual(len(self.wp.media), 0)

    def test_image_inside_project_allowed(self):
        """الصور الشرعية جوه المشروع بترفع عادي."""
        self.image("hero.png")
        self.article("a.md", "title: صورة\nslug: img\nfeatured_image: hero.png")
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.media), 1)

    def test_non_image_rejected_by_content(self):
        """الفحص بالبايتات مش بالامتداد — ملف نصي باسم .png اترفض."""
        (self.content / "fake.png").write_text("مش صورة", encoding="utf-8")
        self.article("a.md", "title: مزيفة\nslug: fake\nfeatured_image: fake.png")
        result = self.run_cli("publish", "--all")
        self.assertFailsCleanly(result, contains="مش صورة")
        self.assertEqual(len(self.wp.media), 0)

    def test_svg_rejected(self):
        """SVG ممكن يحتوي سكربت، وووردبريس بيحجبها افتراضيًا."""
        (self.content / "x.png").write_text('<svg onload="alert(1)"></svg>', encoding="utf-8")
        self.article("a.md", "title: svg\nslug: svg\nfeatured_image: x.png")
        result = self.run_cli("publish", "--all")
        self.assertFailsCleanly(result, contains="SVG")
        self.assertEqual(len(self.wp.media), 0)


class TestSSRF(PublisherTestCase):
    """صورة من URL كانت طلب شبكة غير مقيّد من جوه شبكة المستخدم."""

    def test_metadata_endpoint_rejected(self):
        self.article(
            "a.md",
            "title: ssrf\nslug: ssrf\nfeatured_image: http://169.254.169.254/latest/meta-data/",
        )
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="0")
        self.assertFailsCleanly(result)
        self.assertEqual(len(self.wp.media), 0)

    def test_private_range_rejected(self):
        self.article("a.md", "title: داخلي\nslug: p\nfeatured_image: http://10.0.0.1/a.png")
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="0")
        self.assertFailsCleanly(result)
        self.assertEqual(len(self.wp.media), 0)


class TestRemoteImage(PublisherTestCase):
    """تنزيل صورة من URL — بيتحقق من النوع ومش بيتبع redirect."""

    def _serve(self, body: bytes, content_type: str, *, redirect_to: str = ""):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if redirect_to:
                    self.send_response(302)
                    self.send_header("Location", redirect_to)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}"

    def test_remote_png_uploaded(self):
        base = self._serve(PNG_BYTES, "image/png")
        self.article("a.md", f"title: بعيدة\nslug: remote\nfeatured_image: {base}/hero.png")
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.media), 1)
        self.assertEqual(self.wp.posts[0]["featured_media"], self.wp.media[0]["id"])

    def test_html_served_as_image_rejected(self):
        base = self._serve(b"<html>not an image</html>", "text/html")
        self.article("a.md", f"title: HTML\nslug: h\nfeatured_image: {base}/a.png")
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertFailsCleanly(result)
        self.assertEqual(len(self.wp.media), 0)

    def test_redirect_not_followed(self):
        """اتباع redirect بيسمح بتخطي فحص العنوان الداخلي."""
        base = self._serve(b"", "image/png", redirect_to="http://169.254.169.254/a.png")
        self.article("a.md", f"title: تحويل\nslug: r\nfeatured_image: {base}/a.png")
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertFailsCleanly(result, contains="redirect")
        self.assertEqual(len(self.wp.media), 0)


class TestCredentialHandling(PublisherTestCase):
    def test_http_site_refused_without_optin(self):
        """الموقع على http = الباسورد بيتبعت مكشوف. مرفوض إلا بإذن صريح."""
        env = self.env()
        env.pop("WP_ALLOW_HTTP")
        import subprocess

        from helpers import ROOT

        result = subprocess.run(
            [sys.executable, "wp_publish.py", "doctor"],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(ROOT),
            timeout=60,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("https", result.stdout + result.stderr)

    def test_credentials_not_sent_to_redirect_host(self):
        """redirect لمضيف تاني ممكن يسرّب ترويسة Authorization."""
        import subprocess

        from helpers import ROOT

        class Redirector(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(301)
                self.send_header("Location", "https://evil.example.com/wp-json/")
                self.end_headers()

            def log_message(self, *a):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Redirector)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

        env = self.env(WP_SITE_URL=f"http://127.0.0.1:{server.server_address[1]}")
        result = subprocess.run(
            [sys.executable, "wp_publish.py", "doctor"],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(ROOT),
            timeout=60,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("redirect", result.stdout + result.stderr)

    def test_password_absent_from_all_output(self):
        self.article("a.md", "title: مقال\nslug: p")
        for args in (("doctor",), ("publish", "--all", "-v"), ("list",)):
            result = self.run_cli(*args)
            self.assertNotIn(self.wp.password, result.output, f"السر ظهر في {args}")


class TestContentInjection(PublisherTestCase):
    """محتوى المقال بينزل على موقع حقيقي — لازم ينزل خامل."""

    def test_script_in_body_never_reaches_site_live(self):
        self.article("a.md", "title: حقن\nslug: inj", "نص فيه <script>alert(1)</script> جواه.")
        self.run_cli("publish", "--all")
        content = self.wp.post_by_slug("inj")["content"]["raw"]
        self.assertNotIn("<script", content.lower(), content)
        self.assertIn("&lt;script&gt;", content)

    def test_raw_html_block_is_sanitized(self):
        self.article(
            "a.md",
            "title: خام\nslug: raw",
            '<div onclick="steal()">نص</div>\n\n<script>alert(1)</script>',
        )
        self.run_cli("publish", "--all")
        content = self.wp.post_by_slug("raw")["content"]["raw"].lower()
        self.assertNotIn("<script", content)
        self.assertNotIn("onclick", content)
        self.assertIn("نص", self.wp.post_by_slug("raw")["content"]["raw"])

    def test_javascript_url_dropped(self):
        self.article("a.md", "title: رابط\nslug: js", "[اضغط](javascript:alert(1))")
        self.run_cli("publish", "--all")
        content = self.wp.post_by_slug("js")["content"]["raw"]
        self.assertNotIn("javascript:", content)
        self.assertIn("اضغط", content)


if __name__ == "__main__":
    unittest.main()
