"""
تحويل Markdown إلى Gutenberg Blocks جاهزة لووردبريس.

بدون أي مكتبات خارجية. الناتج HTML + تعليقات الـ blocks، يعني المقال يفتح
في محرر ووردبريس قابل للتعديل بشكل طبيعي، مش ككتلة HTML صمّاء.

قواعد السلامة المطبّقة هنا (الناتج بينزل على موقع حقيقي):
- كل قيمة داخل attribute بتتهرّب بـ quote=True، وكل نص بيتهرّب قبل أي تنسيق.
- روابط javascript: / data: / vbscript: / file: بتتشال.
- الوسوم المولّدة (<a> و <img> و <code>) بتتخزّن بعيد عن مسار التنسيق، فمفيش
  احتمال إن الـ emphasis يعيد كتابة جواها (زي ما كان بيحصل مع target="_blank").
"""
from __future__ import annotations

import html
import json
import re

# فاصل داخلي لحفظ الوسوم المولّدة بعيدًا عن تحويلات التنسيق.
# html.escape مش بيلمس \x00، فبينجو من مرحلة التهريب.
_SENTINEL = "\x00{}\x00"
_SENTINEL_RE = re.compile(r"\x00(\d+)\x00")

_ALLOWED_SCHEMES = ("http", "https", "mailto", "tel")


# ---------------------------------------------------------------- التهريب


def _esc_text(text: str) -> str:
    """تهريب نص عادي (عقدة نصية)."""
    return html.escape(text, quote=False)


def _esc_attr(value: str) -> str:
    """تهريب قيمة attribute — لازم quote=True وإلا علامة تنصيص تكسر الوسم."""
    return html.escape(value, quote=True)


def _safe_url(url: str) -> str:
    """يرجّع الرابط لو آمن، وسلسلة فاضية لو سكيمه خطر."""
    candidate = url.strip()
    # نشيل المسافات والمحارف اللي بتُستخدم للتهريب من الفلاتر
    bare = re.sub(r"[\s\x00-\x1f]", "", candidate)
    match = re.match(r"^([A-Za-z][A-Za-z0-9+.\-]*):", bare)
    if match:
        return candidate if match.group(1).lower() in _ALLOWED_SCHEMES else ""
    return candidate  # نسبي أو #anchor — آمن


def _is_external(url: str) -> bool:
    return url.strip().lower().startswith(("http://", "https://"))


# ---------------------------------------------------------------- تحليل الروابط


def _scan_destination(text: str, i: int) -> tuple[str, str, int] | None:
    """
    يقرأ وجهة رابط بعد '(' — بأقواس متوازنة وعنوان اختياري.
    يرجّع (url, title, الفهرس بعد ')') أو None لو مش مكتملة.
    """
    n = len(text)
    while i < n and text[i] in " \t":
        i += 1

    if i < n and text[i] == "<":  # الصيغة <url> بتسمح بمسافات وأقواس
        end = text.find(">", i + 1)
        if end == -1:
            return None
        url = text[i + 1 : end]
        i = end + 1
    else:
        start = i
        depth = 0
        while i < n:
            ch = text[i]
            if ch == "\\" and i + 1 < n:
                i += 2
                continue
            if ch == "(":
                depth += 1
            elif ch == ")":
                if depth == 0:
                    break
                depth -= 1
            elif ch in " \t":
                break
            i += 1
        url = text[start:i]

    while i < n and text[i] in " \t":
        i += 1

    title = ""
    if i < n and text[i] in "\"'":
        quote = text[i]
        end = text.find(quote, i + 1)
        if end == -1:
            return None
        title = text[i + 1 : end]
        i = end + 1
        while i < n and text[i] in " \t":
            i += 1

    if i >= n or text[i] != ")":
        return None
    return url.replace("\\(", "(").replace("\\)", ")"), title, i + 1


def _match_bracket(text: str, i: int) -> int:
    """يرجّع فهرس ']' المقابل لـ '[' عند i، أو -1."""
    depth = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


# ---------------------------------------------------------------- تنسيق السطر


