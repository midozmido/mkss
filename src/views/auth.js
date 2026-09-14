// بوابتا الدخول — العميل والإدارة، منفصلتان تمامًا.
//
// لماذا بوابتان لا واحدة: حساب الأدمن أداة تشغيل، وحساب العميل واجهة خدمة.
// مدخل واحد يجعل كل تسريب في أحدهما بابًا على الآخر، ويُربك من يدخل.
// والفصل هنا **بصري** أيضًا: من يرى بوابة الإدارة يعرف فورًا أنه ليس في
// المكان الخطأ، فلا يطرق باب العملاء بحساب إداري ولا العكس.
import { authLayout, icon, esc } from './layout.js';

/**
 * حقل نصّي.
 * التسمية **فوق** الحقل لا داخله: النائب (placeholder) يختفي أول ما يكتب
 * المستخدم، فيفقد من توقّف لحظةً معرفةَ ما كان يملأ. وهذا أشيع عيب في
 * نماذج الدخول «الأنيقة».
 */
function field({ id, name, label, type = 'text', hint = '', value = '', autocomplete, extra = '' }) {
  return `<div class="field">
    <label for="${id}">${esc(label)}</label>
    <input id="${id}" name="${name}" type="${type}" required
           ${autocomplete ? `autocomplete="${autocomplete}"` : ''}
           ${type === 'email' ? 'inputmode="email" dir="ltr" spellcheck="false"' : ''}
           value="${esc(value)}" ${extra}>
    ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
  </div>`;
}

/**
 * حقل كلمة سر: زرّ إظهار، وتنبيه Caps Lock.
 *
 * تنبيه الكابس ليس رفاهية: أشيع سبب لـ«كلمة السر غلط» وهي صحيحة، ولا يراه
 * المستخدم لأن الحروف منقّطة. قوله له يوفّر محاولة ضائعة وحظرًا مؤقّتًا.
 * الزرّان يعملان إن وُجد مستمعهما في app.js، ولا يضرّان إن غاب.
 */
function passwordField({ id, name, label, autocomplete, hint = '', extra = '' }) {
  return `<div class="field">
    <label for="${id}">${esc(label)}</label>
    <div class="pw-wrap">
      <input id="${id}" name="${name}" type="password" required
             autocomplete="${autocomplete}" data-caps ${extra}>
      <button class="pw-toggle" type="button" data-pw-toggle="${id}"
              aria-controls="${id}" aria-pressed="false" aria-label="إظهار كلمة السر"
      >${icon('eye', 'pw-show')}${icon('eye-off', 'pw-hide')}</button>
    </div>
    <p class="caps-warn" hidden>${icon('alert')} <span>مفتاح Caps Lock مُفعَّل</span></p>
    ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
  </div>`;
}

/**
 * خانة الرسائل.
 * الرسالة تصل مع تحميل صفحة كامل (النموذج يُرسَل ويُعاد الرسم من الخادم)،
 * فلا «قفزة» داخل الصفحة تُمنع هنا. الخانة موجودة لتثبيت المسافة بين
 * الترويسة والنموذج في الحالتين، لا أكثر — ولا تُوعد بما لا تفعل.
 */
const slot = (error, notice) => `<div class="auth-slot" role="status" aria-live="polite">
  ${error ? `<div class="alert alert-danger" role="alert">${icon('alert')}<div>${esc(error)}</div></div>` : ''}
  ${notice ? `<div class="alert alert-ok">${icon('check')}<div>${esc(notice)}</div></div>` : ''}
</div>`;

/** زرّ الإرسال: يعرض حالته أثناء الانتظار فلا يبدو الضغط بلا أثر */
const submit = (label) => `<button class="btn btn-primary btn-block btn-lg" type="submit" data-pending="${esc(label)}">
  <span class="btn-label">${esc(label)}</span>
  <span class="spinner" aria-hidden="true"></span>
</button>`;

// ——————————————————— بوابة العملاء ———————————————————

