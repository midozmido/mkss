// واجهات الاشتراك والدفع.
// قاعدة ثابتة: مهما كانت حالة القفل، يظل العميل قادرًا على رؤية ما عليه،
// ونسخ رقم التحويل، ومراسلتنا. قفل طريق الدفع يؤخّر التحصيل لا يسرّعه.
import { esc, icon, layout, fmtDate, plural } from './layout.js';
import { money } from '../repo.js';

const digits = (s) => String(s || '').replace(/\D/g, '');

/** بطاقة طرق الدفع — إنستا باي وفودافون كاش على نفس الرقم */
export function paymentMethods(cfg, { amountCents = null, reference = null } = {}) {
  const row = (name, label, number, hint) => `
    <div class="pay-method">
      <div class="pay-method-head">
        <span class="pay-logo pay-${esc(name)}" aria-hidden="true">${name === 'instapay' ? 'IP' : 'VF'}</span>
        <div>
          <div class="pay-name">${esc(label)}</div>
          <div class="faint">${esc(hint)}</div>
        </div>
      </div>
      <div class="pay-number">
        <span class="mono ltr num">${esc(number)}</span>
        <button class="btn btn-sm" type="button" data-copy="${esc(number)}">${icon('grid')} نسخ الرقم</button>
      </div>
    </div>`;

  return `<section class="card stack" aria-labelledby="pay-h">
    <div>
      <h2 id="pay-h">${icon('receipt')} طرق الدفع</h2>
      <p class="faint" style="margin:0">حوّل على أي من الطريقتين، ثم أبلغنا بالتحويل من الزر أسفل الصفحة.</p>
    </div>

    ${amountCents != null ? `<div class="pay-amount">
      <span class="faint">المبلغ المطلوب</span>
      <b class="num">${esc(money.format(amountCents))}</b>
    </div>` : ''}

    <div class="pay-grid">
      ${row('instapay', 'إنستا باي', cfg.instapay, 'InstaPay — تحويل فوري بين البنوك')}
      ${row('vodafone', 'فودافون كاش', cfg.vodafone, 'محفظة فودافون كاش')}
    </div>

    ${cfg.holder ? `<p class="faint" style="margin:0">اسم المستلم: <b>${esc(cfg.holder)}</b></p>` : ''}

    ${reference ? `<div class="alert alert-info">${icon('alert')}<div>
      اكتب هذا الكود في خانة ملاحظات التحويل حتى نطابقه بفاتورتك فورًا:
      <b class="mono ltr">${esc(reference)}</b>
      <button class="btn btn-sm" type="button" data-copy="${esc(reference)}">نسخ</button>
    </div></div>` : ''}
  </section>`;
}

/** زر واتساب — يظهر في كل حالات المديونية */
export function whatsappButton(link, label = 'كلمنا على واتساب', big = false) {
  if (!link) return '';
  return `<a class="btn btn-whatsapp ${big ? 'btn-block' : ''}" href="${esc(link)}"
     target="_blank" rel="noopener noreferrer">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 18a8 8 0 01-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1112 20zm4.4-5.8c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.6.1a6.5 6.5 0 01-3.2-2.8c-.2-.4.2-.4.6-1.2.1-.2 0-.4 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.7 11.8 11.8 0 004.5 4 5 5 0 002.3.5 2.7 2.7 0 001.8-1.3 2.2 2.2 0 00.2-1.3z"/></svg>
    ${esc(label)}
  </a>`;
}

