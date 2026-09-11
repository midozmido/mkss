"""
اختبارات بتسدّ فجوات كشفها اختبار الطفرات (mutation testing).

كل اختبار هنا موجود لأن تعطيل الحماية اللي بيحميها كان بيعدّي من السويت كلها.
الاختبار اللي بينجح على أداة معطّلة مش اختبار.
"""
import http.server
import json
import re
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import PNG_BYTES, ROOT, PublisherTestCase  # noqa: E402


class TestWriteIsNeverRetried(PublisherTestCase):
    """
    السيناريو العادي `flaky` بيوقع القراءات بس، فمطابقة "الكتابة مبتتكرّرش"
    مكانت مرئية. هنا السيرفر بيخزّن المقال وبعدين يوقع.
    """

    scenario = "flaky_write"

    def test_exactly_one_create_request_and_one_post(self):
        self.article("a.md", "title: مقال\nslug: flaky-write")
        result = self.run_cli("publish", "--all")

        creates = [
            r for r in self.wp.requests if r["method"] == "POST" and r["path"].endswith("/posts")
        ]
        self.assertEqual(len(creates), 1, f"الكتابة اتكرّرت {len(creates)} مرات")
        self.assertEqual(len(self.wp.posts), 1, "اتعمل مقال مكرر")
        self.assertNotEqual(result.returncode, 0, "المفروض يفشل بصوت عالي")
        self.assertNoTraceback(result)


class TestSeoSilentlyDropped(PublisherTestCase):
    """
    ووردبريس الحقيقي بيقبل POST فيه مفاتيح meta مش مسجّلة **ومبيخزّنهاش**.
    الرفض بـ 400 هو الحالة النادرة، فمسار التحقق نفسه مكانش مختبَر.
    """

    scenario = "silent_meta"

    def test_warns_that_nothing_was_stored_and_still_publishes(self):
        self.article("a.md", "title: سيو\nslug: silent\nseo_title: عنوان\nseo_description: وصف")
        result = self.run_cli("publish", "--all", "-v")

        self.assertEqual(result.returncode, 0, result.output)
        self.assertIsNotNone(self.wp.post_by_slug("silent"))
        self.assertIn("مخزّنهاش", result.stderr, result.output)
        self.assertNotIn("ثبتت في", result.stdout, "ادّعى إن بلجن استلم والحقول مش متخزّنة")
        self.assertEqual(self.wp.post_by_slug("silent")["meta"], {})


class TestDoctorRouteChecks(PublisherTestCase):
    """نص وعد doctor (المسارات) مكانش عليه سيناريو فشل خالص."""

    scenario = "missing_routes"

    def test_missing_route_fails_and_is_named(self):
        result = self.run_cli("doctor")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/wp/v2/media", result.stdout)
        self.assertNotIn("جاهزة ✓", result.stdout)


class TestDeepTermPagination(PublisherTestCase):
    """
    250 تصنيف: البحث بالاسم لازم يعدّي الصفحات، والصفحة اللي بعد النهاية
    بترجع 400 من ووردبريس مش قائمة فاضية.
    """

    scenario = "many_terms"

    def test_existing_term_deep_in_pagination_is_reused(self):
        before = len(self.wp.terms("tags"))
        self.article("a.md", "title: مقال\nslug: deep\ntags: [سيو 200]")
        result = self.run_cli("publish", "--all")

        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.terms("tags")), before, "اتعمل تصنيف مكرر")
        attached = self.wp.post_by_slug("deep")["tags"]
        self.assertEqual(len(attached), 1)
        matched = next(t for t in self.wp.terms("tags") if t["id"] == attached[0])
        self.assertEqual(matched["name"], "سيو 200")

    def test_new_term_is_created_even_with_many_pages(self):
        before = len(self.wp.terms("tags"))
        self.article("a.md", "title: مقال\nslug: newterm\ntags: [وسم جديد خالص]")
        result = self.run_cli("publish", "--all")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.terms("tags")), before + 1)


