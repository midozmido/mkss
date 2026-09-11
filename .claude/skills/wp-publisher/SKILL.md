---
name: wp-publisher
description: >
  نشر المقالات آليًا على أي موقع ووردبريس عبر REST API و Application Password —
  من ملف Markdown لمقال منشور بتصنيفاته وصوره وسيوه. Use this skill whenever the user
  wants to publish, schedule, or update articles or blog posts on a WordPress site
  automatically, connect to a site with an Application Password, or set up recurring
  publishing. Triggers: "انشر المقال", "نزّل المقال على الموقع", "انشر على ووردبريس",
  "المقالات تنزل أوتوماتيك", "اربط الموقع", "جدول النشر", "نشر تلقائي", "ارفع المقال",
  "حدّث المقال", "application password", "wp-json", "wp/v2/posts", "publish to wordpress",
  "auto publish articles", "schedule blog posts", "wordpress rest api", "post to my blog".
  For writing the article text itself use the content/SEO skills; this skill owns the
  publishing mechanics. For editing an existing site's pages or layout, prefer a WordPress
  MCP server if one is connected.
---

# ناشر المقالات الآلي على ووردبريس

الأداة في `wp-publisher/`. بتحوّل ملف Markdown لمقال ووردبريس كامل: Gutenberg Blocks،
تصنيفات، وسوم، صورة بارزة، ملخص، وسيو — عبر REST API الرسمي بـ Application Password.

## قواعد إلزامية

1. **`doctor` قبل أي حاجة.** ممنوع تحاول تنشر قبل ما `doctor` يعدّي. لو فشل، صلّح
   السبب الأول — 90% من المشاكل بتظهر هنا بدل ما تظهر بعد نصف نشرة.
2. **`--dry-run` قبل أول نشر فعلي.** اعرض للمستخدم إيه اللي هينزل بالظبط.
3. **الافتراضي `draft`.** ممنوع تستخدم `--status publish` ولا تكتب `status: publish`
   في ملف مقال إلا لما المستخدم يقول صريح إنه عايز ينشر مباشر. النشر على موقع حقيقي فعل
   ظاهر للعالم — اسأل قبله مرة واحدة بوضوح، وبعد كده الموافقة سارية للجلسة.
   وخُد بالك: `--status` بيتطبّق على المقالات **الموجودة** كمان، فـ `--status draft`
   على موقع فيه مقالات منشورة بيرجّعهم draft.
4. **الباسورد ممنوع يتكتب في أي ملف بيتعمله commit.** مكانه `.env` بس (متجاهَل في git)،
   أو متغيرات بيئة، أو GitHub Secrets. ولو المستخدم كتب الباسورد في الشات، قول له يغيّره
   بعد ما تخلصوا — اعتبره مكشوف.
5. **`publish` على مقال موجود = تحديث للمقال الحقيقي.** الأداة بتطابق بالـ slug. لو
   المستخدم عايز مقال جديد بنفس العنوان، غيّر الـ `slug`.

## الإعداد

```bash
cd wp-publisher
pip install -r requirements.txt        # requests + PyYAML
cp .env.example .env
```

وبعدين املأ `.env`:

```
WP_SITE_URL=https://example.com
WP_USERNAME=the-wp-username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
```

الـ Application Password بيتعمل من لوحة تحكم ووردبريس:
**Users → Profile → Application Passwords → Add New**. مش باسورد الدخول العادي.
لو المستخدم مش عارف يجيبه، وجّهه للمسار ده بالظبط.

**الدور المناسب:** الباسورد بيشتغل بكل صلاحيات اليوزر. لو اليوزر Administrator،
انصح المستخدم يعمل يوزر مخصص للنشر بدور **Author** أو **Editor** بس.

## الأوامر

```bash
python3 wp_publish.py doctor                      # الاتصال + المصادقة + الصلاحيات
python3 wp_publish.py list --limit 10             # آخر المقالات على الموقع
python3 wp_publish.py publish --all --dry-run     # معاينة، صفر كتابة
python3 wp_publish.py publish --all               # draft (آمن)
python3 wp_publish.py publish content/x.md --status publish -v
```

متغيرات بيئة اختيارية: `WP_CONTENT_DIR` (مكان المقالات)، `WP_STATE_FILE` (سجل النشر)،
`WP_ENV_FILE` (مكان `.env`)، `WP_ALLOW_HTTP=1` (موقع http — الباسورد مكشوف)،
`WP_ALLOW_LOCAL_FETCH=1` (تنزيل صور من عناوين محلية)، `WP_MAX_RETRIES`، `WP_TIMEOUT`.

## شكل ملف المقال

ملف `.md` في `wp-publisher/content/`. `title` هو الحقل الوحيد الإلزامي.

```markdown
---
title: عنوان المقال
slug: article-slug            # لو فاضي بيتولّد من العنوان
status: draft                 # draft | publish | pending | private
categories: [Insights]        # بتتعمل أوتوماتيك لو مش موجودة
tags: [tag one, tag two]      # قائمة أو مفصولة بفاصلة
excerpt:                      # لو فاضي بيتولّد من أول فقرة
seo_title:
seo_description:
featured_image: ../images/hero.jpg   # مسار محلي أو URL
featured_alt:
date: 2026-10-01T09:00:00     # مع status=publish → نشر مجدول
author:                       # id اليوزر
dir:                          # rtl | ltr — بيتحدد أوتوماتيك للعربي
---

نص المقال بالـ Markdown.
```