def _emphasis(text: str) -> str:
    """عريض/مائل/شطب — بيشتغل على نص مهرّب فيه فواصل للوسوم المولّدة."""
    text = re.sub(r"\*\*\*(.+?)\*\*\*", r"<strong><em>\1</em></strong>", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"~~(.+?)~~", r"<s>\1</s>", text)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", text)
    text = re.sub(r"(?<![\w_])_(?!\s)([^_]+?)(?<!\s)_(?![\w_])", r"<em>\1</em>", text)
    return text


def _inline(text: str) -> str:
    """
    تنسيقات داخل السطر. الترتيب مهم:
    كود ← صور ← لينكات (كل واحد بيتخزّن كوسم كامل) ← تهريب الباقي ← تنسيق ← استرجاع.
    """
    text = text.replace("\x00", "")  # منع تصادم الفاصل الداخلي
    spans: list[str] = []

    def stash(fragment: str) -> str:
        spans.append(fragment)
        return _SENTINEL.format(len(spans) - 1)

    # 1) كود داخل السطر — محتواه حرفي ومش بياخد أي تنسيق
    text = re.sub(r"`([^`]+)`", lambda m: stash(f"<code>{_esc_text(m.group(1))}</code>"), text)

    # 2) صور ولينكات — بنبني الوسم كامل ونخزّنه بعيد عن مرحلة التنسيق
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "\\" and i + 1 < n:
            out.append(text[i : i + 2])
            i += 2
            continue

        is_image = ch == "!" and i + 1 < n and text[i + 1] == "["
        if is_image or ch == "[":
            bracket_start = i + 1 if is_image else i
            close = _match_bracket(text, bracket_start)
            if close != -1 and close + 1 < n and text[close + 1] == "(":
                parsed = _scan_destination(text, close + 2)
                if parsed:
                    url, title, end = parsed
                    label = text[bracket_start + 1 : close]
                    safe = _safe_url(url)
                    if is_image:
                        tag = f'<img src="{_esc_attr(safe)}" alt="{_esc_attr(label)}"'
                        if title:
                            tag += f' title="{_esc_attr(title)}"'
                        tag += "/>"
                    elif safe:
                        attrs = f'href="{_esc_attr(safe)}"'
                        if title:
                            attrs += f' title="{_esc_attr(title)}"'
                        if _is_external(safe):
                            attrs += ' target="_blank" rel="noreferrer noopener"'
                        tag = f"<a {attrs}>{_inline(label)}</a>"
                    else:
                        tag = _inline(label)  # رابط خطر → النص بس
                    out.append(stash(tag))
                    i = end
                    continue
        out.append(ch)
        i += 1
    text = "".join(out)

    # 3) تهريب الباقي، وبعدين التنسيق
    text = _emphasis(_esc_text(text))

    # 4) استرجاع الوسوم المخزّنة
    text = _SENTINEL_RE.sub(lambda m: spans[int(m.group(1))], text)
    return text.strip()


# ---------------------------------------------------------------- HTML خام

