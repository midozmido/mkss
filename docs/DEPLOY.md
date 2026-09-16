# رفع النظام على الإنترنت

---

## ⚠️ أهم نقطة: `public_html` وحده لا يكفي

المجلد `public_html` في لوحة cPanel مخصّص لملفات **PHP والملفات الساكنة**.
هذا النظام مكتوب بـ **Node.js**، ورفع ملفاته إلى `public_html` لن يُشغّله —
سيعرض المتصفح الكود نصًا أو صفحة خطأ.

لكن هذا **لا يعني أنك تحتاج سيرفرًا خاصًا بالضرورة**. أمامك ثلاثة مسارات:

| المسار | يصلح إذا | التكلفة | الصعوبة |
|---|---|---|---|
| **أ. استضافة cPanel تدعم Node.js** | استضافتك الحالية فيها «Setup Node.js App» | لا تكلفة إضافية | سهل |
| **ب. سيرفر VPS** | تريد تحكّمًا كاملًا وأداءً ثابتًا | من 5 دولارات شهريًا | متوسط |
| **ج. استضافة PHP فقط بلا Node** | لا خيار ثالث — تحتاج نقل النظام | — | غير عملي |

**افحص أولًا:** ادخل cPanel وابحث عن **Setup Node.js App** أو **Node.js Selector**.
إن وجدته فالمسار (أ) جاهز لك. أغلب مزوّدي الاستضافة في السوق العربي يوفّرونه
اليوم ضمن الخطط المشتركة.

---

## المسار أ — استضافة cPanel تدعم Node.js

### 1. ارفع الملفات
ارفع مجلد المشروع إلى مجلد **خارج** `public_html`، مثلًا:

```
/home/USERNAME/mkss/
```

ولماذا خارجه؟ لأن ما بداخل `public_html` يمكن تنزيله من المتصفح مباشرة —
وقاعدة بياناتك فيها بيانات عملائك وفواتيرهم. **لا تضع قاعدة البيانات في مجلد عام أبدًا.**

استبعد من الرفع: `node_modules` (غير موجود أصلًا — النظام بلا تبعيات) و`data/` و`.git`.

### 2. أنشئ التطبيق
من cPanel ← **Setup Node.js App** ← Create Application:

| الحقل | القيمة |
|---|---|
| Node.js version | **22** أو أحدث (لا أقل — النظام يعتمد `node:sqlite` المدمجة) |
| Application mode | Production |
| Application root | `mkss` |
| Application URL | الدومين أو الساب دومين الذي تريده |
| Application startup file | `server.js` |

### 3. اضبط متغيرات البيئة
في القسم نفسه، أضف:

```
NODE_ENV   = production
BASE_URL   = https://support.yourdomain.com
TRUST_PROXY = 1
PORT       = (اتركه — cPanel يحقنه تلقائيًا)
```

**`BASE_URL` ليس اختياريًا**: منه تُبنى روابط تفعيل حسابات عملائك. إن تركته خطأً
ستصل عملاءك روابط `localhost` لا تعمل.

### 4. جهّز البيانات
من زر **Run JS Script** في الواجهة نفسها، أو من Terminal إن كان متاحًا:

```bash
node seed.js
```

سيطبع بريد الأدمن وكلمة السر. **احفظهما فورًا** — لن تُعرض مرة أخرى.

### 5. شغّل
اضغط **Restart** ثم افتح رابطك. يجب أن تظهر صفحة الدخول.

---

## المسار ب — سيرفر VPS (الأنسب للنمو)

### 1. المتطلبات
سيرفر Ubuntu، وNode.js 22 أو أحدث:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx
node -v    # يجب أن تبدأ بـ v22 أو أعلى
```

### 2. المستخدم والملفات

```bash
sudo adduser --system --group --home /opt/mkss mkss
sudo -u mkss git clone <رابط-المستودع> /opt/mkss
cd /opt/mkss
sudo -u mkss node seed.js          # احفظ بيانات الأدمن المطبوعة
```

### 3. خدمة systemd

```bash
sudo tee /etc/systemd/system/mkss.service > /dev/null <<'UNIT'
[Unit]
Description=Support VIP System — نظام دعم العملاء
After=network.target

