"""
كل عطل لازم يفشل بصوت عالي وبرسالة مفيدة — مش traceback ومش نجاح كاذب.
"""
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import ROOT, PublisherTestCase  # noqa: E402


class TestBadCredentials(PublisherTestCase):
    scenario = "bad_auth"
    password = "definitely-the-wrong-password"

    def test_401_explains_the_cause(self):
        """الرسالة لازم تقول إن البيانات غلط أو الترويسة محجوبة."""
        result = self.run_cli("doctor")
        self.assertFailsCleanly(result)
        self.assertIn("401", result.output)
        self.assertIn("password", result.output.lower() + "password")

    def test_publish_does_not_partially_write(self):
        self.article("a.md", "title: مقال\nslug: p")
        result = self.run_cli("publish", "--all")
        self.assertFailsCleanly(result)
        self.assertEqual(len(self.wp.posts), 0)


class TestStrippedAuthHeader(PublisherTestCase):
    """سيرفرات Apache + CGI بترمي ترويسة Authorization — أشهر مشكلة في الميدان."""

    scenario = "strip_auth"

    def test_message_points_at_the_header(self):
        result = self.run_cli("doctor")
        self.assertFailsCleanly(result)
        self.assertIn("Authorization", result.output)


class TestMissingCapabilities(PublisherTestCase):
    scenario = "no_publish"

    def test_doctor_reports_not_ready(self):
        """doctor ممنوع يقول 'جاهزة' وهو عارف إن النشر مستحيل."""
        result = self.run_cli("doctor")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("جاهزة ✓", result.stdout)
        self.assertIn("publish_posts", result.stdout)

    def test_publish_fails_with_403(self):
        self.article("a.md", "title: مقال\nslug: p")
        result = self.run_cli("publish", "--all")
        self.assertFailsCleanly(result)
        self.assertEqual(len(self.wp.posts), 0)


class TestNoUploadCapability(PublisherTestCase):
    scenario = "no_upload"

    def test_featured_image_failure_is_clear(self):
        self.image("hero.png")
        self.article("a.md", "title: صورة\nslug: img\nfeatured_image: hero.png")
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertFailsCleanly(result)
        self.assertIn("403", result.output)


class TestRestBlocked(PublisherTestCase):
    scenario = "not_json"

    def test_html_response_says_not_json(self):
        """بلجن أمان بيرجّع HTML — الرسالة لازم توضّح السبب."""
        result = self.run_cli("doctor")
        self.assertFailsCleanly(result)
        self.assertIn("JSON", result.output)


class TestRestDisabled(PublisherTestCase):
    scenario = "rest_disabled"

    def test_404_everywhere_fails_cleanly(self):
        result = self.run_cli("doctor")
        self.assertFailsCleanly(result)
        self.assertIn("REST", result.output)


class TestTransientServerErrors(PublisherTestCase):
    """السيرفر بيرجّع 503 مرتين وبعدين يشتغل."""

    scenario = "flaky"

    def test_reads_retry_and_publish_succeeds_once(self):
        """القراءة بتتكرّر وتنجح — والكتابة مبتتكرّرش فمفيش مقال مكرر."""
        self.article("a.md", "title: متقطع\nslug: flaky")
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.posts), 1, [p["slug"] for p in self.wp.posts])

    def test_write_is_never_retried(self):
        """إعادة إرسال POST ممكن تعمل مقالات مكررة — ممنوع تمامًا."""
        self.article("a.md", "title: متقطع\nslug: flaky2")
        self.run_cli("publish", "--all")
        creates = [
            r for r in self.wp.requests if r["method"] == "POST" and r["path"].endswith("/posts")
        ]
        self.assertLessEqual(len(creates), 1, f"الكتابة اتكرّرت {len(creates)} مرات")


class TestMissingConfiguration(unittest.TestCase):
    """بيانات ناقصة — بنشغّل بـ WP_ENV_FILE=/dev/null علشان أي .env عند المطوّر ميتسربش."""

    def _run(self, env_extra):
        import os

        env = {k: v for k, v in os.environ.items() if not k.startswith("WP_")}
        env["WP_ENV_FILE"] = "/dev/null"
        env.update(env_extra)
        return subprocess.run(
            [sys.executable, "wp_publish.py", "doctor"],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(ROOT),
            timeout=60,
        )

    def test_all_missing_names_every_variable(self):
        result = self._run({})
        self.assertEqual(result.returncode, 1)
        for name in ("WP_SITE_URL", "WP_USERNAME", "WP_APP_PASSWORD"):
            self.assertIn(name, result.stdout + result.stderr)

    def test_partial_config_names_only_the_missing(self):
        result = self._run({"WP_SITE_URL": "https://x.test", "WP_USERNAME": "u"})
        self.assertEqual(result.returncode, 1)
        output = result.stdout + result.stderr
        self.assertIn("WP_APP_PASSWORD", output)
        self.assertNotIn("WP_USERNAME", output)