export function clientLoginPage({ error = null, notice = null, email = '' } = {}) {
  return authLayout({
    title: 'تسجيل الدخول',
    variant: 'client',
    body: `<header class="auth-head">
    <h1>أهلًا بعودتك</h1>
    <p>ادخل بالبريد وكلمة السر — لا شيء غير ذلك.</p>
  </header>
  ${slot(error, notice)}
  <form method="POST" action="/login" class="auth-form">
    ${field({
      id: 'email', name: 'email', label: 'البريد الإلكتروني', type: 'email',
      value: email, autocomplete: 'username', extra: email ? '' : 'autofocus',
    })}
    ${passwordField({
      id: 'password', name: 'password', label: 'كلمة السر',
      autocomplete: 'current-password', extra: email ? 'autofocus' : '',
    })}
    ${submit('دخول')}
  </form>

  <details class="auth-help">
    <summary>
      <span>نسيت كلمة السر؟</span>
      ${icon('arrow', 'caret')}
    </summary>
    <form method="POST" action="/reset-request" class="auth-form">
      ${field({
        id: 'reset-email', name: 'email', label: 'بريدك الإلكتروني', type: 'email',
        autocomplete: 'username', hint: 'نتحقّق منه ثم نرسل لك رابطًا يصلح مرة واحدة.',
      })}
      <button class="btn btn-block" type="submit">اطلب رابطًا جديدًا</button>
    </form>
  </details>

  <p class="auth-switch">من فريق الإدارة؟ <a href="/admin/login">ادخل من بوابة الإدارة</a></p>`,
  });
}

// ——————————————————— بوابة الإدارة ———————————————————

export function adminLoginPage({ error = null, notice = null, email = '' } = {}) {
  return authLayout({
    title: 'بوابة الإدارة',
    variant: 'admin',
    body: `<header class="auth-head">
    <span class="auth-tag">${icon('shield')} بوابة الإدارة</span>
    <h1>تسجيل دخول الفريق</h1>
    <p>هذه البوابة لحسابات التشغيل وحدها.</p>
  </header>
  ${slot(error, notice)}
  <form method="POST" action="/admin/login" class="auth-form">
    ${field({
      id: 'email', name: 'email', label: 'البريد الإلكتروني', type: 'email',
      value: email, autocomplete: 'username', extra: email ? '' : 'autofocus',
    })}
    ${passwordField({
      id: 'password', name: 'password', label: 'كلمة السر',
      autocomplete: 'current-password', extra: email ? 'autofocus' : '',
    })}
    ${submit('دخول')}
  </form>

  <p class="auth-note">
    ${icon('alert')}
    <span>لا استعادة ذاتية لكلمة سر إدارية من الويب: تُضبط من الخادم مباشرة.
    نافذةٌ كهذه أوسع من أن تُترك مفتوحة.</span>
  </p>

  <p class="auth-switch">عميل؟ <a href="/login">ادخل من بوابة العملاء</a></p>`,
  });
}

// ——————————————————— التفعيل وكلمة السر الجديدة ———————————————————

export function setPasswordPage({ token, error = null, kind = 'activate' } = {}) {
  const isActivate = kind === 'activate';
  return authLayout({
    title: isActivate ? 'تفعيل الحساب' : 'كلمة سر جديدة',
    variant: 'client',
    body: `<header class="auth-head">
    <h1>${isActivate ? 'فعّل حسابك' : 'اختر كلمة سر جديدة'}</h1>
    <p>${isActivate ? 'خطوة واحدة، مرة واحدة فقط.' : 'اختر كلمة سر قوية وتذكّرها.'}</p>
  </header>
  ${slot(error, null)}
  <form method="POST" action="/set-password" class="auth-form">
    <input type="hidden" name="token" value="${esc(token)}">
    ${passwordField({
      id: 'password', name: 'password', label: 'كلمة السر',
      autocomplete: 'new-password', extra: 'minlength="10" autofocus',
    })}
    ${passwordField({
      id: 'confirm', name: 'confirm', label: 'تأكيد كلمة السر',
      autocomplete: 'new-password', extra: 'minlength="10"',
    })}
    <ul class="pw-rules">
      <li>${icon('check')} <span>عشرة أحرف على الأقل</span></li>
      <li>${icon('check')} <span>ليست من كلمات السر الشائعة</span></li>
      <li>${icon('check')} <span>جملة تتذكّرها أقوى من رمز تنساه</span></li>
    </ul>
    ${submit('حفظ والدخول')}
  </form>`,
  });
}
