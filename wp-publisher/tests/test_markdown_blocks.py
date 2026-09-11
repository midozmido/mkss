"""
محوّل Markdown → Gutenberg. الناتج بينزل على موقع حقيقي، فالتهريب أهم من الشكل.
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from markdown_blocks import md_to_blocks, plain_excerpt, sanitize_raw_html  # noqa: E402


class BlockTestCase(unittest.TestCase):
    def assertBalanced(self, output: str) -> None:
        """كل <!-- wp:x --> لازم يقابله <!-- /wp:x --> وإلا المحرر بيرفض المقال."""
        opens = sorted(re.findall(r"<!-- wp:([a-z-]+)", output))
        closes = sorted(re.findall(r"<!-- /wp:([a-z-]+)", output))
        self.assertEqual(opens, closes, f"بلوكات مش متوازنة:\n{output}")

    def convert(self, source: str, direction: str | None = None) -> str:
        output = md_to_blocks(source, direction)
        self.assertBalanced(output)
        return output


class TestBlockTypes(BlockTestCase):
    def test_paragraph(self):
        self.assertIn("<p>نص الفقرة</p>", self.convert("نص الفقرة"))

    def test_heading_levels(self):
        for hashes, tag in (("##", "h2"), ("###", "h3"), ("######", "h6")):
            self.assertIn(f"<{tag}", self.convert(f"{hashes} عنوان"))

    def test_h1_promoted_to_h2(self):
        """ووردبريس بياخد الـ h1 لعنوان المقال — h1 في النص بيبقى h2."""
        output = self.convert("# عنوان")
        self.assertIn("<h2", output)
        self.assertNotIn("<h1", output)

    def test_unordered_and_ordered_lists(self):
        output = self.convert("- أ\n- ب")
        self.assertIn("<ul", output)
        self.assertEqual(output.count("wp:list-item"), 4)  # فتح وقفل لكل عنصر
        output = self.convert("1. أ\n2. ب")
        self.assertIn("<ol", output)
        self.assertIn('"ordered":true', output)

    def test_nested_list(self):
        """القائمة الفرعية لازم تبقى جوه الـ <li> زي معمار ووردبريس."""
        output = self.convert("- أب\n  - ابن\n  - ابن٢\n- أب٢")
        self.assertEqual(output.count("<ul"), 2, output)
        self.assertIn("wp:list", output)

    def test_quote(self):
        output = self.convert("> اقتباس مهم")
        self.assertIn("wp:quote", output)
        self.assertIn("blockquote", output)

    def test_table_with_header(self):
        output = self.convert("| أ | ب |\n|---|---|\n| 1 | 2 |")
        self.assertEqual(output.count("<th>"), 2)
        self.assertEqual(output.count("<td>"), 2)

    def test_code_with_and_without_language(self):
        output = self.convert("```python\nx = 1\n```")
        self.assertIn('"language":"python"', output)
        self.assertIn("wp-block-code", output)
        self.assertIn("wp:code", self.convert("```\nplain\n```"))

    def test_image_with_caption(self):
        output = self.convert('![وصف](https://x.com/a.png "تعليق")')
        self.assertIn('alt="وصف"', output)
        self.assertIn("figcaption", output)

    def test_separator(self):
        self.assertIn("wp:separator", self.convert("---"))

    def test_raw_html_passthrough(self):
        output = self.convert('<div class="box">نص</div>')
        self.assertIn("wp:html", output)
        self.assertIn('class="box"', output)


class TestInlineFormatting(BlockTestCase):
    def test_bold_italic_strike_code(self):
        output = self.convert("**عريض** و *مائل* و _مائل٢_ و ~~مشطوب~~ و `كود`")
        for tag in ("<strong>", "<em>", "<s>", "<code>"):
            self.assertIn(tag, output)

    def test_bold_italic_combined(self):
        self.assertIn("<strong><em>", self.convert("***الاتنين***"))

    def test_external_link_gets_target_and_rel(self):
        output = self.convert("[الموقع](https://example.com)")
        self.assertIn('target="_blank"', output)
        self.assertIn("noopener", output)

    def test_emphasis_never_rewrites_generated_markup(self):
        """الشرطة السفلية في target="_blank" كانت بتتحول لـ <em> وتكسر الوسم."""
        output = self.convert("[الموقع](https://example.com) و نص")
        self.assertIn('target="_blank"', output)
        self.assertNotIn("<em>blank", output)

    def test_internal_link_has_no_target(self):
        output = self.convert("[صفحة](/about)")
        self.assertIn('href="/about"', output)
        self.assertNotIn("target=", output)

    def test_link_text_keeps_its_formatting(self):
        self.assertIn("<strong>", self.convert("[**عريض** جوه لينك](https://x.com)"))

    def test_url_with_balanced_parentheses(self):
        output = self.convert("[ويكي](https://en.wikipedia.org/wiki/Foo_(bar))")
        self.assertIn("Foo_(bar)", output)

    def test_angle_bracket_url_form(self):
        self.assertIn("https://x.com/a b", self.convert("[z](<https://x.com/a b>)"))

    def test_inline_code_content_is_literal(self):
        """اللي جوه الـ backticks مبياخدش تنسيق ولا يتفسّر كوسم."""
        output = self.convert("`**مش عريض**`")
        self.assertIn("<code>**مش عريض**</code>", output)


class TestEscaping(BlockTestCase):
    """الحقن هو الخطر الحقيقي — المحتوى ممكن يكون مولّد بالـ AI أو من مصدر تاني."""

    def test_script_escaped_in_every_context(self):
        cases = {
            "فقرة": "نص فيه <script>alert(1)</script>",
            "عنوان": "## <script>alert(1)</script>",
            "عنصر قائمة": "- <script>alert(1)</script>",
            "خلية جدول": "| <script>alert(1)</script> |\n|---|\n| ب |",
            "اقتباس": "> <script>alert(1)</script>",
            "كود": "```\n<script>alert(1)</script>\n```",
        }
        for where, source in cases.items():
            output = self.convert(source)
            self.assertNotIn("<script", output.lower(), f"سكربت نزل خام في {where}")
            self.assertIn("&lt;script&gt;", output, f"مفيش شكل مهرّب في {where}")

    def test_quote_in_alt_cannot_break_attribute(self):
        output = self.convert('![a" onerror="alert(1)](https://x.com/a.png)')
        self.assertNotIn('onerror="', output)
        self.assertIn("&quot;", output)

    def test_quote_in_title_cannot_break_attribute(self):
        output = self.convert('[نص](https://x.com "ti\\"tle")')
        self.assertLessEqual(output.count('title="'), 1, output)

    def test_dangerous_schemes_dropped(self):
        for bad in (
            "javascript:alert(1)",
            "JaVaScRiPt:alert(1)",
            "data:text/html,<script>x</script>",
            "vbscript:msgbox(1)",
            "file:///etc/passwd",
        ):
            output = self.convert(f"[اضغط]({bad})")
            self.assertNotIn("href=", output, f"سكيم خطر عدّى: {bad}")
            self.assertIn("اضغط", output, "نص الرابط لازم يفضل ظاهر")

    def test_safe_schemes_allowed(self):
        output = self.convert("[a](https://o.com) [b](/page) [c](mailto:a@b.c) [d](#anchor)")
        self.assertEqual(output.count("href="), 4, output)

    def test_sentinel_in_source_does_not_corrupt_output(self):
        """الفاصل الداخلي مينفعش مستخدم يزرعه في نصه ويلخبط الناتج."""
        output = self.convert("نص فيه \x000\x00 و `كود`")
        self.assertIn("<code>", output)
        self.assertNotIn("\x00", output)


class TestRawHtmlSanitizer(unittest.TestCase):
    def test_script_and_style_removed_entirely(self):
        self.assertEqual(sanitize_raw_html("<script>alert(1)</script>"), "")
        self.assertEqual(sanitize_raw_html("<style>body{display:none}</style>"), "")

    def test_event_handlers_stripped(self):
        output = sanitize_raw_html('<div onclick="steal()" class="ok">نص</div>')
        self.assertNotIn("onclick", output)
        self.assertIn('class="ok"', output)

    def test_javascript_href_dropped(self):
        output = sanitize_raw_html('<a href="javascript:alert(1)">x</a>')
        self.assertNotIn("javascript:", output)

    def test_legitimate_embed_preserved(self):
        html = '<iframe src="https://www.youtube.com/embed/abc"></iframe>'
        self.assertIn("youtube.com/embed/abc", sanitize_raw_html(html))

    def test_legitimate_markup_preserved(self):
        html = '<figure class="x"><strong>نص</strong></figure>'
        self.assertEqual(sanitize_raw_html(html), html)


class TestDegenerateInput(BlockTestCase):
    def test_empty_and_whitespace(self):
        for source in ("", "   ", "\n\n\n", "\t"):
            self.assertEqual(md_to_blocks(source), "", repr(source))

    def test_pipe_line_without_separator_terminates(self):
        """السطر ده كان بيدخّل المحوّل في حلقة لا نهائية."""
        output = self.convert("| a | b |\nنص بعده")
        self.assertIn("wp:paragraph", output)

    def test_unclosed_code_fence(self):
        output = self.convert("```python\nx = 1\nمفتوح لآخر الملف")
        self.assertIn("wp:code", output)

    def test_table_rows_padded_to_header_width(self):
        output = self.convert("| أ | ب | ج |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |")
        rows = re.findall(r"<tr>(.*?)</tr>", output)
        for row in rows[1:]:
            self.assertEqual(row.count("<td>"), 3, output)

    def test_pipe_inside_backticks_is_not_a_cell_break(self):
        output = self.convert("| `a|b` | ب |\n|---|---|\n| x | y |")
        self.assertEqual(output.count("<th>"), 2, output)

    def test_heading_with_no_text(self):
        self.assertIn("wp:heading", self.convert("## "))

    def test_long_real_article_is_valid(self):
        source = (ROOT / "content" / "example-kd-article.md").read_text(encoding="utf-8")
        self.convert(source.split("---", 2)[2])


class TestDirection(BlockTestCase):
    def test_rtl_uses_supported_attribute_not_raw_dir(self):
        """dir="rtl" الخام مش في سكيما بلوكات ووردبريس وبيخلّي المحرر يشتكي."""
        output = self.convert("نص عربي", "rtl")
        self.assertIn("has-text-align-right", output)
        self.assertNotIn('dir="', output)

    def test_no_direction_by_default(self):
        self.assertNotIn("has-text-align", self.convert("نص عربي"))


class TestExcerpt(unittest.TestCase):
    def test_joins_the_whole_first_paragraph(self):
        """الفقرة ممكن تكون على أكتر من سطر — الملخص مبيتقطعش عند أول سطر."""
        excerpt = plain_excerpt("ده أول سطر\nوده تكملته في سطر تاني\n\nفقرة تانية")
        self.assertIn("تكملته", excerpt)
        self.assertNotIn("فقرة تانية", excerpt)

    def test_skips_headings_and_blocks(self):
        excerpt = plain_excerpt("# عنوان\n\n> اقتباس\n\nدي الفقرة الحقيقية.")
        self.assertEqual(excerpt, "دي الفقرة الحقيقية.")

    def test_strips_markdown_syntax(self):
        excerpt = plain_excerpt("نص **عريض** و [لينك](https://x.com) و `كود`")
        for char in ("**", "[", "](", "`"):
            self.assertNotIn(char, excerpt)
        self.assertIn("لينك", excerpt)

    def test_truncates_on_word_boundary(self):
        excerpt = plain_excerpt("كلمة " * 80)
        self.assertTrue(excerpt.endswith("…"))
        self.assertLessEqual(len(excerpt), 165)
        self.assertNotIn("كلم…", excerpt)

    def test_short_text_not_truncated(self):
        self.assertEqual(plain_excerpt("نص قصير."), "نص قصير.")

    def test_empty_document(self):
        self.assertEqual(plain_excerpt(""), "")
        self.assertEqual(plain_excerpt("# عنوان بس"), "")


if __name__ == "__main__":
    unittest.main()