الملفات اللي اسمها بيبدأ بـ `_` بيتم تجاهلها من `--all` (زي `_template.md`).

**المدعوم في التحويل:** عناوين (h1 بيترقّى لـ h2 لأن ووردبريس بياخد الـ h1 للعنوان)،
فقرات، قوائم مرقّمة وغير مرقّمة، اقتباسات، جداول، كود بلغة، صور بتعليق، فواصل،
HTML خام، وتنسيقات السطر (عريض، مائل، شطب، كود، لينكات — الخارجية بتاخد
`target="_blank"`). المقالات العربية بتاخد `dir="rtl"` تلقائيًا.

## سلوك مهم تعرفه

- **التشغيل مرتين مش بيكرّر.** بيلاقي المقال بالرقم المسجّل في `.published.json` الأول،
  وبعدين بالـ slug. فآمن تشغّله في cron أو CI كل يوم، وبيشتغل صح كمان لو ووردبريس غيّر الـ slug.
- **حالة المقال الموجود مبتتغيّرش** إلا لو الملف فيه `status` صريح أو استخدمت `--status`.
  فإعادة التشغيل مش بترجّع المنشور لـ draft.
- **تصادم slug بين ملفين بيوقف النشر** بدل ما يكتب فوق مقال. لو حصل، بلّغ المستخدم
  واقترح slug مختلف — متحاولش تتخطاها.
- **المقال الفاضي بيترفض** (كان هيمسح محتوى المقال الموجود). لو المستخدم عايز يفرّغ
  مقال، يعمل كده من لوحة التحكم.
- **تشغيلين في نفس الوقت بيترفضوا بقفل.** لو ظهرت رسالة قفل، استنى أو اتأكد إن مفيش
  نشر تاني شغال.
- **تعديل الرابط الدائم من لوحة التحكم بيتحفظ** — الـ slug بيتبعت بس لو اتغيّر في الملف.
- **فشل مقال مش بيوقف الباقي.** كل ملف لوحده، والخلاصة في الآخر بتقول نجح كام وفشل كام.
  الـ exit code 1 لو فيه أي فشل — مفيد للـ CI.
- **الصور مش بتترفع مرتين.** بيدوّر في مكتبة الوسائط بنفس اسم الملف الأول.
- **التصنيفات بتتعمل لو مش موجودة**، وبيتعامل مع حالة `term_exists` لو اتعملت في نفس
  اللحظة من مكان تاني.
- **الصور محصورة جوه المشروع.** مسار زي `/etc/passwd` أو `../..` بيترفض، والصور من URL
  لازم تبقى https وعلى عنوان عام. لو المستخدم محتاج صورة من مكان تاني، قول له ينقلها
  لمجلد `images/`.
- **المحتوى بينزل خامل.** السكربتات وروابط `javascript:` بتتشال. لو المستخدم محتاج embed،
  الـ iframe المشروع بيعدّي.
- **فشل الـ SEO meta مش بيوقف النشر.** أغلب بلجنات السيو مش بتسجّل حقولها في REST،
  فالمقال ينزل عادي ويطلع تحذير. ده متوقع، مش خطأ.

## الأتمتة

| الطريقة | إمتى تستخدمها |
|---|---|
| **GitHub Actions** | الجاهز في `.github/workflows/publish-articles.yml` — عند push على `content/`، أو بجدول. محتاج الـ secrets: `WP_SITE_URL`, `WP_USERNAME`, `WP_APP_PASSWORD` |
| **cron** | `0 9 * * * cd /path/wp-publisher && python3 wp_publish.py publish --all` |
| **n8n** | `Schedule` → `HTTP Request` على `/wp-json/wp/v2/posts` بـ Basic Auth |

## استكشاف الأخطاء

| العرض | السبب والحل |
|---|---|
| `401` والبيانات صح | السيرفر بيرمي ترويسة `Authorization` (شائع على Apache + CGI). الحل في `.htaccess`: `SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1` |
| `403` على النشر | دور اليوزر مالوش `publish_posts`. شغّل `doctor` وشوف الصلاحية الناقصة |
| الرد مش JSON | بلجن أمان بيحجب REST (Wordfence / Disable REST API). اسمح لـ `/wp-json/wp/v2/*` |
| الصور مش بترفع | `upload_files` ناقصة، أو بلجن بيحجب `Content-Disposition`، أو الصورة أكبر من `upload_max_filesize` |
| تحذير SEO meta | طبيعي — شوف فوق |

## الاختبارات

فيه سيرفر ووردبريس مزيّف كامل، فتقدر تتأكد إن الأداة سليمة بدون ما تلمس موقع حقيقي:

```bash
cd wp-publisher && python3 -m unittest discover -s tests     # 160 اختبار، ~95 ثانية
```

**لو عدّلت أي حاجة في الأداة، شغّل الاختبارات قبل أي نشر** — وممنوع تضعّف اختبار
علشان يعدّي.
وللتجربة اليدوية: `python3 tests/mock_wp.py` بيقوم سيرفر مزيّف ويطبع بياناته.

## التكامل مع مهارات تانية

- **كتابة المقال نفسه**: استخدم مهارات المحتوى والسيو، وبعدين حوّل الناتج لملف
  بالشكل اللي فوق.
- **موقع متوصل بـ MCP**: لو الموقع متوصل كـ WordPress MCP server، النشر المباشر عبر
  `wp_create_post` أسرع للمقال الواحد. الأداة دي أنسب للجدولة، الدفعات، تتبع المقالات
  في git، والتشغيل بدون كلود.