class TestUnreachableSite(unittest.TestCase):
    def test_dns_failure_is_clean(self):
        """هوست مش موجود: رسالة مفهومة، مش traceback. بنقلّل المحاولات للسرعة."""
        import os

        env = {k: v for k, v in os.environ.items() if not k.startswith("WP_")}
        env.update(
            {
                "WP_ENV_FILE": "/dev/null",
                "WP_SITE_URL": "https://nonexistent-host.invalid",
                "WP_USERNAME": "u",
                "WP_APP_PASSWORD": "p",
                "WP_MAX_RETRIES": "1",  # التراجع الأسّي مختبَر في مكان تاني
                "WP_TIMEOUT": "5",
            }
        )
        result = subprocess.run(
            [sys.executable, "wp_publish.py", "doctor"],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(ROOT),
            timeout=90,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Traceback", result.stderr)
        self.assertIn("فشل الاتصال", result.stdout + result.stderr)


class TestBadArticleFiles(PublisherTestCase):
    def test_missing_title_fails_that_file_only(self):
        """ملف واحد بايظ مبيوقّفش الدفعة — الباقي ينشر."""
        self.article("bad.md", "slug: no-title", "نص بدون عنوان.")
        self.article("good.md", "title: سليم\nslug: good")
        result = self.run_cli("publish", "--all")
        self.assertIsNotNone(self.wp.post_by_slug("good"), result.output)
        self.assertIn("1 نجح، 1 فشل", result.stdout)
        self.assertEqual(result.returncode, 1)
        self.assertNoTraceback(result)

    def test_malformed_yaml_is_a_clean_per_file_error(self):
        (self.content / "bad.md").write_text("---\ntitle: [مش, مقفول\n---\n\nنص\n", encoding="utf-8")
        self.article("good.md", "title: سليم\nslug: good2")
        result = self.run_cli("publish", "--all")
        self.assertIsNotNone(self.wp.post_by_slug("good2"))
        self.assertNoTraceback(result)
        self.assertIn("front matter", result.output)

    def test_unslugifiable_title_refuses_to_guess(self):
        """عنوان مفيهوش حروف = مفيش slug. أحسن من نشر على slug مشترك يمسح مقال تاني."""
        self.article("a.md", "title: '!!! ??? ...'")
        result = self.run_cli("publish", "--all")
        self.assertFailsCleanly(result, contains="slug")
        self.assertEqual(len(self.wp.posts), 0)

    def test_nonexistent_file_path(self):
        result = self.run_cli("publish", str(self.content / "ghost.md"))
        self.assertFailsCleanly(result)

    def test_stray_dashes_in_body_do_not_break_parsing(self):
        """فاصل '---' جوه النص مش المفروض يلخبط قراءة الـ front matter."""
        self.article("a.md", "title: فواصل\nslug: dashes", "مقدمة\n\n---\n\nقسم بعد الفاصل.")
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        post = self.wp.post_by_slug("dashes")
        self.assertIn("wp:separator", post["content"]["raw"])

    def test_invalid_author_is_a_clear_error(self):
        self.article("a.md", "title: كاتب\nslug: auth\nauthor: مش رقم")
        result = self.run_cli("publish", "--all")
        self.assertFailsCleanly(result, contains="author")


class TestSeoMetaRejected(PublisherTestCase):
    scenario = "no_meta"

    def test_post_still_publishes_with_warning(self):
        """بلجن السيو رافض الحقول — المقال لازم ينزل والتحذير يظهر."""
        self.article("a.md", "title: سيو\nslug: seo\nseo_title: عنوان\nseo_description: وصف")
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertIsNotNone(self.wp.post_by_slug("seo"))
        self.assertIn("تنبيه", result.stderr)


if __name__ == "__main__":
    unittest.main()