class TestTermLookupHappens(PublisherTestCase):
    """
    استرجاع term_exists كان بيخفي غياب البحث: لو الأداة بتعمل POST دايمًا،
    السيرفر بيرجّع الرقم والاختبار بينجح. بنفحص سجل النداءات نفسه.
    """

    def test_existing_term_is_looked_up_not_created(self):
        self.article("a.md", "title: الأول\nslug: t1\ncategories: [أخبار]")
        self.run_cli("publish", "--all")
        self.wp.state.requests.clear()

        self.article("b.md", "title: التاني\nslug: t2\ncategories: [أخبار]")
        self.run_cli("publish", str(self.content / "b.md"))

        creates = [
            r
            for r in self.wp.requests
            if r["method"] == "POST" and r["path"].endswith("/categories")
        ]
        lookups = [
            r for r in self.wp.requests if r["method"] == "GET" and r["path"].endswith("/categories")
        ]
        self.assertEqual(creates, [], "عمل تصنيف موجود أصلًا")
        self.assertTrue(lookups, "مدوّرش على التصنيف خالص")


class TestSsrfGuardIsReached(PublisherTestCase):
    """
    الاختبار القديم كان بيوجّه لعناوين محدش بيرد عليها، فرفض الاتصال كان
    بيحقّق التأكيد زي الحماية بالظبط. هنا السيرفر موجود وبيسجّل كل طلب.
    """

    def _recording_server(self):
        hits = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                hits.append(self.path)
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(PNG_BYTES)))
                self.end_headers()
                self.wfile.write(PNG_BYTES)

            def log_message(self, *a):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}", hits

    def test_loopback_image_is_never_fetched(self):
        base, hits = self._recording_server()
        self.article("a.md", f"title: ssrf\nslug: ssrf\nfeatured_image: {base}/hero.png")
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="0")

        self.assertFailsCleanly(result, contains="داخلي")
        self.assertEqual(hits, [], "الأداة وصلت لعنوان داخلي فعلًا")
        self.assertEqual(len(self.wp.media), 0)

    def test_opt_in_allows_it(self):
        """المخرج الصريح لازم يشتغل — وإلا الاختبارات نفسها مش هتقدر تجرّب."""
        base, hits = self._recording_server()
        self.article("a.md", f"title: ok\nslug: ok\nfeatured_image: {base}/hero.png")
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(hits), 1)


class TestPathConfinementIsReached(PublisherTestCase):
    """
    اختبارات المسار القديمة كانت بتستخدم /etc/passwd، وده بيتوقف عند فحص
    البايتات (مش صورة) قبل فحص الحصر — فالحصر نفسه مكانش مختبَر.
    """

    def test_real_image_outside_the_project_is_refused(self):
        outside = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(outside, ignore_errors=True))
        (outside / "hero.png").write_bytes(PNG_BYTES)

        self.article("a.md", f"title: بره\nslug: outside\nfeatured_image: {outside / 'hero.png'}")
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")

        self.assertFailsCleanly(result, contains="بره مجلدات المشروع")
        self.assertEqual(len(self.wp.media), 0)

    def test_relative_traversal_to_a_real_image_is_refused(self):
        outside = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(outside, ignore_errors=True))
        (outside / "hero.png").write_bytes(PNG_BYTES)
        depth = len(self.content.resolve().parts)
        traversal = "../" * depth + str(outside / "hero.png").lstrip("/")

        self.article("a.md", f'title: تسلق\nslug: trav\nfeatured_image: "{traversal}"')
        result = self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertFailsCleanly(result)
        self.assertEqual(len(self.wp.media), 0)


class TestDryRunWithEverything(PublisherTestCase):
    """
    المعاينة القديمة كانت على مقال بدون تصنيفات ولا صورة — والكتابة الوحيدة
    اللي المعاينة ممكن تعملها هي بالظبط إنشاء التصنيفات ورفع الصور.
    """

    def test_dry_run_creates_no_terms_and_uploads_nothing(self):
        self.image("hero.png")
        self.article(
            "a.md",
            "title: معاينة كاملة\nslug: preview-all\ncategories: [تصنيف جديد]\n"
            "tags: [وسم جديد]\nfeatured_image: hero.png\nseo_title: عنوان",
        )
        result = self.run_cli("publish", "--all", "--dry-run", WP_ALLOW_LOCAL_FETCH="1")

        self.assertEqual(result.returncode, 0, result.output)
        writes = [r for r in self.wp.requests if r["method"] == "POST"]
        self.assertEqual(writes, [], f"المعاينة كتبت: {writes}")
        self.assertEqual(self.wp.terms("categories"), [])
        self.assertEqual(self.wp.terms("tags"), [])
        self.assertEqual(self.wp.media, [])
        self.assertEqual(self.wp.posts, [])