/** شريط الحالة أعلى لوحة العميل */
export function billingBanner(st, { link, href = '/billing' } = {}) {
  if (st.state === 'trial') {
    if (st.trialDaysLeft > 45) return '';
    return `<div class="alert alert-info">${icon('clock')}<div>
      أنت في فترة الدعم المجاني — متبقٍ <b>${plural(st.trialDaysLeft, 'يوم واحد', 'يومان', 'أيام', 'يومًا')}</b>.
      بعدها يبدأ الاشتراك الشهري. <a href="${esc(href)}">تفاصيل الاشتراك</a>
    </div></div>`;
  }
  if (st.state === 'due') {
    return `<div class="alert alert-info">${icon('receipt')}<div>
      عليك <b class="num">${esc(money.format(st.dueCents))}</b>
      ${st.oldestDueAt ? ` — موعد السداد ${esc(fmtDate(st.oldestDueAt))}` : ''}.
      <a href="${esc(href)}">ادفع الآن</a>
    </div></div>`;
  }
  if (st.state === 'grace') {
    return `<div class="alert alert-warn">${icon('alert')}<div>
      عليك <b class="num">${esc(money.format(st.dueCents))}</b> متأخرة.
      <b>باقي لك ${plural(st.graceLeft, 'يوم واحد', 'يومان', 'أيام', 'يومًا')}</b>
      قبل إيقاف مزايا لوحتك مؤقتًا.
      <div class="row" style="margin-block-start:var(--s-2)">
        <a class="btn btn-sm btn-primary" href="${esc(href)}">${icon('receipt')} طرق الدفع</a>
        ${whatsappButton(link, 'كلمنا على واتساب')}
      </div>
    </div></div>`;
  }
  return '';
}

/** صفحة القفل — تظهر بدل المزايا، ويبقى فيها كل ما يلزم للدفع والتواصل */
export function lockedPage({ user, st, cfg, link, claims = [], flash }) {
  const inv = st.invoices[0];
  const reference = inv?.reference_code || null;

  return layout({
    title: 'تفعيل الاشتراك',
    user,
    active: '/billing',
    flash,
    body: `<div class="stack">
  <section class="card lock-card">
    <div class="lock-icon" aria-hidden="true">${icon('shield')}</div>
    <h1>مزايا لوحتك متوقفة مؤقتًا</h1>
    <p class="lock-lead">
      عليك <b class="num">${esc(money.format(st.dueCents))}</b> متأخرة منذ
      <b>${plural(st.daysPastDue, 'يوم واحد', 'يومين', 'أيام', 'يومًا')}</b>،
      وقد انتهت مهلة الـ${plural(st.graceDays, 'يوم', 'يومين', 'أيام', 'يومًا')}.
    </p>
    <p class="lock-note">
      <b>مراقبة موقعك لم تتوقف</b> — ما زلنا نفحصه ونسجّل كل شيء.
      بمجرد تأكيد السداد ستعود لوحتك بكامل تاريخها بلا فقد أي بيانات.
    </p>
    <div class="row" style="justify-content:center;margin-block-start:var(--s-5)">
      ${whatsappButton(link, 'كلمنا على واتساب لتفعيل الاشتراك')}
    </div>
  </section>

  ${paymentMethods(cfg, { amountCents: st.dueCents, reference })}

  ${claimForm(st, cfg)}

  ${claims.length ? claimsList(claims) : ''}

  <section class="card">
    <h2>فواتيرك المستحقة</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>الفاتورة</th><th>الوصف</th><th>المبلغ</th><th>الاستحقاق</th></tr></thead>
      <tbody>${st.invoices
        .map(
          (i) => `<tr>
        <td class="mono">${esc(i.number)}</td>
        <td class="small">${esc(i.description || '—')}</td>
        <td class="num">${esc(money.format(i.amount_cents - (i.paid_cents || 0), i.currency))}</td>
        <td>${esc(i.due_at ? fmtDate(i.due_at) : '—')}</td>
      </tr>`
        )
        .join('')}</tbody>
    </table></div>
  </section>

  <div class="center">
    <a class="btn" href="/chat">${icon('chat')} أو راسلنا داخل النظام</a>
  </div>
</div>`,
  });
}

