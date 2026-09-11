"""الصور والتصنيفات والجدولة وحقول السيو."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import JPEG_BYTES, PNG_BYTES, PublisherTestCase  # noqa: E402


class TestFeaturedImage(PublisherTestCase):
    def test_local_image_uploaded_and_linked(self):
        """البايتات اللي وصلت للموقع هي نفس بايتات الملف، والمقال مربوط بيها."""
        self.image("hero.png", PNG_BYTES)
        self.article("a.md", "title: صورة\nslug: img\nfeatured_image: hero.png")
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.media), 1)
        media = self.wp.media[0]
        self.assertEqual(media["byte_size"], len(PNG_BYTES))
        self.assertEqual(media["mime_type"], "image/png")
        self.assertEqual(self.wp.post_by_slug("img")["featured_media"], media["id"])

    def test_upload_headers_are_correct(self):
        """ووردبريس بيقرا اسم الملف من Content-Disposition — لازم يبقى موجود وASCII."""
        self.image("hero.png")
        self.article("a.md", "title: صورة\nslug: img\nfeatured_image: hero.png")
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        uploads = [
            r for r in self.wp.requests if r["method"] == "POST" and r["path"].endswith("/media")
        ]
        self.assertEqual(len(uploads), 1)
        disposition = uploads[0]["disposition"] or ""
        self.assertIn("filename=", disposition)
        self.assertTrue(disposition.isascii(), disposition)
        self.assertTrue((uploads[0]["content_type"] or "").startswith("image/"))

    def test_jpeg_detected_from_bytes(self):
        self.image("photo.jpg", JPEG_BYTES)
        self.article("a.md", "title: صورة\nslug: jpg\nfeatured_image: photo.jpg")
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(self.wp.media[0]["mime_type"], "image/jpeg")

    def test_alt_text_applied(self):
        self.image("hero.png")
        self.article(
            "a.md", "title: صورة\nslug: img\nfeatured_image: hero.png\nfeatured_alt: وصف الصورة"
        )
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(self.wp.media[0]["alt_text"], "وصف الصورة")

    def test_arabic_filename_does_not_break_the_run(self):
        """اسم ملف عربي كان بيكسر ترويسة HTTP ويوقّف النشر كله."""
        self.image("صورة-المقال.png")
        self.article("a.md", "title: صورة عربية\nslug: ar-img\nfeatured_image: صورة-المقال.png")
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.media), 1)
        name = self.wp.media[0]["source_url"].rsplit("/", 1)[-1]
        self.assertTrue(name.isascii(), name)

    def test_image_not_reuploaded_on_second_run(self):
        """الرفع مرة واحدة — مكتبة الوسائط مش المفروض تتلوّث بنسخ مكررة."""
        self.image("hero.png")
        self.article("a.md", "title: صورة\nslug: img\nfeatured_image: hero.png")
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(len(self.wp.media), 1, f"{len(self.wp.media)} نسخة من نفس الصورة")

    def test_alt_applied_even_when_image_reused(self):
        """النص البديل بيتطبّق كمان لو الصورة كانت مرفوعة قبل كده."""
        self.image("hero.png")
        self.article("a.md", "title: صورة\nslug: img\nfeatured_image: hero.png")
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.article(
            "a.md", "title: صورة\nslug: img\nfeatured_image: hero.png\nfeatured_alt: وصف جديد"
        )
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(self.wp.media[0]["alt_text"], "وصف جديد")

    def test_missing_image_names_the_file(self):
        self.article("a.md", "title: ناقصة\nslug: miss\nfeatured_image: ghost.png")
        result = self.run_cli("publish", "--all")
        self.assertFailsCleanly(result, contains="ghost.png")


class TestTerms(PublisherTestCase):
    def test_terms_created_and_attached(self):
        self.article("a.md", "title: مقال\nslug: t1\ncategories: [أخبار]\ntags: [وسم, تاني]")
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual({t["name"] for t in self.wp.terms("categories")}, {"أخبار"})
        self.assertEqual({t["name"] for t in self.wp.terms("tags")}, {"وسم", "تاني"})
        post = self.wp.post_by_slug("t1")
        self.assertEqual(len(post["categories"]), 1)
        self.assertEqual(len(post["tags"]), 2)

    def test_existing_term_reused_not_duplicated(self):
        self.article("a.md", "title: واحد\nslug: t1\ncategories: [أخبار]")
        self.article("b.md", "title: اتنين\nslug: t2\ncategories: [أخبار]")
        self.run_cli("publish", "--all")
        self.assertEqual(len(self.wp.terms("categories")), 1)
        self.assertEqual(
            self.wp.post_by_slug("t1")["categories"], self.wp.post_by_slug("t2")["categories"]
        )

    def test_term_exists_race_recovers_the_id(self):
        """لو التصنيف اتعمل في نفس اللحظة من مكان تاني، ووردبريس بيرجّع الـ id في الخطأ."""
        import json
        import urllib.request

        # نعمل التصنيف بالاسم بس بـ slug مختلف، فالبحث مبيلاقيهوش والإنشاء بيرجّع term_exists
        request = urllib.request.Request(
            f"{self.wp.url}/wp-json/wp/v2/categories",
            data=json.dumps({"name": "أخبار"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        import base64

        token = base64.b64encode(f"{self.wp.user}:{self.wp.password}".encode()).decode()
        request.add_header("Authorization", f"Basic {token}")
        with urllib.request.urlopen(request, timeout=10) as response:
            existing = json.load(response)
        self.wp.state.terms["categories"][existing["id"]]["slug"] = "different-slug"

        self.article("a.md", "title: مقال\nslug: race\ncategories: [أخبار]")
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.terms("categories")), 1)
        self.assertEqual(self.wp.post_by_slug("race")["categories"], [existing["id"]])

    def test_comma_separated_string_form(self):
        self.article("a.md", "title: مقال\nslug: t3\ntags: أول, تاني, تالت")
        self.run_cli("publish", "--all")
        self.assertEqual(len(self.wp.terms("tags")), 3)

    def test_yaml_list_form(self):
        self.article("a.md", "title: مقال\nslug: t4\ntags:\n  - أول\n  - تاني")
        self.run_cli("publish", "--all")
        self.assertEqual(len(self.wp.terms("tags")), 2)


class TestScheduling(PublisherTestCase):
    def test_future_date_with_publish_becomes_scheduled(self):
        """تاريخ مستقبلي + status publish = نشر مجدول (future) مش نشر فوري."""
        self.article("a.md", "title: مجدول\nslug: sched\nstatus: publish\ndate: 2035-06-01T09:00:00")
        self.run_cli("publish", "--all")
        self.assertEqual(self.wp.post_by_slug("sched")["status"], "future")

    def test_date_only_is_normalized_with_time(self):
        """ووردبريس بيرفض تاريخ بدون وقت — الأداة بتكمّله."""
        self.article("a.md", "title: تاريخ\nslug: dateonly\nstatus: publish\ndate: 2035-06-01")
        self.run_cli("publish", "--all")
        post = self.wp.post_by_slug("dateonly")
        self.assertIn("T00:00:00", post["date"])
        self.assertEqual(post["status"], "future")

    def test_past_date_publishes_immediately(self):
        self.article("a.md", "title: ماضي\nslug: past\nstatus: publish\ndate: 2020-01-01T10:00:00")
        self.run_cli("publish", "--all")
        self.assertEqual(self.wp.post_by_slug("past")["status"], "publish")


class TestSeoMeta(PublisherTestCase):
    def test_all_plugin_key_sets_sent(self):
        """بنبعت مفاتيح Yoast وRankMath وAIOSEO — أي واحد مركّب هو اللي بيستلم."""
        self.article(
            "a.md",
            "title: سيو\nslug: seo\nseo_title: عنوان السيو\nseo_description: وصف السيو",
        )
        result = self.run_cli("publish", "--all", "-v")
        self.assertEqual(result.returncode, 0, result.output)
        meta = self.wp.post_by_slug("seo")["meta"]
        self.assertEqual(meta.get("_yoast_wpseo_title"), "عنوان السيو")
        self.assertEqual(meta.get("rank_math_description"), "وصف السيو")
        self.assertEqual(meta.get("_aioseo_title"), "عنوان السيو")

    def test_verifies_which_plugin_accepted(self):
        self.article("a.md", "title: سيو\nslug: seo\nseo_title: عنوان")
        result = self.run_cli("publish", "--all", "-v")
        self.assertIn("ثبتت في", result.stdout)

    def test_no_meta_request_when_no_seo_fields(self):
        """مفيش نداء زيادة لو المستخدم مكتبش حقول سيو."""
        self.article("a.md", "title: بدون سيو\nslug: noseo")
        self.run_cli("publish", "--all")
        updates = [
            r
            for r in self.wp.requests
            if r["method"] == "POST" and "/posts/" in r["path"]
        ]
        self.assertEqual(len(updates), 0, updates)


class TestArabicContent(PublisherTestCase):
    def test_arabic_title_and_slug_round_trip(self):
        """ووردبريس بيخزّن الـ slug العربي مشفّر — المقارنة لازم تفك التشفير."""
        from urllib.parse import unquote

        self.article("a.md", "title: عنوان عربي بالكامل", "نص عربي في المقال.")
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        post = self.wp.posts[0]
        self.assertEqual(post["title"]["raw"], "عنوان عربي بالكامل")
        self.assertIn("عنوان", unquote(post["slug"]))

    def test_arabic_slug_lookup_is_idempotent(self):
        """الـ slug العربي في الاستعلام لازم يتشفّر صح، وإلا كل تشغيل يعمل مقال جديد."""
        self.article("a.md", "title: مقال عربي", "نص.")
        self.run_cli("publish", "--all")
        self.run_cli("publish", "--all")
        self.assertEqual(len(self.wp.posts), 1, [p["slug"] for p in self.wp.posts])

    def test_arabic_body_gets_rtl_alignment(self):
        """المقال العربي بياخد محاذاة يمين بالـ attribute المعتمد في ووردبريس."""
        self.article("a.md", "title: عربي\nslug: ar", "ده نص عربي طويل كفاية علشان يتعرّف.")
        self.run_cli("publish", "--all")
        content = self.wp.post_by_slug("ar")["content"]["raw"]
        self.assertIn("has-text-align-right", content)
        self.assertNotIn('dir="', content, "dir الخام بيكسر تحقّق البلوكات في المحرر")

    def test_english_body_has_no_alignment(self):
        self.article("a.md", "title: English\nslug: en", "This is a fully English article body.")
        self.run_cli("publish", "--all")
        self.assertNotIn("has-text-align", self.wp.post_by_slug("en")["content"]["raw"])

    def test_explicit_dir_overrides_detection(self):
        self.article("a.md", "title: English\nslug: en2\ndir: rtl", "English body text here.")
        self.run_cli("publish", "--all")
        self.assertIn("has-text-align-right", self.wp.post_by_slug("en2")["content"]["raw"])


if __name__ == "__main__":
    unittest.main()
