"""النشر والتحديث ومنع التكرار — سلوك الأداة الأساسي."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import PublisherTestCase  # noqa: E402


class TestCreateAndUpdate(PublisherTestCase):
    def test_creates_post_with_all_fields(self):
        """المقال بينزل بكل حقوله زي ما هي في الملف."""
        self.article(
            "a.md",
            "title: عنوان المقال\nslug: my-post\nstatus: draft\nexcerpt: ملخص مكتوب",
            "## قسم\n\nنص الفقرة.",
        )
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        post = self.wp.post_by_slug("my-post")
        self.assertIsNotNone(post, result.output)
        self.assertEqual(post["title"]["raw"], "عنوان المقال")
        self.assertEqual(post["status"], "draft")
        self.assertEqual(post["excerpt"]["raw"], "ملخص مكتوب")
        self.assertIn("wp:heading", post["content"]["raw"])

    def test_default_status_is_draft(self):
        """الافتراضي draft — علشان محدش ينشر على موقع حقيقي بالغلط."""
        self.article("a.md", "title: بدون حالة\nslug: no-status")
        self.run_cli("publish", "--all")
        self.assertEqual(self.wp.post_by_slug("no-status")["status"], "draft")

    def test_excerpt_generated_when_missing(self):
        """الملخص بيتولّد من أول فقرة لو المستخدم مكتبهوش."""
        self.article("a.md", "title: بدون ملخص\nslug: no-excerpt", "دي أول فقرة في المقال.")
        self.run_cli("publish", "--all")
        self.assertIn("أول فقرة", self.wp.post_by_slug("no-excerpt")["excerpt"]["raw"])

    def test_title_from_heading_when_no_front_matter(self):
        """ملف بدون front matter بياخد عنوانه من '# ' والعنوان بيتشال من النص."""
        self.article("a.md", "", "# عنوان من الهيدينج\n\nنص المقال.")
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        post = self.wp.posts[0]
        self.assertEqual(post["title"]["raw"], "عنوان من الهيدينج")
        self.assertNotIn("عنوان من الهيدينج", post["content"]["raw"])

    def test_second_run_updates_instead_of_duplicating(self):
        """تشغيل الأداة مرتين بيحدّث نفس المقال — مش بيعمل نسخة تانية."""
        self.article("a.md", "title: مقال\nslug: same-slug")
        self.run_cli("publish", "--all")
        first_id = self.wp.posts[0]["id"]
        self.article("a.md", "title: مقال معدّل\nslug: same-slug", "نص جديد بعد التعديل.")
        result = self.run_cli("publish", "--all")
        self.assertEqual(len(self.wp.posts), 1, [p["slug"] for p in self.wp.posts])
        self.assertEqual(self.wp.posts[0]["id"], first_id)
        self.assertEqual(self.wp.posts[0]["title"]["raw"], "مقال معدّل")
        self.assertIn("تحديث", result.stdout)

    def test_update_keeps_published_status(self):
        """إعادة التشغيل مبترجّعش المقالات المنشورة لـ draft — بق حرج كان في CI."""
        self.article("a.md", "title: منشور\nslug: live")
        self.run_cli("publish", "--all", "--status", "publish")
        self.assertEqual(self.wp.post_by_slug("live")["status"], "publish")
        self.run_cli("publish", "--all")
        self.assertEqual(
            self.wp.post_by_slug("live")["status"], "publish", "التحديث رجّع المقال لـ draft"
        )

    def test_explicit_status_override_applies_to_existing(self):
        """--status صريح بيتطبّق على المقال الموجود كمان."""
        self.article("a.md", "title: منشور\nslug: live")
        self.run_cli("publish", "--all", "--status", "publish")
        self.run_cli("publish", "--all", "--status", "draft")
        self.assertEqual(self.wp.post_by_slug("live")["status"], "draft")

    def test_recorded_id_wins_when_site_changes_slug(self):
        """لو ووردبريس غيّر الـ slug، الأداة بتحدّث نفس المقال بالـ id المسجّل."""
        self.article("a.md", "title: مقال\nslug: wanted")
        self.run_cli("publish", "--all")
        post_id = self.wp.posts[0]["id"]
        self.wp.state.posts[post_id]["slug"] = "wanted-2"
        result = self.run_cli("publish", "--all")
        self.assertEqual(len(self.wp.posts), 1, [(p["id"], p["slug"]) for p in self.wp.posts])
        self.assertIn("slug مختلف", result.stdout)

    def test_state_file_records_post(self):
        """سجل النشر بيحفظ رقم المقال ورابطه للمراجعة."""
        import json

        self.article("a.md", "title: مقال\nslug: recorded")
        self.run_cli("publish", "--all")
        state = json.loads((self.content / ".published.json").read_text(encoding="utf-8"))
        self.assertIn("a.md", state)
        self.assertEqual(state["a.md"]["slug"], "recorded")
        self.assertTrue(state["a.md"]["link"])


class TestBlankFrontMatter(PublisherTestCase):
    """مفاتيح موجودة بقيمة فاضية — كانت بتسبب فقدان بيانات صامت."""

    def test_blank_slug_does_not_collapse_articles(self):
        """مقالين بـ `slug:` فاضي لازم يبقوا مقالين، مش واحد يمسح التاني."""
        self.article("a.md", "title: المقال الأول\nslug:\nstatus:")
        self.article("b.md", "title: المقال التاني\nslug:\nstatus:")
        result = self.run_cli("publish", "--all")
        self.assertEqual(len(self.wp.posts), 2, result.output)
        slugs = {p["slug"] for p in self.wp.posts}
        self.assertNotIn("None", slugs)
        self.assertEqual(len(slugs), 2, slugs)

    def test_blank_status_is_not_literal_none(self):
        """`status:` فاضي بياخد الافتراضي، مش النص 'None'."""
        self.article("a.md", "title: مقال\nslug: blank-status\nstatus:")
        self.run_cli("publish", "--all")
        self.assertEqual(self.wp.post_by_slug("blank-status")["status"], "draft")

    def test_template_blank_keys_all_safe(self):
        """كل المفاتيح الفاضية في القالب لازم تعدّي بدون ما تلوّث الطلب."""
        self.article(
            "a.md",
            "title: قالب\nslug: template-test\nexcerpt:\nseo_title:\nseo_description:\n"
            "featured_image:\nfeatured_alt:\ndate:\ndir:\nauthor:\ncomment_status:",
        )
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        post = self.wp.post_by_slug("template-test")
        self.assertIsNotNone(post)
        self.assertNotIn("None", str(post["date"]))
        self.assertEqual(post["comment_status"], "open")


class TestDocumentedContract(PublisherTestCase):
    """
    كل حقل موثّق في README و_template.md لازم يكون مطبّق فعلًا.
    التوثيق اللي بيوعد بحاجة الكود مبيعملهاش هو بق، مش مجرد كلام.
    """

    ALL_FIELDS = (
        "title: كل الحقول\n"
        "slug: every-field\n"
        "status: pending\n"
        "categories: [تصنيف]\n"
        "tags: [وسم]\n"
        "excerpt: ملخص مخصص\n"
        "seo_title: عنوان سيو\n"
        "seo_description: وصف سيو\n"
        "featured_image: hero.png\n"
        "featured_alt: وصف الصورة\n"
        "date: 2035-05-05T08:00:00\n"
        "author: 7\n"
        "comment_status: closed\n"
        "dir: rtl"
    )

    def test_every_documented_field_is_honoured(self):
        self.image("hero.png")
        self.article("all.md", self.ALL_FIELDS)
        result = self.run_cli("publish", "--all", "-v", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(result.returncode, 0, result.output)

        post = self.wp.post_by_slug("every-field")
        self.assertIsNotNone(post, result.output)
        self.assertEqual(post["title"]["raw"], "كل الحقول")
        self.assertEqual(post["status"], "pending")
        self.assertEqual(post["excerpt"]["raw"], "ملخص مخصص")
        self.assertEqual(post["comment_status"], "closed")
        self.assertEqual(post["author"], 7)
        self.assertEqual(len(post["categories"]), 1)
        self.assertEqual(len(post["tags"]), 1)
        self.assertIn("2035-05-05T08:00:00", post["date"])
        self.assertEqual(post["featured_media"], self.wp.media[0]["id"])
        self.assertEqual(self.wp.media[0]["alt_text"], "وصف الصورة")
        self.assertEqual(post["meta"].get("_yoast_wpseo_title"), "عنوان سيو")
        self.assertIn("has-text-align-right", post["content"]["raw"])

    def test_seo_update_does_not_wipe_other_fields(self):
        """نداء السيو نداء تاني — ممنوع يمسح الملخص أو حالة التعليقات."""
        self.article(
            "a.md",
            "title: مقال\nslug: keep\nexcerpt: ملخص مهم\ncomment_status: closed\n"
            "seo_title: عنوان سيو",
        )
        self.run_cli("publish", "--all")
        post = self.wp.post_by_slug("keep")
        self.assertEqual(post["excerpt"]["raw"], "ملخص مهم")
        self.assertEqual(post["comment_status"], "closed")

    def test_documented_commands_all_exit_zero(self):
        """كل أمر مكتوب في README لازم يشتغل زي ما هو مكتوب."""
        self.article("a.md", "title: مقال\nslug: cmds")
        for args in (
            ("doctor",),
            ("list", "--limit", "5"),
            ("publish", "--all", "--dry-run"),
            ("publish", "--all"),
            ("publish", "--all", "--status", "publish"),
        ):
            with self.subTest(command=" ".join(args)):
                result = self.run_cli(*args)
                self.assertEqual(result.returncode, 0, result.output)


class TestFileSelection(PublisherTestCase):
    def test_underscore_files_skipped_by_all(self):
        """ملفات القوالب (_template.md) مش بتتنشر مع --all."""
        self.article("_template.md", "title: قالب\nslug: tpl")
        self.article("real.md", "title: حقيقي\nslug: real")
        self.run_cli("publish", "--all")
        self.assertEqual(len(self.wp.posts), 1)
        self.assertEqual(self.wp.posts[0]["slug"], "real")

    def test_explicit_path_publishes_underscore_file(self):
        """بس لو حدّدت الملف بالاسم، بينشر عادي."""
        path = self.article("_draft.md", "title: مسودة\nslug: draft-one")
        self.run_cli("publish", str(path))
        self.assertIsNotNone(self.wp.post_by_slug("draft-one"))

    def test_no_files_selected_exits_one(self):
        """أمر بدون ملفات ولا --all بيقول للمستخدم يعمل إيه."""
        result = self.run_cli("publish")
        self.assertEqual(result.returncode, 1)
        self.assertIn("--all", result.stdout)

    def test_empty_content_dir_exits_one(self):
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 1)
        self.assertIn("مفيش ملفات", result.stdout)


class TestDryRun(PublisherTestCase):
    def test_dry_run_writes_nothing(self):
        """المعاينة مش بتكتب أي حاجة على الموقع — ولا نداء POST واحد."""
        self.article("a.md", "title: معاينة\nslug: preview")
        result = self.run_cli("publish", "--all", "--dry-run")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.posts), 0)
        self.assertFalse([r for r in self.wp.requests if r["method"] == "POST"])

    def test_dry_run_distinguishes_create_from_update(self):
        """المعاينة بتقول هل هيعمل مقال جديد ولا هيكتب فوق مقال موجود."""
        self.article("a.md", "title: معاينة\nslug: preview")
        self.assertIn("سيتم الإنشاء", self.run_cli("publish", "--all", "--dry-run").stdout)
        self.run_cli("publish", "--all")
        result = self.run_cli("publish", "--all", "--dry-run")
        self.assertIn("سيتم التحديث #", result.stdout)


class TestListAndDoctor(PublisherTestCase):
    def test_list_shows_post(self):
        self.article("a.md", "title: مقال للعرض\nslug: listed")
        self.run_cli("publish", "--all")
        result = self.run_cli("list")
        self.assertEqual(result.returncode, 0)
        self.assertIn("مقال للعرض", result.stdout)
        self.assertIn("listed", result.stdout)

    def test_doctor_passes_on_healthy_site(self):
        result = self.run_cli("doctor")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertIn("جاهزة ✓", result.stdout)
        for cap in ("publish_posts", "edit_posts", "upload_files", "manage_categories"):
            self.assertIn(cap, result.stdout)

    def test_list_on_empty_site_exits_zero(self):
        """موقع فاضي مش حالة خطأ."""
        result = self.run_cli("list")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertIn("مفيش مقالات", result.stdout)

    def test_invalid_status_rejected_by_argv(self):
        """قيمة حالة غلط بتترفض من argparse قبل أي نداء على الموقع."""
        self.article("a.md", "title: مقال\nslug: p")
        result = self.run_cli("publish", "--all", "--status", "published")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.wp.posts), 0)
        self.assertIn("invalid choice", result.stderr.lower())

    def test_doctor_never_echoes_password(self):
        """ممنوع يطبع أي حرف من السر ولا حتى طوله."""
        import re as _re

        result = self.run_cli("doctor")
        self.assertNotIn(self.wp.password, result.output)
        self.assertNotIn(self.wp.password[-4:], result.output)
        # سطر الباسورد لوحده لازم يبقى مقنّع وبدون أرقام (الطول تلميح كمان).
        # بنفحص السطر ده بس — المخرجات كلها فيها رقم البورت العشوائي.
        line = next(l for l in result.stdout.splitlines() if l.startswith("الباسورد"))
        self.assertIn("مضبوط", line)
        self.assertIsNone(_re.search(r"\d", line), line)


if __name__ == "__main__":
    unittest.main()