[Service]
Type=simple
User=mkss
WorkingDirectory=/opt/mkss
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=BASE_URL=https://support.yourdomain.com
Environment=TRUST_PROXY=1
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/mkss/data

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now mkss
sudo systemctl status mkss
```

### 4. nginx أمام التطبيق

```nginx
server {
    server_name support.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # ضروري للشات اللحظي: بدون هذين السطرين يتأخر البثّ أو ينقطع
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

ثم شهادة مجانية:

```bash
sudo certbot --nginx -d support.yourdomain.com
```

---

## الدومين أو الساب دومين

الأنسب **ساب دومين** مثل `support.yourdomain.com`:
أنشئه من cPanel ← Subdomains، أو أضف سجل `A` يشير لعنوان سيرفرك.

ولا تضعه على نفس دومين موقعك الرئيسي في مسار فرعي — فصله يجعل تعطّل أحدهما
لا يؤثر في الآخر.

---

## بعد الرفع مباشرة — قائمة فحص

- [ ] `https://` يعمل والقفل ظاهر (لا تشغّله على HTTP: الجلسات تُنقل مكشوفة)
- [ ] `BASE_URL` مضبوط على دومينك الحقيقي
- [ ] `TRUST_PROXY=1` إن كنت خلف nginx أو cPanel
- [ ] دخلت كأدمن وغيّرت كلمة السر المولّدة
- [ ] أنشأت عميلًا تجريبيًا وفتحت رابط التفعيل من متصفح آخر
- [ ] أرسلت رسالة في الشات ووصلت لحظيًا (يختبر إعداد البثّ في nginx)
- [ ] ضبطت أرقام الدفع من `/admin/settings`
- [ ] جرّبت الموقع من الهاتف
- [ ] فعّلت النسخ الاحتياطي

---

## النسخ الاحتياطي

كل بياناتك في ملف واحد: `data/mkss.db`. والطريقة الصحيحة للنسخ أثناء التشغيل:

```bash
sqlite3 /opt/mkss/data/mkss.db "VACUUM INTO '/backups/mkss-$(date +%F).db'"
```

**لا تنسخ الملف بـ `cp` والنظام يعمل** — قد تحصل على نسخة نصفها قديم ونصفها جديد.

وللجدولة اليومية:

```bash
echo '0 3 * * * sqlite3 /opt/mkss/data/mkss.db "VACUUM INTO \'/backups/mkss-$(date +\%F).db\'"' | sudo crontab -u mkss -
```

واحتفظ بنسخة **خارج السيرفر**. نسخة على السيرفر نفسه تضيع مع السيرفر.

---

## التحديث لاحقًا

```bash
cd /opt/mkss
sudo -u mkss git pull
sudo systemctl restart mkss
```

الهجرات تُطبَّق تلقائيًا عند الإقلاع، ولا تحتاج خطوة يدوية.

---

## إن كانت استضافتك PHP فقط

لن يعمل النظام كما هو، وأمامك:

1. **الأرخص:** ترقية خطتك أو نقلها إلى مزوّد يدعم Node.js — الفرق غالبًا دولارات قليلة.
2. **الأمتن:** VPS صغير، وهو ما أنصح به إن كان لديك أكثر من بضعة عملاء.
3. **غير عملي:** إعادة كتابة النظام بـ PHP — عمل شهور، وستفقد `node:sqlite`
   والبثّ اللحظي وكل ما بُني عليه.

---

## استكشاف الأعطال

| العرض | السبب الغالب |
|---|---|
| صفحة بيضاء أو «502» | التطبيق لا يعمل — `sudo journalctl -u mkss -n 50` |
| «Cannot find module 'node:sqlite'» | نسخة Node أقدم من 22.13 |
| روابط التفعيل تشير إلى localhost | `BASE_URL` غير مضبوط |
| الشات لا يحدّث لحظيًا | `proxy_buffering off` ناقص في nginx |
| «عنوان IP غير صحيح» في السجلات | `TRUST_PROXY=1` ناقص |
| الكتابة تفشل | صلاحيات `data/` — يجب أن يملكها مستخدم التطبيق |
