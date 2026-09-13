// بوابتا الدخول — العميل والإدارة، منفصلتان تمامًا.
//
// لماذا بوابتان لا واحدة: حساب الأدمن أداة تشغيل، وحساب العميل واجهة خدمة.
// مدخل واحد يجعل كل تسريب في أحدهما بابًا على الآخر، ويُربك من يدخل.
// والفصل هنا **بصري** أيضًا: من يرى بوابة الإدارة يعرف فورًا أنه ليس في
// المكان الخطأ، فلا يطرق باب العملاء بحساب إداري ولا العكس.
import { authLayout, icon, esc } from './layout.js';

/** حقل نصّي — تسمية واضحة، وتلميح تحتها لا داخلها (التلميح داخل الحقل يختفي عند الكتابة) */
function field({ id, name, label, type = 'text', hint = '', value = '', autocomplete, extra = '' }) {
  return `<div class="field">
    <label for="${id}">${esc(label)}</label>
    <input id="${id}" name="${name}" type="${type}" required
           ${autocomplete ? `autocomplete="${autocomplete}"` : ''}
           ${type === 'email' ? 'inputmode="email" dir="ltr" spellcheck="false"' : ''}
           ${type === 'password' ? 'dir="ltr"' : ''}
           value="${esc(value)}" ${extra}>
    ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
  </div>`;
}

/** حقل كلمة سر بزرّ إظهار — الزر يعمل إن وُجد مستمعه، ولا يضرّ إن غاب */
function passwordField({ id, name, label, autocomplete, hint = '', extra = '' }) {
  return `<div class="field">
    <label for="${id}">${esc(label)}</label>
    <div class="pw-wrap">
      <input id="${id}" name="${name}" type="password" required dir="ltr"
             autocomplete="${autocomplete}" ${extra}>
      <button class="pw-toggle" type="button" data-pw-toggle="${id}"
              aria-controls="${id}" aria-pressed="false" aria-label="إظهار كلمة السر"
      >${icon('eye', 'pw-show')}${icon('eye-off', 'pw-hide')}</button>
    </div>
    ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
  </div>`;
}

const alerts = (error, notice) => `
  ${error ? `<div class="alert alert-danger" role="alert">${icon('alert')}<div>${esc(error)}</div></div>` : ''}
  ${notice ? `<div class="alert alert-ok" role="status">${icon('check')}<div>${esc(notice)}</div></div>` : ''}`;

// ——————————————————— بوابة العملاء ———————————————————

export function clientLoginPage({ error = null, notice = null, email = '' } = {}) {
  return authLayout({
    title: 'تسجيل الدخول',
    variant: 'client',
    body: `<div class="auth-head">
    <h1>أهلًا بعودتك</h1>
    <p class="muted">ادخل بالبريد وكلمة السر — لا شيء غير ذلك.</p>
  </div>
  ${alerts(error, notice)}
  <form method="POST" action="/login" class="stack auth-form">
    ${field({
      id: 'email', name: 'email', label: 'البريد الإلكتروني', type: 'email',
      value: email, autocomplete: 'username', extra: email ? '' : 'autofocus',
    })}
    ${passwordField({
      id: 'password', name: 'password', label: 'كلمة السر',
      autocomplete: 'current-password', extra: email ? 'autofocus' : '',
    })}
    <button class="btn btn-primary btn-block btn-lg" type="submit">دخول</button>
  </form>

  <details class="auth-help">
    <summary>نسيت كلمة السر؟</summary>
    <form method="POST" action="/reset-request" class="stack">
      ${field({
        id: 'reset-email', name: 'email', label: 'بريدك الإلكتروني', type: 'email',
        autocomplete: 'username', hint: 'سنتحقق منه ثم نرسل لك رابطًا جديدًا.',
      })}
      <button class="btn btn-block btn-sm" type="submit">اطلب رابطًا جديدًا</button>
    </form>
  </details>

  <p class="auth-switch">
    من فريق الإدارة؟ <a href="/admin/login">ادخل من بوابة الإدارة</a>
  </p>`,
  });
}

// ——————————————————— بوابة الإدارة ———————————————————

export function adminLoginPage({ error = null, notice = null, email = '' } = {}) {
  return authLayout({
    title: 'بوابة الإدارة',
    variant: 'admin',
    body: `<div class="auth-head">
    <span class="auth-tag">${icon('shield')} بوابة الإدارة</span>
    <h1>تسجيل دخول الفريق</h1>
    <p class="muted">هذه البوابة لحسابات التشغيل. حسابات العملاء تدخل من مكان آخر.</p>
  </div>
  ${alerts(error, notice)}
  <form method="POST" action="/admin/login" class="stack auth-form">
    ${field({
      id: 'email', name: 'email', label: 'البريد الإلكتروني', type: 'email',
      value: email, autocomplete: 'username', extra: email ? '' : 'autofocus',
    })}
    ${passwordField({
      id: 'password', name: 'password', label: 'كلمة السر',
      autocomplete: 'current-password', extra: email ? 'autofocus' : '',
    })}
    <button class="btn btn-primary btn-block btn-lg" type="submit">دخول</button>
  </form>

  <p class="hint auth-note">
    ${icon('alert')}
    لا استعادة ذاتية لكلمة سر إدارية من الويب: تُضبط من الخادم مباشرة.
    نافذةٌ كهذه أوسع من أن تُترك مفتوحة.
  </p>

  <p class="auth-switch">
    عميل؟ <a href="/login">ادخل من بوابة العملاء</a>
  </p>`,
  });
}

// ——————————————————— التفعيل وكلمة السر الجديدة ———————————————————

export function setPasswordPage({ token, error = null, kind = 'activate' } = {}) {
  const isActivate = kind === 'activate';
  return authLayout({
    title: isActivate ? 'تفعيل الحساب' : 'كلمة سر جديدة',
    variant: 'client',
    body: `<div class="auth-head">
    <h1>${isActivate ? 'فعّل حسابك' : 'اختر كلمة سر جديدة'}</h1>
    <p class="muted">${isActivate ? 'خطوة واحدة، مرة واحدة فقط.' : 'اختر كلمة سر قوية وتذكّرها.'}</p>
  </div>
  ${error ? `<div class="alert alert-danger" role="alert">${icon('alert')}<div>${esc(error)}</div></div>` : ''}
  <form method="POST" action="/set-password" class="stack auth-form">
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
      <li>${icon('check')} عشرة أحرف على الأقل</li>
      <li>${icon('check')} ليست من كلمات السر الشائعة</li>
      <li>${icon('check')} جملة تتذكّرها أقوى من رمز تنساه</li>
    </ul>
    <button class="btn btn-primary btn-block btn-lg" type="submit">حفظ والدخول</button>
  </form>`,
  });
}
