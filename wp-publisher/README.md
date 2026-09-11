# ناشر المقالات الآلي — WordPress REST API

أداة تنشر المقالات على ووردبريس آليًا من ملفات Markdown، عبر REST API و Application Password.

## الإجابة المختصرة: أيوه، البيانات كافية

`Application Password` + رابط `/wp-json/wp/v2` هما بالظبط الطريقة الرسمية المدعومة من
ووردبريس للنشر الآلي. مش محتاج بلجن ولا أي حاجة زيادة. اللي بتقدر تعمله بالبيانات دي:

| العملية | مدعومة |
|---|---|
| إنشاء وتحديث المقالات | ✓ |
| جدولة النشر لتاريخ مستقبلي | ✓ |
| رفع الصور وتحديد الصورة البارزة | ✓ |
| إنشاء التصنيفات والوسوم لو مش موجودة | ✓ |
| حفظ كـ draft للمراجعة قبل النشر | ✓ |
| الـ SEO meta (Yoast / RankMath) | حسب إعداد البلجن — شوف الأسفل |

**تنبيه واحد مهم:** الـ Application Password بيشتغل بصلاحيات اليوزر `AI Publisher`.
لو اليوزر ده Administrator، الباسورد ده يقدر يعمل حاجات أكتر بكتير من النشر.
الأفضل تخلّي دوره **Author** أو **Editor** بس.

---

## التشغيل في 3 دقايق

```bash
cd wp-publisher
pip install -r requirements.txt

cp .env.example .env      # وحُط بياناتك جواه
python3 wp_publish.py doctor
```

`doctor` بيختبر 4 حاجات ويقولك بالظبط إيه الشغال وإيه لأ: وصول REST API،
المصادقة، الصلاحيات (نشر / تعديل / رفع صور / تصنيفات)، وقراءة المقالات.

بعد كده:

```bash
python3 wp_publish.py publish --all --dry-run   # معاينة — مفيش أي كتابة على الموقع
python3 wp_publish.py publish --all             # ينزّل كـ draft (الافتراضي الآمن)
python3 wp_publish.py publish --all --status publish   # نشر مباشر
```

## شكل ملف المقال

ملف `.md` في `content/`، بـ front matter في الأول. ابدأ من `content/_template.md`:

```markdown
---
title: عنوان المقال
slug: article-slug
status: draft
categories: [Insights]
tags: [import, logistics]
featured_image: ../images/hero.jpg
date: 2026-10-01T09:00:00
---

نص المقال بالـ Markdown العادي.
```

كل الحقول اختيارية ما عدا `title`. لو مكتبتش `slug` هيتولّد من العنوان،
ولو مكتبتش `excerpt` هيتولّد من أول فقرة.

**الـ Markdown بيتحول لـ Gutenberg Blocks** — مش HTML صمّاء. يعني المقال يفتح في
محرر ووردبريس وتعدّله بالبلوكات عادي. المدعوم: عناوين، فقرات، قوائم، اقتباسات،
جداول، كود، صور، فواصل، و HTML خام.

المقالات العربية بتتعرف أوتوماتيك وبيضاف لها `dir="rtl"` (تقدر تجبرها بـ `dir: rtl`).

## الأوامر

| الأمر | الوظيفة |
|---|---|
| `doctor` | اختبار الاتصال والمصادقة والصلاحيات |
| `list [--limit N]` | آخر المقالات على الموقع بحالتها وروابطها |
| `publish --all` | نشر/تحديث كل `content/*.md` |
| `publish FILE...` | ملفات محددة |
| `--dry-run` | معاينة بدون أي كتابة |
| `--status` | يتخطى الحالة المكتوبة في الملف |
| `-v` | تفاصيل أكتر (رفع الصور، SEO) |

### التشغيل مرتين مش بيعمل تكرار

الأداة بتدوّر على مقال بنفس الـ `slug` الأول: لو موجود **بتحدّثه**، لو مش موجود
**بتعمله**. فتقدر تشغّل `publish --all` كل يوم بدون قلق من مقالات مكررة.

الملفات اللي اسمها بيبدأ بـ `_` بيتم تجاهلها (زي `_template.md`).

## الأتمتة — 3 طرق

### 1. GitHub Actions (جاهز)

`.github/workflows/publish-articles.yml` موجود وبيشتغل: عند أي push على
`wp-publisher/content/`، ويوميًا 9 صباحًا بتوقيت سيدني، أو يدويًا.

قبل ما يشتغل، حُط الـ secrets في: **Settings → Secrets and variables → Actions**

- `WP_SITE_URL`
- `WP_USERNAME`
- `WP_APP_PASSWORD`

### 2. cron على سيرفرك

```bash
0 9 * * * cd /path/to/wp-publisher && /usr/bin/python3 wp_publish.py publish --all >> publish.log 2>&1
```

### 3. n8n

نفس الفكرة بدون كود: `Schedule` → `HTTP Request` على
`https://kdinternational.com.au/wp-json/wp/v2/posts` بـ Basic Auth (اليوزر +
الـ application password)، والـ body JSON فيه `title` و `content` و `status`.

## الأمان

1. **ملف `.env` متجاهَل في git** — الباسورد مش هيترفع بالغلط. متحطّهوش في أي
   ملف تاني بيتعمله commit.
2. **غيّر الباسورد اللي كان مكشوف.** امسح الـ Application Password القديم من
   **Users → Profile → Application Passwords** واعمل واحد جديد. مسح الباسورد بيلغيه
   فورًا ومش بيأثر على دخولك العادي.
3. **قلّل دور اليوزر** لـ Author أو Editor بدل Administrator.
4. لو الباسورد اتكشف تاني: امسحه من نفس الصفحة — كل application password منفصل
   وإلغاء واحد مش بيأثر على الباقي.

## استكشاف الأخطاء

**`401` مع إن البيانات صح** — أشهر سبب: السيرفر بيرمي ترويسة `Authorization` قبل
ما توصل لووردبريس (شائع على Apache + CGI/FastCGI). الحل في `.htaccess`:

```apache
SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
```

**`403` على النشر** — دور اليوزر مالوش `publish_posts`. شغّل `doctor` وشوف أي
صلاحية ناقصة، وارفع الدور لـ Author على الأقل.

**الرد مش JSON** — REST API مقفول ببلجن أمان (Wordfence، iThemes، Disable REST API)
أو بقاعدة على السيرفر. اسمح لـ `/wp-json/wp/v2/*` واختبر بـ `doctor` تاني.

**الصور مش بترفع** — بلجن أمان بيحجب `Content-Disposition`، أو `upload_files`
ناقصة من دور اليوزر، أو حجم الصورة أكبر من `upload_max_filesize`.

**تحذير SEO meta** — أغلب بلجنات السيو مش بتسجّل حقولها في REST افتراضيًا، فالكتابة
بتفشل بدون ما توقف النشر. المقال بينزل عادي وتكتب العنوان والوصف يدويًا،
أو تسجّل الحقول بـ `register_post_meta(..., show_in_rest => true)`.

## بنية المشروع

```
wp-publisher/
├── wp_publish.py       — الـ CLI: doctor / list / publish
├── markdown_blocks.py  — Markdown → Gutenberg Blocks (بدون مكتبات خارجية)
├── content/            — المقالات (.md)
├── images/             — الصور المحلية للصور البارزة
├── .env.example         — قالب البيانات
└── requirements.txt
```
