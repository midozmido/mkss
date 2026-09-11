"""
هوية المقال: أي ملف بيملك أي مقال، والسجل، والقفل.
كل اختبار هنا بيحمي من فقدان بيانات حقيقي على موقع منشور.
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import PublisherTestCase  # noqa: E402


class TestStateKeying(PublisherTestCase):
    def test_same_filename_in_two_folders_are_two_posts(self):
        """السجل بالاسم المجرّد كان بيخلّي a/index.md و b/index.md مقال واحد."""
        for name in ("a", "b"):
            folder = self.content / name
            folder.mkdir()
            (folder / "index.md").write_text(
                f"---\ntitle: مقال {name}\nslug: post-{name}\n---\n\nنص {name}.\n",
                encoding="utf-8",
            )
        result = self.run_cli(
            "publish", str(self.content / "a/index.md"), str(self.content / "b/index.md")
        )
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.posts), 2, [p["slug"] for p in self.wp.posts])
        state = json.loads((self.content / ".published.json").read_text(encoding="utf-8"))
        self.assertEqual(len(state), 2, list(state))

    def test_state_from_another_site_is_ignored(self):
        """أرقام مقالات موقع تاني ممنوع تتطبّق على الموقع الحالي."""
        self.article("a.md", "title: مقال\nslug: sitecheck")
        (self.content / ".published.json").write_text(
            json.dumps({"a.md": {"site": "https://other-site.example", "id": 9999}}),
            encoding="utf-8",
        )
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.posts), 1)

    def test_corrupt_state_never_blocks_publishing(self):
        """سجل تالف تحسين ضايع، مش سبب إن النشر يتوقف للأبد."""
        self.article("a.md", "title: مقال\nslug: corrupt")
        for corrupt in (
            '{"a.md": "مش قاموس"}',
            "[]",
            "مش JSON خالص",
            '{"a.md": {"id": "مش رقم"}}',
            '{"a.md": {"id": null}}',
            '{"a.md": {}}',
            '{"a.md": {"id": [1, 2]}}',
            "null",
        ):
            with self.subTest(state=corrupt[:24]):
                (self.content / ".published.json").write_text(corrupt, encoding="utf-8")
                result = self.run_cli("publish", "--all")
                self.assertEqual(result.returncode, 0, result.output)

    def test_state_records_site_and_requested_slug(self):
        self.article("a.md", "title: مقال\nslug: recorded")
        self.run_cli("publish", "--all")
        entry = json.loads((self.content / ".published.json").read_text(encoding="utf-8"))["a.md"]
        self.assertEqual(entry["site"], self.wp.url)
        self.assertEqual(entry["requested_slug"], "recorded")
        self.assertIsInstance(entry["id"], int)


class TestSlugCollision(PublisherTestCase):
    def test_second_file_with_same_slug_is_refused(self):
        """الكتابة فوق مقال ملف تاني بتمسح محتوى منشور — لازم توقف، مش تنبيه."""
        self.article("one.md", "title: الأول\nslug: shared", "محتوى المقال الأول المهم.")
        self.run_cli("publish", "--all")
        original = self.wp.post_by_slug("shared")["content"]["raw"]

        self.article("two.md", "title: التاني\nslug: shared", "محتوى المقال التاني.")
        result = self.run_cli("publish", str(self.content / "two.md"))
        self.assertFailsCleanly(result, contains="slug")
        self.assertEqual(
            self.wp.post_by_slug("shared")["content"]["raw"], original, "المحتوى الأصلي اتمسح"
        )

    def test_user_slug_is_normalised(self):
        """slug فيه مسافات وحروف كبيرة كان بيرجع من ووردبريس مختلف فالمقال يتكرّر."""
        self.article("a.md", "title: مقال\nslug: My Slug WITH Spaces")
        self.run_cli("publish", "--all")
        self.assertIsNotNone(self.wp.post_by_slug("my-slug-with-spaces"), self.wp.posts)
        self.run_cli("publish", "--all")
        self.assertEqual(len(self.wp.posts), 1)


class TestPermalinkRespect(PublisherTestCase):
    def test_admin_permalink_edit_is_not_reverted(self):
        """لو المستخدم عدّل الرابط الدائم من لوحة التحكم، مش المفروض يترجع كل تشغيل."""
        self.article("a.md", "title: مقال\nslug: original")
        self.run_cli("publish", "--all")
        post_id = self.wp.posts[0]["id"]
        self.wp.state.posts[post_id]["slug"] = "edited-in-admin"

        self.run_cli("publish", "--all")
        self.assertEqual(self.wp.state.posts[post_id]["slug"], "edited-in-admin")

    def test_changing_slug_in_the_file_does_apply(self):
        """بس لو المستخدم غيّر الـ slug في الملف، ده قصد صريح ولازم يتطبّق."""
        self.article("a.md", "title: مقال\nslug: original")
        self.run_cli("publish", "--all")
        post_id = self.wp.posts[0]["id"]
        self.article("a.md", "title: مقال\nslug: new-intent")
        self.run_cli("publish", "--all")
        self.assertEqual(self.wp.state.posts[post_id]["slug"], "new-intent")
        self.assertEqual(len(self.wp.posts), 1)


class TestConcurrencyLock(PublisherTestCase):
    def test_running_lock_blocks_a_second_run(self):
        """تشغيلين في نفس الوقت كانوا بيعملوا نسخة مكررة من كل مقال."""
        self.article("a.md", "title: مقال\nslug: locked")
        lock = self.content / ".published.json.lock"
        lock.write_text("99999 now\n", encoding="utf-8")
        result = self.run_cli("publish", "--all")
        self.assertFailsCleanly(result)
        self.assertEqual(len(self.wp.posts), 0)

    def test_lock_is_released_after_a_successful_run(self):
        self.article("a.md", "title: مقال\nslug: locked")
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertFalse((self.content / ".published.json.lock").exists())

    def test_dry_run_needs_no_lock(self):
        """المعاينة قراءة فقط — مينفعش قفل عالق يمنعها."""
        self.article("a.md", "title: مقال\nslug: locked")
        (self.content / ".published.json.lock").write_text("99999 now\n", encoding="utf-8")
        result = self.run_cli("publish", "--all", "--dry-run")
        self.assertEqual(result.returncode, 0, result.output)


class TestArticleParsing(PublisherTestCase):
    def test_empty_body_is_refused(self):
        """المقال الفاضي كان بيمسح محتوى المقال المنشور ويرجّع نجاح."""
        self.article("a.md", "title: فاضي\nslug: empty", "")
        result = self.run_cli("publish", "--all")
        self.assertFailsCleanly(result)
        self.assertEqual(len(self.wp.posts), 0)

    def test_empty_body_does_not_wipe_existing_post(self):
        self.article("a.md", "title: مقال\nslug: keepme", "محتوى مهم.")
        self.run_cli("publish", "--all")
        self.article("a.md", "title: مقال\nslug: keepme", "")
        self.run_cli("publish", "--all")
        self.assertIn("محتوى مهم", self.wp.post_by_slug("keepme")["content"]["raw"])

    def test_dashes_inside_a_front_matter_value(self):
        """'---' جوه قيمة كان بيقطع الـ front matter نصّه."""
        self.article("a.md", 'title: "عنوان --- فيه فواصل"\nslug: dashy', "نص المقال.")
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        post = self.wp.post_by_slug("dashy")
        self.assertEqual(post["title"]["raw"], "عنوان --- فيه فواصل")

    def test_title_is_not_taken_from_inside_a_code_fence(self):
        """سطر '# ' جوه كود مش عنوان المقال."""
        self.article("a.md", "", "```bash\n# ده تعليق في كود\necho x\n```\n\n# العنوان الحقيقي\n\nنص.")
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        post = self.wp.posts[0]
        self.assertEqual(post["title"]["raw"], "العنوان الحقيقي")
        self.assertIn("ده تعليق في كود", post["content"]["raw"])

    def test_credentials_in_site_url_are_refused(self):
        """user:pass@ في العنوان بيظهر في كل رسالة خطأ — مرفوض."""
        host = self.wp.url.split("://", 1)[1]
        result = self.run_cli("doctor", WP_SITE_URL=f"http://user:secret@{host}")
        self.assertFailsCleanly(result)
        self.assertNotIn("secret", result.output)


class TestMediaIdentity(PublisherTestCase):
    def test_two_different_images_with_the_same_filename(self):
        """الاعتماد على الاسم كان بيخلّي المقال التاني ياخد صورة المقال الأول."""
        for name, fill in (("a", b"A"), ("b", b"B")):
            folder = self.content / name
            folder.mkdir()
            (folder / "hero.png").write_bytes(b"\x89PNG\r\n\x1a\n" + fill * 200)
            (folder / "post.md").write_text(
                f"---\ntitle: مقال {name}\nslug: art-{name}\nfeatured_image: hero.png\n---\n\nنص.\n",
                encoding="utf-8",
            )
        result = self.run_cli(
            "publish",
            str(self.content / "a/post.md"),
            str(self.content / "b/post.md"),
            WP_ALLOW_LOCAL_FETCH="1",
        )
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.media), 2, "صورتين مختلفتين اتعاملوا كواحدة")
        featured = [p["featured_media"] for p in self.wp.posts]
        self.assertEqual(len(set(featured)), 2, featured)

    def test_same_image_still_deduped(self):
        """نفس الصورة بالظبط لازم تترفع مرة واحدة."""
        self.image("hero.png")
        self.article("a.md", "title: أ\nslug: a\nfeatured_image: hero.png")
        self.article("b.md", "title: ب\nslug: b\nfeatured_image: hero.png")
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(len(self.wp.media), 1)

    def test_extension_comes_from_detected_type_not_user_input(self):
        """الامتداد من بايتات الصورة، مش من اسم الملف."""
        (self.content / "photo.jpeg").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 120)
        self.article("a.md", "title: صورة\nslug: ext\nfeatured_image: photo.jpeg")
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertTrue(self.wp.media[0]["source_url"].endswith(".png"), self.wp.media[0])

    def test_nul_byte_in_path_is_a_clean_error(self):
        self.article("a.md", 'title: صورة\nslug: nul\nfeatured_image: "he\\0ro.png"')
        result = self.run_cli("publish", "--all")
        self.assertNoTraceback(result)


if __name__ == "__main__":
    unittest.main()
