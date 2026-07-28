# بورتفوليو م. محمد خالد 💜

موقع بورتفوليو شخصي — أسود × بنفسجي نيون، عربي RTL بالكامل، مبني بـ HTML/CSS/JS خالص مع GSAP 3.13 (ScrollTrigger · ScrollSmoother · SplitText · Flip).

## الصفحات
| الصفحة | الملف | المحتوى |
|---|---|---|
| الرئيسية | `index.html` | بريلودر، هيرو، ماركيه، خدمات، مشهد Canvas مثبّت، سكرول أفقي، أرقام، آراء، CTA |
| الأعمال | `works.html` | 8 مشاريع + فلترة بحركة Flip |
| الحجز | `booking.html` | فورم 4 خطوات يرسل الطلب على الواتساب مباشرة |
| تواصل معنا | `contact.html` | واتساب / اتصال / إيميل / مواعيد الرد |

## التشغيل محليًا
مفيش أي Build — افتح `index.html` مباشرة، أو:
```bash
python3 -m http.server 8000
# ثم افتح http://localhost:8000
```

## النشر
ارفع الملفات كما هي على أي استضافة ستاتيك: GitHub Pages / Netlify / Vercel / cPanel.

## ٣ مقابض تحكم سريعة
1. **سرعة الحركة كلها**: في `js/main.js` أول الملف — عدّل `MOTION.dur` (زوّد القيم = أبطأ وأفخم).
2. **الألوان**: في `css/style.css` أول الملف — عدّل متغيرات `:root` (`--purple` وأخواتها).
3. **إيقاف تأثير معيّن**:
   - السموث سكرول: احذف سطر `ScrollSmoother.create` في `main.js`.
   - الكيرسر: احذف بلوك «الكيرسر المخصص» في `main.js`.
   - البريلودر: احذف `<div class="preloader">` من `index.html`.

## استبدال صور المشاريع بصورك الحقيقية
الصور المؤقتة في `assets/projects/p1.svg … p8.svg`. حط صورك مكانها:
1. حط الصورة (يفضل 1200×880 بصيغة webp/jpg) في `assets/projects/`.
2. في `works.html` و`index.html` غيّر `src="assets/projects/p1.svg"` لاسم صورتك.

## إضافة عنصر جديد بحركة (بدون كتابة JS)
حط السمة على أي عنصر:
```html
<div data-anim="up">يطلع من تحت</div>
<div data-anim="fade" data-delay="0.2">يظهر بتلاشي</div>
<img data-anim="curtain" src="...">   <!-- ينكشف كستارة -->
<h2 data-split><span class="split-inner">عنوان ينكشف سطر بسطر</span></h2>
```

## تعديل بيانات التواصل
- رقم الواتساب: في `js/booking.js` متغير `WA_NUMBER` + روابط `wa.me` في الصفحات.
- الإيميل والهاتف: في الفوتر بكل صفحة + `contact.html`.
