"""
تحويل Markdown إلى Gutenberg Blocks جاهزة لووردبريس.

بدون أي مكتبات خارجية. الناتج HTML + تعليقات الـ blocks، يعني المقال يفتح
في محرر ووردبريس قابل للتعديل بشكل طبيعي، مش ككتلة HTML صمّاء.
"""
from __future__ import annotations

import html
import re

_CODE_TOKEN = "\x00CODE{}\x00"


def _escape(text: str) -> str:
    return html.escape(text, quote=False)


def _inline(text: str) -> str:
    """تنسيقات داخل السطر: كود، صور، لينكات، عريض، مائل."""
    spans: list[str] = []

    # نحمي الـ inline code من باقي التحويلات
    def stash(m: re.Match[str]) -> str:
        spans.append(f"<code>{_escape(m.group(1))}</code>")
        return _CODE_TOKEN.format(len(spans) - 1)

    text = re.sub(r"`([^`]+)`", stash, text)
    text = _escape(text)

    # صورة داخل السطر
    text = re.sub(
        r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)",
        lambda m: f'<img src="{m.group(2)}" alt="{m.group(1)}"/>',
        text,
    )
    # لينك
    text = re.sub(
        r"\[([^\]]+)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)",
        lambda m: f'<a href="{m.group(2)}"'
        + (f' title="{m.group(3)}"' if m.group(3) else "")
        + (' target="_blank" rel="noreferrer noopener"' if m.group(2).startswith("http") else "")
        + f">{m.group(1)}</a>",
        text,
    )
    text = re.sub(r"\*\*\*(.+?)\*\*\*", r"<strong><em>\1</em></strong>", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", text)
    text = re.sub(r"(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])", r"<em>\1</em>", text)
    text = re.sub(r"~~(.+?)~~", r"<s>\1</s>", text)

    for i, span in enumerate(spans):
        text = text.replace(_CODE_TOKEN.format(i), span)
    return text.strip()


def _dir_attr(direction: str | None) -> str:
    return f' dir="{direction}"' if direction in ("rtl", "ltr") else ""


class _Builder:
    def __init__(self, direction: str | None = None):
        self.out: list[str] = []
        self.d = _dir_attr(direction)

    def block(self, name: str, inner: str, attrs: dict | None = None) -> None:
        meta = ""
        if attrs:
            meta = " " + _json_attrs(attrs)
        self.out.append(f"<!-- wp:{name}{meta} -->\n{inner}\n<!-- /wp:{name} -->")

    def render(self) -> str:
        return "\n\n".join(self.out)


def _json_attrs(attrs: dict) -> str:
    import json

    return json.dumps(attrs, separators=(",", ":"), ensure_ascii=False)


_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_HR = re.compile(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$")
_UL = re.compile(r"^\s*[-*+]\s+(.*)$")
_OL = re.compile(r"^\s*\d+[.)]\s+(.*)$")
_QUOTE = re.compile(r"^>\s?(.*)$")
_IMG_ONLY = re.compile(r"^!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)\s*$")
_FENCE = re.compile(r"^\s*(?:```|~~~)\s*([\w+-]*)\s*$")
_TABLE_SEP = re.compile(r"^\s*\|?[\s:|-]+\|[\s:|-]*$")


def md_to_blocks(markdown: str, direction: str | None = None) -> str:
    """يحوّل نص Markdown كامل إلى Gutenberg blocks."""
    b = _Builder(direction)
    lines = markdown.replace("\r\n", "\n").split("\n")
    i, n = 0, len(lines)

    while i < n:
        line = lines[i]

        if not line.strip():
            i += 1
            continue

        # كود بين ```
        fence = _FENCE.match(line)
        if fence:
            lang = fence.group(1)
            i += 1
            buf: list[str] = []
            while i < n and not _FENCE.match(lines[i]):
                buf.append(lines[i])
                i += 1
            i += 1
            code = _escape("\n".join(buf))
            attrs = {"language": lang} if lang else None
            b.block("code", f'<pre class="wp-block-code"><code>{code}</code></pre>', attrs)
            continue

        # عنوان
        h = _HEADING.match(line)
        if h:
            level = len(h.group(1))
            text = _inline(h.group(2))
            if level == 1:
                # H1 محفوظ لعنوان المقال نفسه في ووردبريس
                level = 2
            attrs = {"level": level} if level != 2 else None
            b.block("heading", f"<h{level}{b.d}>{text}</h{level}>", attrs)
            i += 1
            continue

        # فاصل
        if _HR.match(line):
            b.block("separator", '<hr class="wp-block-separator has-alpha-channel-opacity"/>')
            i += 1
            continue

        # صورة لوحدها
        img = _IMG_ONLY.match(line)
        if img:
            alt, src, caption = img.group(1), img.group(2), img.group(3)
            inner = f'<figure class="wp-block-image size-large"><img src="{src}" alt="{alt}"/>'
            if caption:
                inner += f"<figcaption class=\"wp-element-caption\">{_inline(caption)}</figcaption>"
            inner += "</figure>"
            b.block("image", inner, {"sizeSlug": "large", "linkDestination": "none"})
            i += 1
            continue

        # جدول
        if line.lstrip().startswith("|") and i + 1 < n and _TABLE_SEP.match(lines[i + 1]):
            header = _split_row(line)
            i += 2
            rows: list[list[str]] = []
            while i < n and lines[i].lstrip().startswith("|"):
                rows.append(_split_row(lines[i]))
                i += 1
            thead = "".join(f"<th>{_inline(c)}</th>" for c in header)
            tbody = "".join(
                "<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in r) + "</tr>" for r in rows
            )
            inner = (
                '<figure class="wp-block-table"><table class="has-fixed-layout">'
                f"<thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody>"
                "</table></figure>"
            )
            b.block("table", inner, {"hasFixedLayout": True})
            continue

        # قائمة
        if _UL.match(line) or _OL.match(line):
            ordered = bool(_OL.match(line))
            pattern = _OL if ordered else _UL
            items: list[str] = []
            while i < n and pattern.match(lines[i]):
                items.append(_inline(pattern.match(lines[i]).group(1)))
                i += 1
                # أسطر تابعة لنفس العنصر
                while i < n and lines[i].startswith(("  ", "\t")) and lines[i].strip() and not pattern.match(lines[i]):
                    items[-1] += " " + _inline(lines[i].strip())
                    i += 1
            tag = "ol" if ordered else "ul"
            inner_items = "".join(
                f"<!-- wp:list-item -->\n<li>{it}</li>\n<!-- /wp:list-item -->" for it in items
            )
            attrs = {"ordered": True} if ordered else None
            b.block("list", f"<{tag}{b.d} class=\"wp-block-list\">{inner_items}</{tag}>", attrs)
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
                f"<!-- wp:paragraph -->\n<p{b.d}>{para}</p>\n<!-- /wp:paragraph -->"
                "</blockquote>"
            )
            b.block("quote", inner)
            continue

        # HTML خام
        if line.lstrip().startswith("<"):
            buf = []
            while i < n and lines[i].strip():
                buf.append(lines[i])
                i += 1
            b.block("html", "\n".join(buf))
            continue

        # فقرة
        buf = []
        while i < n and lines[i].strip() and not _is_block_start(lines[i]):
            buf.append(lines[i].strip())
            i += 1
        text = _inline(" ".join(buf))
        if text:
            b.block("paragraph", f"<p{b.d}>{text}</p>")

    return b.render()


def _split_row(line: str) -> list[str]:
    cells = line.strip().strip("|").split("|")
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
        or line.lstrip().startswith("|")
    )


def plain_excerpt(markdown: str, limit: int = 160) -> str:
    """ملخص نصي نظيف من أول فقرة — لو المستخدم مكتبش excerpt."""
    for raw in markdown.replace("\r\n", "\n").split("\n"):
        line = raw.strip()
        if not line or _is_block_start(line):
            continue
        text = re.sub(r"[*_`~]", "", line)
        text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)
        if len(text) <= limit:
            return text
        return text[:limit].rsplit(" ", 1)[0] + "…"
    return ""