/** صفحة الاشتراك في الحالات غير المقفولة */
export function billingPage({ user, st, cfg, link, claims = [], flash }) {
  const inv = st.invoices[0];
  return layout({
    title: 'الاشتراك والدفع',
    user,
    active: '/billing',
    flash,
    body: `<div class="stack">
  <h1>الاشتراك والدفع</h1>
  ${billingBanner(st, { link, href: '#pay-h' })}

  ${st.state === 'trial'
    ? `<div class="card">
        <h2>${icon('check')} فترة الدعم المجاني</h2>
        <p>الستة شهور الأولى مجانية بالكامل — دعم فني وتشغيل النظام.</p>
        <p class="muted">تنتهي في <b>${esc(fmtDate(st.trialEndsAt))}</b>
          ${st.trialDaysLeft != null ? ` — متبقٍ ${plural(st.trialDaysLeft, 'يوم واحد', 'يومان', 'أيام', 'يومًا')}` : ''}.</p>
      </div>`
    : ''}

  ${st.dueCents > 0
    ? paymentMethods(cfg, { amountCents: st.dueCents, reference: inv?.reference_code })
    : `<div class="alert alert-ok">${icon('check')}<div>لا توجد مستحقات على حسابك. شكرًا لك.</div></div>
       ${paymentMethods(cfg)}`}

  ${st.dueCents > 0 ? claimForm(st, cfg) : ''}
  ${claims.length ? claimsList(claims) : ''}

  <div class="center">${whatsappButton(link, 'كلمنا على واتساب')}</div>
</div>`,
  });
}

function claimForm(st, cfg) {
  return `<section class="card">
    <h2>أبلغنا بالتحويل</h2>
    <p class="faint">إنستا باي وفودافون كاش لا يبلّغاننا تلقائيًا — أخبرنا بالتحويل ليُفعَّل حسابك أسرع.</p>
    <form method="POST" action="/billing/claim" class="stack">
      <input type="hidden" name="_csrf" value="${esc(st.csrf || '')}">
      ${st.invoices.length
        ? `<div class="field">
        <label for="cinv">الفاتورة</label>
        <select id="cinv" name="invoiceId">
          ${st.invoices.map((i) => `<option value="${i.id}">${esc(i.number)} — ${esc(money.format(i.amount_cents - (i.paid_cents || 0), i.currency))}</option>`).join('')}
        </select>
      </div>`
        : ''}
      <div class="grid grid-2">
        <div class="field">
          <label for="cmethod">طريقة التحويل</label>
          <select id="cmethod" name="method">
            <option value="instapay">إنستا باي</option>
            <option value="vodafone">فودافون كاش</option>
            <option value="other">طريقة أخرى</option>
          </select>
        </div>
        <div class="field">
          <label for="camount">المبلغ المحوَّل</label>
          <input id="camount" name="amount" type="number" step="0.01" min="0.01" required dir="ltr"
                 value="${(st.dueCents / 100).toFixed(2)}">
        </div>
      </div>
      <div class="field">
        <label for="cref">الرقم المحوَّل منه (اختياري)</label>
        <input id="cref" name="senderRef" maxlength="60" dir="ltr" placeholder="01xxxxxxxxx">
        <div class="hint">يساعدنا على مطابقة التحويل بسرعة.</div>
      </div>
      <button class="btn btn-primary" type="submit">${icon('check')} أبلغت بالتحويل</button>
    </form>
  </section>`;
}

function claimsList(claims) {
  const label = { instapay: 'إنستا باي', vodafone: 'فودافون كاش', other: 'أخرى' };
  const badge = (s) =>
    s === 'confirmed' ? `<span class="badge badge-ok">${icon('check')} مؤكَّد</span>`
      : s === 'rejected' ? `<span class="badge badge-danger">${icon('x')} غير مطابق</span>`
        : `<span class="badge badge-warn">${icon('clock')} قيد المراجعة</span>`;
  return `<section class="card card-flush">
    <div class="card-head"><h2 style="margin:0">إشعارات التحويل التي أرسلتها</h2></div>
    <div class="table-scroll"><table>
      <thead><tr><th>التاريخ</th><th>الطريقة</th><th>المبلغ</th><th>الحالة</th></tr></thead>
      <tbody>${claims
        .map(
          (c) => `<tr>
        <td class="small">${esc(fmtDate(c.at, true))}</td>
        <td>${esc(label[c.method] || c.method)}</td>
        <td class="num">${esc(money.format(c.amount_cents))}</td>
        <td>${badge(c.status)}</td>
      </tr>`
        )
        .join('')}</tbody>
    </table></div>
  </section>`;
}