# وسوم بتتشال بمحتواها — مفيش سبب مشروع تنزل في مقال، وكلها نواقل تنفيذ كود
_DANGEROUS_TAGS = ("script", "style", "object", "embed", "form", "base", "meta", "link", "applet")
_DANGEROUS_BLOCK = re.compile(
    r"<\s*(" + "|".join(_DANGEROUS_TAGS) + r")\b[^>]*>.*?<\s*/\s*\1\s*>", re.I | re.S
)
_DANGEROUS_SELF = re.compile(r"<\s*(?:" + "|".join(_DANGEROUS_TAGS) + r")\b[^>]*/?>", re.I)
_EVENT_ATTR = re.compile(r"""\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", re.I)
_URL_ATTR = re.compile(
    r"""(\s(?:href|src|action|formaction|poster)\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)""", re.I
)


def sanitize_raw_html(fragment: str) -> str:
    """
    ينقّي HTML مكتوب يدويًا في المقال قبل ما ينزل على الموقع.

    الـ HTML الخام ميزة مقصودة (embeds، تنسيق خاص)، بس المقال ممكن يكون مولّد
    بالـ AI أو جاي من مصدر تاني، فمينفعش يمرّ سكربت أو معالج حدث كما هو.
    """
    cleaned = _DANGEROUS_BLOCK.sub("", fragment)
    cleaned = _DANGEROUS_SELF.sub("", cleaned)
    cleaned = _EVENT_ATTR.sub("", cleaned)

    def _clean_url(match: "re.Match[str]") -> str:
        prefix, raw = match.group(1), match.group(2)
        quote = raw[0] if raw[:1] in ("'", '"') else ""
        safe = _safe_url(raw.strip("'\""))
        return f"{prefix}{quote}{safe}{quote}" if safe else ""

    return _URL_ATTR.sub(_clean_url, cleaned).strip()


# ---------------------------------------------------------------- البلوكات


def _json_attrs(attrs: dict) -> str:
    return json.dumps(attrs, separators=(",", ":"), ensure_ascii=False)


def _block(name: str, inner: str, attrs: dict | None = None) -> str:
    meta = f" {_json_attrs(attrs)}" if attrs else ""
    return f"<!-- wp:{name}{meta} -->\n{inner}\n<!-- /wp:{name} -->"


_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_HR = re.compile(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$")
_UL = re.compile(r"^(\s*)[-*+]\s+(.*)$")
_OL = re.compile(r"^(\s*)\d+[.)]\s+(.*)$")
_QUOTE = re.compile(r"^>\s?(.*)$")
_IMG_ONLY = re.compile(r"^!\[([^\]]*)\]\(\s*(\S+?)(?:\s+\"([^\"]*)\")?\s*\)\s*$")
_FENCE = re.compile(r"^\s*(?:```|~~~)\s*([\w+-]*)\s*$")
_TABLE_SEP = re.compile(r"^\s*\|?[\s:|-]+\|[\s:|-]*$")


class _Align:
    """
    الاتجاه في ووردبريس: الـ RTL الحقيقي بييجي من لغة الموقع والقالب.
    إضافة dir="rtl" خام على <p>/<h2>/<ul> مش جزء من سكيما بلوكات ووردبريس
    وبتخلّي المحرر يقول "البلوك فيه محتوى غير متوقع". فلما المستخدم يطلب rtl
    صريح بنستخدم الـ attribute المعتمد رسميًا (محاذاة لليمين) بدل dir الخام.
    """

    def __init__(self, direction: str | None):
        self.on = direction == "rtl"

    @property
    def cls(self) -> str:
        return ' class="has-text-align-right"' if self.on else ""

    def attrs(self, key: str, extra: dict | None = None) -> dict | None:
        merged = dict(extra or {})
        if self.on:
            merged[key] = "right"
        return merged or None


def md_to_blocks(markdown: str, direction: str | None = None) -> str:
    """يحوّل نص Markdown كامل إلى Gutenberg blocks."""
    align = _Align(direction)
    out: list[str] = []
    lines = markdown.replace("\r\n", "\n").split("\n")
    i, n = 0, len(lines)

    while i < n:
        start_i = i
        line = lines[i]

        if not line.strip():
            i += 1
            continue

        # كود بين ``` — لو مقفلش، بناخد لآخر الملف بدل ما ندخل في حلقة
        fence = _FENCE.match(line)
        if fence:
            lang = fence.group(1)
            i += 1
            buf: list[str] = []
            while i < n and not _FENCE.match(lines[i]):
                buf.append(lines[i])
                i += 1
            i = min(i + 1, n)
            code = _esc_text("\n".join(buf))
            out.append(
                _block(
                    "code",
                    f'<pre class="wp-block-code"><code>{code}</code></pre>',
                    {"language": lang} if lang else None,
                )
            )
            continue

        # عنوان — h1 بيترقّى لـ h2 لأن ووردبريس بياخد الـ h1 لعنوان المقال
        heading = _HEADING.match(line)
        if heading:
            level = max(2, len(heading.group(1)))
            text = _inline(heading.group(2))
            extra = {"level": level} if level != 2 else None
            out.append(
                _block(
                    "heading",
                    f"<h{level}{align.cls}>{text}</h{level}>",
                    align.attrs("textAlign", extra),
                )
            )
            i += 1
            continue

        if _HR.match(line):
            out.append(
                _block("separator", '<hr class="wp-block-separator has-alpha-channel-opacity"/>')
            )
            i += 1
            continue

        # صورة لوحدها في سطر
        img = _IMG_ONLY.match(line)
        if img:
            alt, src, caption = img.group(1), img.group(2), img.group(3)
            safe = _safe_url(src)
            if safe:
                inner = (
                    '<figure class="wp-block-image size-large">'
                    f'<img src="{_esc_attr(safe)}" alt="{_esc_attr(alt)}"/>'
                )
                if caption:
                    inner += f'<figcaption class="wp-element-caption">{_inline(caption)}</figcaption>'
                inner += "</figure>"
                out.append(_block("image", inner, {"sizeSlug": "large", "linkDestination": "none"}))
                i += 1
                continue
            # رابط صورة خطر → بنعامله كفقرة نص

        # جدول — لازم سطر الفاصل تحته، وإلا يبقى فقرة عادية
        if line.lstrip().startswith("|") and i + 1 < n and _TABLE_SEP.match(lines[i + 1]):
            header = _split_row(line)
            i += 2
            rows: list[list[str]] = []
            while i < n and lines[i].lstrip().startswith("|"):
                rows.append(_split_row(lines[i]))
                i += 1
            width = len(header)
            thead = "".join(f"<th>{_inline(c)}</th>" for c in header)
            body = []
            for row in rows:
                cells = (row + [""] * width)[:width]  # كل صف بعرض العنوان
                body.append("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in cells) + "</tr>")
            inner = (
                '<figure class="wp-block-table"><table class="has-fixed-layout">'
                f"<thead><tr>{thead}</tr></thead><tbody>{''.join(body)}</tbody>"
                "</table></figure>"
            )
            out.append(_block("table", inner, {"hasFixedLayout": True}))
            continue

        # قوائم — بتداخل حقيقي حسب المسافات البادئة
        if _UL.match(line) or _OL.match(line):
            items, i = _collect_list_items(lines, i)
            out.append(_render_list(items, 0))
            continue

        # اقتباس
        if _QUOTE.match(line):
            buf = []
            while i < n and _QUOTE.match(lines[i]):
                buf.append(_QUOTE.match(lines[i]).group(1))
                i += 1
            para = _inline(" ".join(x for x in buf if x.strip()))
            inner = (
                '<blockquote class="wp-block-quote">'
                f"<!-- wp:paragraph -->\n<p>{para}</p>\n<!-- /wp:paragraph -->"
                "</blockquote>"
            )
            out.append(_block("quote", inner))
            continue

        # HTML خام — بيتنقّى قبل ما ينزل
        if line.lstrip().startswith("<"):
            buf = []
            while i < n and lines[i].strip():
                buf.append(lines[i])
                i += 1
            safe_html = sanitize_raw_html("\n".join(buf))
            if safe_html:
                out.append(_block("html", safe_html))
            continue

        # فقرة — وده كمان شبكة الأمان: أي سطر مش مفهوم يبقى فقرة
        buf = []
        while i < n and lines[i].strip() and not _is_block_start(lines[i]):
            buf.append(lines[i].strip())
            i += 1
        if not buf:  # ضمان التقدّم: السطر بدا كبلوك لكن محققش شرطه
            buf.append(lines[i].strip())
            i += 1
        text = _inline(" ".join(buf))
        if text:
            out.append(_block("paragraph", f"<p{align.cls}>{text}</p>", align.attrs("align")))

        if i == start_i:  # مستحيل نظريًا، بس أحسن من حلقة لا نهائية
            i += 1

    return "\n\n".join(out)


# ---------------------------------------------------------------- القوائم


def _collect_list_items(lines: list[str], i: int) -> tuple[list[dict], int]:
    """يجمع عناصر القائمة مع مستوى كل عنصر ونوعه."""
    items: list[dict] = []
    n = len(lines)
    while i < n:
        ul, ol = _UL.match(lines[i]), _OL.match(lines[i])
        match = ol or ul
        if not match:
            break
        indent = len(match.group(1).expandtabs(4))
        items.append({"indent": indent, "ordered": bool(ol), "text": match.group(2).strip()})
        i += 1
        # أسطر تابعة لنفس العنصر (لفّ نص، مش عنصر جديد)
        while (
            i < n
            and lines[i].strip()
            and not _UL.match(lines[i])
            and not _OL.match(lines[i])
            and lines[i][:1] in (" ", "\t")
        ):
            items[-1]["text"] += " " + lines[i].strip()
            i += 1
    return items, i


def _render_list(items: list[dict], pos: int, level_indent: int | None = None) -> str:
    """يبني قائمة (ومتداخلاتها) بمعمار ووردبريس: القائمة الفرعية جوه الـ <li>."""
    rendered, _ = _render_list_from(items, pos, level_indent)
    return rendered


def _render_list_from(
    items: list[dict], pos: int, level_indent: int | None
) -> tuple[str, int]:
    base = items[pos]["indent"] if level_indent is None else level_indent
    ordered = items[pos]["ordered"]
    pieces: list[str] = []

    while pos < len(items) and items[pos]["indent"] >= base:
        item = items[pos]
        if item["indent"] > base:  # يتعامل معاه المستوى الأعمق تحت
            break
        inner = _inline(item["text"])
        pos += 1
        if pos < len(items) and items[pos]["indent"] > base:
            nested, pos = _render_list_from(items, pos, items[pos]["indent"])
            inner += nested
        pieces.append(f"<!-- wp:list-item -->\n<li>{inner}</li>\n<!-- /wp:list-item -->")

    tag = "ol" if ordered else "ul"
    block = _block(
        "list",
        f'<{tag} class="wp-block-list">{"".join(pieces)}</{tag}>',
        {"ordered": True} if ordered else None,
    )
    return block, pos


def _split_row(line: str) -> list[str]:
    """يقسّم صف جدول على | غير المهرّبة وخارج الـ backticks."""
    body = line.strip()
    cells, current, in_code = [], [], False
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body):
            current.append(body[i + 1])
            i += 2
            continue
        if ch == "`":
            in_code = not in_code
            current.append(ch)
        elif ch == "|" and not in_code:
            cells.append("".join(current))
            current = []
        else:
            current.append(ch)
        i += 1
    cells.append("".join(current))
    if cells and not cells[0].strip():
        cells.pop(0)
    if cells and not cells[-1].strip():
        cells.pop()
    return [c.strip() for c in cells]


def _is_block_start(line: str) -> bool:
    return bool(
        _HEADING.match(line)
        or _HR.match(line)
        or _UL.match(line)
        or _OL.match(line)
        or _QUOTE.match(line)
        or _FENCE.match(line)
        or _IMG_ONLY.match(line)
        or line.lstrip().startswith("<")
    )


# ---------------------------------------------------------------- الملخص


def plain_excerpt(markdown: str, limit: int = 160) -> str:
    """ملخص نصي نظيف من أول فقرة كاملة — لو المستخدم مكتبش excerpt."""
    lines = markdown.replace("\r\n", "\n").split("\n")
    paragraph: list[str] = []
    for raw in lines:
        line = raw.strip()
        if not line:
            if paragraph:
                break
            continue
        if _is_block_start(line) or line.lstrip().startswith("|"):
            if paragraph:
                break
            continue
        paragraph.append(line)

    if not paragraph:
        return ""

    text = " ".join(paragraph)
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)  # لينكات وصور → نصها
    text = re.sub(r"[*_`~]", "", text)
    text = re.sub(r"\s+", " ", text).strip()

    if len(text) <= limit:
        return text
    words = re.split(r"\s+", text)
    built = ""
    for word in words:
        candidate = f"{built} {word}".strip()
        if len(candidate) > limit:
            break
        built = candidate
    return (built or text[:limit]).rstrip() + "…"