class TestStatelessRepublish(PublisherTestCase):
    """
    الـ CI بيشتغل بدون سجل نشر (الملف متجاهل في git). في الحالة دي المطابقة
    بالـ slug هي الوحيدة، وهي اللي كانت بتفشل على الـ slug العربي المشفّر.
    """

    def _publish_twice_without_state(self, front_matter: str) -> None:
        self.article("a.md", front_matter)
        first = self.run_cli("publish", "--all")
        self.assertEqual(first.returncode, 0, first.output)
        state = self.content / ".published.json"
        if state.exists():
            state.unlink()
        second = self.run_cli("publish", "--all")
        self.assertEqual(second.returncode, 0, second.output)

    def test_arabic_slug_is_matched_without_state(self):
        self._publish_twice_without_state("title: دليل السيو العربي")
        self.assertEqual(len(self.wp.posts), 1, [p["slug"] for p in self.wp.posts])

    def test_published_arabic_article_is_matched_without_state(self):
        self._publish_twice_without_state("title: مقال منشور بالعربي\nstatus: publish")
        self.assertEqual(len(self.wp.posts), 1, [p["slug"] for p in self.wp.posts])

    def test_ascii_slug_is_matched_without_state(self):
        self._publish_twice_without_state("title: English Post\nslug: english-post")
        self.assertEqual(len(self.wp.posts), 1)

    def test_state_file_pointed_at_devnull(self):
        """بعض البيئات بتشغّل الأداة بدون مكان للكتابة خالص."""
        self.article("a.md", "title: مقال\nslug: nostate")
        for _ in range(2):
            result = self.run_cli("publish", "--all", WP_STATE_FILE="/dev/null")
            self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(len(self.wp.posts), 1)


class TestForeignPostCollision(PublisherTestCase):
    """أول تشغيل عند المستخدم الجديد: مقال بنفس الـ slug موجود على الموقع أصلًا."""

    def test_adopting_an_unknown_post_warns(self):
        import base64
        import urllib.request

        token = base64.b64encode(f"{self.wp.user}:{self.wp.password}".encode()).decode()
        request = urllib.request.Request(
            f"{self.wp.url}/wp-json/wp/v2/posts",
            data=json.dumps(
                {"title": "مقال قديم على الموقع", "slug": "shared-slug", "status": "publish"}
            ).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Basic {token}"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            existing = json.load(response)

        self.article("a.md", "title: مقالي\nslug: shared-slug")
        result = self.run_cli("publish", "--all")

        self.assertIn(str(existing["id"]), result.stdout)
        self.assertIn("عمرها ما نشرته", result.stdout, result.output)

    def test_dry_run_shows_the_existing_post_before_anything_is_written(self):
        self.article("a.md", "title: مقال\nslug: preview-update")
        self.run_cli("publish", "--all")
        (self.content / ".published.json").unlink()
        result = self.run_cli("publish", "--all", "--dry-run")
        self.assertIn("سيتم التحديث #", result.stdout)


class TestMediaDedupePathsInIsolation(PublisherTestCase):
    """الاعتماد على مسارين: الرقم المسجّل، ومطابقة اسم الملف. كل واحد لوحده."""

    def test_filename_path_alone(self):
        """بدون سجل: المطابقة بالاسم لازم تمنع الرفع التاني."""
        self.image("hero.png")
        self.article("a.md", "title: صورة\nslug: img\nfeatured_image: hero.png")
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        (self.content / ".published.json").unlink()
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(len(self.wp.media), 1)

    def test_recorded_id_path_alone(self):
        """بعد ما الملف المحلي يتغيّر اسمه، الرقم المسجّل لازم يمنع الرفع."""
        self.image("hero.png")
        self.article("a.md", "title: صورة\nslug: img\nfeatured_image: hero.png")
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        first_media = self.wp.media[0]["id"]
        self.run_cli("publish", "--all", WP_ALLOW_LOCAL_FETCH="1")
        self.assertEqual(len(self.wp.media), 1)
        self.assertEqual(self.wp.posts[0]["featured_media"], first_media)


class TestCredentialHostPin(unittest.TestCase):
    """الحماية دي جوه request() ومفيش اختبار كان بيوصل لفرعها."""

    def _client(self):
        sys.path.insert(0, str(ROOT))
        import wp_publish

        cfg = wp_publish.Config(site="https://mysite.example", user="u", app_password="p")
        return wp_publish, wp_publish.WPClient(cfg)

    def test_absolute_url_to_another_host_is_refused(self):
        wp_publish, client = self._client()
        with self.assertRaises(wp_publish.WPError) as caught:
            client.request("GET", "https://evil.example/wp-json/")
        self.assertIn("مضيف مختلف", str(caught.exception))

    def test_application_password_spaces_are_stripped(self):
        """ووردبريس بيعرض الباسورد بمسافات، والناس بتنسخه كده."""
        import os

        sys.path.insert(0, str(ROOT))
        import wp_publish

        saved = {k: os.environ.get(k) for k in ("WP_SITE_URL", "WP_USERNAME", "WP_APP_PASSWORD")}
        os.environ.update(
            {
                "WP_SITE_URL": "https://x.example",
                "WP_USERNAME": "u",
                "WP_APP_PASSWORD": "abcd efgh ijkl mnop qrst uvwx",
                "WP_ENV_FILE": "/dev/null",
            }
        )
        try:
            cfg = wp_publish.Config.from_env()
            self.assertEqual(cfg.app_password, "abcdefghijklmnopqrstuvwx")
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


class TestMiniYamlFallback(unittest.TestCase):
    """
    _mini_yaml هو البديل الموثّق لما PyYAML مش مركّبة، ومكانش عليه اختبار واحد.
    """

    def setUp(self):
        sys.path.insert(0, str(ROOT))
        import wp_publish

        self.parse = wp_publish._mini_yaml

    def test_bare_key_is_none(self):
        self.assertIsNone(self.parse("slug:")["slug"])

    def test_inline_list(self):
        self.assertEqual(self.parse("tags: [أ, ب, ج]")["tags"], ["أ", "ب", "ج"])

    def test_dash_list(self):
        self.assertEqual(self.parse("tags:\n  - أ\n  - ب")["tags"], ["أ", "ب"])

    def test_booleans(self):
        parsed = self.parse("a: true\nb: false")
        self.assertIs(parsed["a"], True)
        self.assertIs(parsed["b"], False)

    def test_quoted_value_and_comment(self):
        parsed = self.parse('# تعليق\ntitle: "عنوان"\nslug: \'my-slug\'')
        self.assertEqual(parsed["title"], "عنوان")
        self.assertEqual(parsed["slug"], "my-slug")

    def test_colon_inside_a_value(self):
        self.assertEqual(self.parse("title: العنوان: الجزء الأول")["title"], "العنوان: الجزء الأول")

    def test_works_end_to_end_without_pyyaml(self):
        """نشر حقيقي والـ PyYAML محجوبة — المسار الموثّق لازم يشتغل."""
        blocker = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(blocker, ignore_errors=True))
        (blocker / "yaml.py").write_text("raise ImportError('محجوبة للاختبار')\n", encoding="utf-8")

        sys.path.insert(0, str(ROOT / "tests"))
        from mock_wp import MockWP

        with MockWP() as wp, tempfile.TemporaryDirectory() as content:
            (Path(content) / "a.md").write_text(
                "---\ntitle: بدون PyYAML\nslug: no-yaml\ntags: [أ, ب]\n---\n\nنص المقال.\n",
                encoding="utf-8",
            )
            import os

            env = {
                k: v
                for k, v in os.environ.items()
                if k in ("PATH", "HOME", "LANG", "TMPDIR", "SYSTEMROOT")
            }
            env.update(
                {
                    "PYTHONPATH": str(blocker),
                    "NO_PROXY": "127.0.0.1,localhost",
                    "WP_SITE_URL": wp.url,
                    "WP_USERNAME": wp.user,
                    "WP_APP_PASSWORD": wp.password,
                    "WP_ENV_FILE": "/dev/null",
                    "WP_ALLOW_HTTP": "1",
                    "WP_CONTENT_DIR": content,
                    "WP_STATE_FILE": str(Path(content) / ".s.json"),
                }
            )
            result = subprocess.run(
                [sys.executable, "wp_publish.py", "publish", "--all"],
                capture_output=True,
                text=True,
                env=env,
                cwd=str(ROOT),
                timeout=90,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            post = wp.post_by_slug("no-yaml")
            self.assertIsNotNone(post)
            self.assertEqual(len(post["tags"]), 2)


class TestDocumentedPathsExist(unittest.TestCase):
    """التوثيق بيوعد بملفات — لازم تكون موجودة فعلًا في النسخة اللي بتتسلّم."""

    def test_referenced_files_exist(self):
        for relative in (
            ".env.example",
            "requirements.txt",
            "content/_template.md",
            "tests/mock_wp.py",
            "../.github/workflows/publish-articles.yml",
            "../START-HERE.md",
            "../.claude/skills/wp-publisher/SKILL.md",
        ):
            with self.subTest(path=relative):
                self.assertTrue((ROOT / relative).exists(), relative)

    def test_advertised_test_count_matches_reality(self):
        """العدد المكتوب في README لازم يساوي العدد الحقيقي."""
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        match = re.search(r"# (\d+) اختبار", readme)
        self.assertIsNotNone(match, "README مش بيقول عدد الاختبارات")
        # نفس شكل الأمر الموثّق: python3 -m unittest discover -s tests
        loader = unittest.TestLoader()
        actual = loader.discover(str(ROOT / "tests")).countTestCases()
        self.assertEqual(
            int(match.group(1)),
            actual,
            f"README بيقول {match.group(1)} والحقيقي {actual}",
        )


class TestRealWordPressSlugFormat(unittest.TestCase):
    """
    القيم دي مسحوبة من ووردبريس 6.9.7 حقيقي، مش مخترعة.

    الوسم "اختبار تشفير السلاج العربي" اتعمل على موقع حقيقي بدون slug، وووردبريس
    ولّد التشفير اللي تحت — بحروف **صغيرة**. Python's quote() بيطلّعها كبيرة،
    فأي مقارنة حرفية أو تشفير من ناحيتنا لازم ياخد ده في الحساب.
    """

    REAL_NAME = "اختبار تشفير السلاج العربي"
    REAL_SLUG = (
        "%d8%a7%d8%ae%d8%aa%d8%a8%d8%a7%d8%b1-%d8%aa%d8%b4%d9%81%d9%8a%d8%b1-"
        "%d8%a7%d9%84%d8%b3%d9%84%d8%a7%d8%ac-%d8%a7%d9%84%d8%b9%d8%b1%d8%a8%d9%8a"
    )

    def setUp(self):
        sys.path.insert(0, str(ROOT))
        import wp_publish

        self.wp_publish = wp_publish

    def test_our_slug_matches_what_wordpress_stores(self):
        """الـ slug اللي بنولّده لازم يساوي اللي ووردبريس خزّنه بعد فك التشفير."""
        from urllib.parse import unquote

        ours = self.wp_publish._slugify(self.REAL_NAME)
        self.assertEqual(unquote(self.REAL_SLUG), ours)
        self.assertNotEqual(self.REAL_SLUG, ours, "لو اتساووا يبقى التشفير مش حاصل")

    def test_find_by_slug_matches_the_real_stored_form(self):
        """المطابقة الحرفية كانت بتفشل دايمًا — كل تشغيل بدون سجل = مقال مكرر."""
        import os

        sys.path.insert(0, str(ROOT / "tests"))
        from mock_wp import MockWP

        with MockWP() as wp:
            saved = {
                k: os.environ.get(k)
                for k in ("WP_SITE_URL", "WP_USERNAME", "WP_APP_PASSWORD", "WP_ENV_FILE")
            }
            os.environ.update(
                {
                    "WP_SITE_URL": wp.url,
                    "WP_USERNAME": wp.user,
                    "WP_APP_PASSWORD": wp.password,
                    "WP_ENV_FILE": "/dev/null",
                    "WP_ALLOW_HTTP": "1",
                }
            )
            try:
                client = self.wp_publish.WPClient(self.wp_publish.Config.from_env())
                wp.state.posts[500] = {
                    "id": 500,
                    "slug": self.REAL_SLUG,  # بالشكل الحقيقي بحروف صغيرة
                    "status": "draft",
                    "title": {"raw": self.REAL_NAME},
                    "content": {"raw": "x"},
                    "date": "2026-01-01T00:00:00",
                }
                found = client.find_by_slug(self.wp_publish._slugify(self.REAL_NAME))
                self.assertIsNotNone(found, "ملقاش المقال بالـ slug الحقيقي")
                self.assertEqual(found["id"], 500)
                self.assertIsNone(
                    client.find_by_slug("slug-تاني-خالص"), "لقى مقال مش بتاعه"
                )
            finally:
                for key, value in saved.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value

    def test_mock_encodes_the_way_wordpress_does(self):
        """المحاكاة لازم تطابق الحقيقة، وإلا الاختبارات تخفي البق."""
        sys.path.insert(0, str(ROOT / "tests"))
        from mock_wp import _wp_slug

        self.assertEqual(_wp_slug(self.wp_publish._slugify(self.REAL_NAME)), self.REAL_SLUG)


if __name__ == "__main__":
    unittest.main()
