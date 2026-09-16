// لوحة الأدمن — كل الإعداد يتم هنا، فلا يُطلب من العميل أي خطوة.
import { esc, safeUrl, icon, layout, fmtDate, ago, plural, statusBadge, platformBadge, healthRing, gradeBadge, incidentLabel } from './layout.js';
import { money } from '../repo.js';

export function adminHome({ user, sites, stats, openIncidents, pendingResets, openTickets, flash }) {
  return layout({
    title: 'لوحة الأدمن',
    user,
    active: '/admin',
    flash,
    body: `<div class="stack">
  <h1>لوحة الأدمن</h1>

  ${pendingResets.length
    ? `<div class="alert alert-warn">${icon('alert')}<div>
        ${plural(pendingResets.length, 'طلب إعادة تعيين كلمة سر واحد', 'طلبان لإعادة تعيين كلمة السر', 'طلبات لإعادة تعيين كلمة السر', 'طلبًا لإعادة تعيين كلمة السر')} بانتظارك.
        <a href="/admin/requests">عرض الطلبات</a>
      </div></div>`
    : ''}

  <div class="stats">
    <div class="stat"><div class="stat-value">${stats.clients}</div><div class="stat-label">عميل</div></div>
    <div class="stat"><div class="stat-value">${stats.sites}</div><div class="stat-label">موقع مراقَب</div></div>
    <div class="stat"><div class="stat-value" style="color:${openIncidents.length ? 'var(--danger)' : 'var(--ok)'}">${openIncidents.length}</div><div class="stat-label">عطل مفتوح</div></div>
    <div class="stat"><div class="stat-value" style="color:var(--warn)">${esc(money.format(stats.outstandingCents))}</div><div class="stat-label">إجمالي المتأخرات</div></div>
  </div>

  ${openIncidents.length
    ? `<section class="card">
      <h2>${icon('alert')} أعطال مفتوحة الآن</h2>
      <div class="table-scroll"><table>
        <thead><tr><th>الموقع</th><th>العميل</th><th>النوع</th><th>التفصيل</th><th>منذ</th></tr></thead>
        <tbody>${openIncidents
          .map(
            (i) => `<tr>
          <td><a href="/admin/site/${i.site_id}">${esc(i.site_name)}</a></td>
          <td>${esc(i.client_name)}</td>
          <td><span class="badge badge-danger">${esc(incidentLabel(i.kind))}</span></td>
          <td class="small">${esc(i.detail || '—')}</td>
          <td>${esc(ago(i.started_at))}</td>
        </tr>`
          )
          .join('')}</tbody>
      </table></div>
    </section>`
    : `<div class="alert alert-ok">${icon('check')}<div>لا توجد أعطال مفتوحة — كل المواقع مستقرة.</div></div>`}

  <section class="card">
    <div class="row-between"><h2>كل المواقع</h2><a class="btn btn-sm" href="/admin/clients">${icon('globe')} إدارة العملاء</a></div>
    <div class="table-scroll"><table>
      <thead><tr><th>الموقع</th><th>العميل</th><th>الحالة</th><th>المنصة</th><th>الدرجة</th><th>آخر فحص</th><th></th></tr></thead>
      <tbody>${sites
        .map(
          (s) => `<tr>
        <td><a href="/admin/site/${s.id}">${esc(s.name)}</a><div class="faint ltr small">${esc(s.url)}</div></td>
        <td><a href="/admin/client/${s.user_id}">${esc(s.client_name)}</a></td>
        <td>${statusBadge(s)}</td>
        <td>${platformBadge(s)}</td>
        <td>${gradeBadge(s.health_score)}</td>
        <td class="small">${esc(s.last_check_at ? ago(s.last_check_at) : 'لم يُفحص')}</td>
        <td><form method="POST" action="/admin/site/${s.id}/check"><input type="hidden" name="_csrf" value="${esc(user.csrf)}"><button class="btn btn-sm" type="submit">افحص الآن</button></form></td>
      </tr>`
        )
        .join('')}</tbody>
    </table></div>
  </section>
</div>`,
  });
}

export function adminClients({ user, clients, flash }) {
  return layout({
    title: 'العملاء',
    user,
    active: '/admin/clients',
    flash,
    body: `<div class="stack">
  <h1>العملاء</h1>

  <section class="card">
    <h2>إضافة عميل</h2>
    <p class="faint">سيُولَّد رابط تفعيل لمرة واحدة — أرسله للعميل بالطريقة التي تناسبك (واتساب مثلًا).
      العميل يفتحه ويضع كلمة سره، ولا يُطلب منه شيء آخر أبدًا.</p>
    <form method="POST" action="/admin/clients" class="stack">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <div class="grid grid-2">
        <div class="field"><label for="name">اسم العميل</label><input id="name" name="name" required maxlength="120"></div>
        <div class="field"><label for="email">البريد الإلكتروني</label><input id="email" name="email" type="email" required dir="ltr"></div>
        <div class="field"><label for="company">الشركة (اختياري)</label><input id="company" name="company" maxlength="120"></div>
        <div class="field"><label for="phone">الهاتف (اختياري)</label><input id="phone" name="phone" maxlength="40" dir="ltr"></div>
        <div class="field"><label for="mvp_url">رابط منتج العميل / MVP (اختياري)</label><input id="mvp_url" name="mvp_url" type="url" dir="ltr" placeholder="https://"></div>
        <div class="field"><label for="mvp_label">اسم الزر</label><input id="mvp_label" name="mvp_label" maxlength="60" placeholder="المنتج"></div>
      </div>
      <button class="btn btn-primary" type="submit">إنشاء الحساب وتوليد رابط التفعيل</button>
    </form>
  </section>

  <div class="card card-flush"><div class="table-scroll"><table>
    <thead><tr><th>العميل</th><th>البريد</th><th>المواقع</th><th>المستحق</th><th>الحالة</th></tr></thead>
    <tbody>${clients
      .map(
        (c) => `<tr>
      <td><a href="/admin/client/${c.id}">${esc(c.name)}</a>${c.company ? `<div class="faint small">${esc(c.company)}</div>` : ''}</td>
      <td class="ltr small">${esc(c.email)}</td>
      <td class="num">${c.site_count}</td>
      <td class="num">${esc(money.format(c.outstanding_cents || 0))}</td>
      <td>${c.last_login_at
        ? `<span class="badge badge-ok">${icon('check')} نشط</span>`
        : `<span class="badge badge-warn">${icon('clock')} لم يدخل بعد</span>`}</td>
    </tr>`
      )
      .join('')}</tbody>
  </table></div></div>
</div>`,
  });
}

export function adminClient({ user, client, sites, invoices, link, state, flash }) {
  return layout({
    title: client.name,
    user,
    active: '/admin/clients',
    flash,
    body: `<div class="stack">
  <a class="btn btn-sm" href="/admin/clients">${icon('arrow')} كل العملاء</a>

  ${link
    ? `<div class="alert alert-ok">${icon('check')}<div>
      <b>رابط ${link.kind === 'activate' ? 'التفعيل' : 'إعادة التعيين'} جاهز</b> — صالح حتى ${esc(fmtDate(link.expires_at, true))}، ويعمل مرة واحدة فقط.
      <div class="mono small ltr" style="word-break:break-all;margin-block:var(--s-2)">${esc(link.url)}</div>
      <button class="btn btn-sm" type="button" data-copy="${esc(link.url)}">نسخ الرابط</button>
    </div></div>`
    : ''}

  <section class="card">
    <h1>${esc(client.name)}</h1>
    <p class="muted small ltr">${esc(client.email)}${client.phone ? ` · ${esc(client.phone)}` : ''}</p>
    ${state ? `<div class="row" style="margin-block-start:var(--s-3)">
      ${billingStateBadge(state)}
      ${state.dueCents > 0 ? `<span class="badge badge-warn">${icon('receipt')} مستحق ${esc(money.format(state.dueCents))}</span>` : ''}
      ${state.inTrial ? `<span class="badge badge-info">${icon('clock')} تجربة حتى ${esc(fmtDate(state.trialEndsAt))}</span>` : ''}
      ${state.state === 'grace' ? `<span class="badge badge-warn">${icon('alert')} باقٍ ${esc(state.graceLeft)} يوم قبل القفل</span>` : ''}
    </div>` : ''}
    <div class="row" style="margin-block-start:var(--s-4)">
      <a class="btn btn-sm" href="/admin/chat/${client.id}">${icon('chat')} محادثة</a>
      <form method="POST" action="/admin/client/${client.id}/exempt">
        <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
        <input type="hidden" name="exempt" value="${client.exempt ? '0' : '1'}">
        <button class="btn btn-sm" type="submit">${client.exempt ? 'إلغاء الإعفاء من القفل' : 'إعفاء من القفل'}</button>
      </form>
      <form method="POST" action="/admin/client/${client.id}/reset-link">
        <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
        <button class="btn btn-sm" type="submit">توليد رابط كلمة سر جديد</button>
      </form>
      ${client.mvp_url ? `<a class="btn btn-sm" href="${safeUrl(client.mvp_url)}" target="_blank" rel="noopener noreferrer">${icon('external')} ${esc(client.mvp_label || 'المنتج')}</a>` : ''}
    </div>
  </section>

  <section class="card">
    <h2>إضافة موقع لهذا العميل</h2>
    <form method="POST" action="/admin/client/${client.id}/sites" class="stack">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <div class="grid grid-2">
        <div class="field"><label for="sname">اسم الموقع</label><input id="sname" name="name" required maxlength="120"></div>
        <div class="field"><label for="surl">الرابط</label><input id="surl" name="url" type="url" required dir="ltr" placeholder="https://"></div>
      </div>
      <button class="btn btn-primary" type="submit">أضف وافحص فورًا</button>
    </form>
  </section>

  ${sites.length
    ? `<section class="card">
    <h2>مواقعه</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>الموقع</th><th>الحالة</th><th>المنصة</th><th>الدرجة</th><th></th></tr></thead>
      <tbody>${sites
        .map(
          (s) => `<tr>
        <td><a href="/admin/site/${s.id}">${esc(s.name)}</a><div class="faint ltr small">${esc(s.url)}</div></td>
        <td>${statusBadge(s)}</td><td>${platformBadge(s)}</td><td>${gradeBadge(s.health_score)}</td>
        <td><form method="POST" action="/admin/site/${s.id}/check"><input type="hidden" name="_csrf" value="${esc(user.csrf)}"><button class="btn btn-sm" type="submit">افحص</button></form></td>
      </tr>`
        )
        .join('')}</tbody>
    </table></div>
  </section>`
    : ''}

  <section class="card">
    <h2>إصدار فاتورة</h2>
    <form method="POST" action="/admin/client/${client.id}/invoices" class="stack">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <div class="grid grid-2">
        <div class="field"><label for="desc">الوصف</label><input id="desc" name="description" required maxlength="200" placeholder="اشتراك صيانة شهري"></div>
        <div class="field"><label for="amount">المبلغ</label><input id="amount" name="amount" type="number" step="0.01" min="0" required dir="ltr"></div>
        <div class="field"><label for="currency">العملة</label>
          <select id="currency" name="currency"><option value="EGP">جنيه مصري</option><option value="SAR">ريال سعودي</option><option value="AED">درهم إماراتي</option><option value="USD">دولار</option></select>
        </div>
        <div class="field"><label for="due">تاريخ الاستحقاق</label><input id="due" name="due_at" type="date"></div>
      </div>
      <button class="btn btn-primary" type="submit">إصدار الفاتورة</button>
    </form>
  </section>

  ${invoices.length
    ? `<div class="card card-flush"><div class="table-scroll"><table>
    <thead><tr><th>الفاتورة</th><th>الوصف</th><th>المبلغ</th><th>المدفوع</th><th>تسجيل دفعة</th></tr></thead>
    <tbody>${invoices
      .map(
        (i) => `<tr>
      <td class="mono">${esc(i.number)}</td>
      <td class="small">${esc(i.description || '—')}</td>
      <td class="num">${esc(money.format(i.amount_cents, i.currency))}</td>
      <td class="num">${esc(money.format(i.paid_cents || 0, i.currency))}</td>
      <td>
        <form method="POST" action="/admin/invoice/${i.id}/pay" class="row">
          <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
          <input name="amount" type="number" step="0.01" min="0.01" required dir="ltr" style="inline-size:110px" placeholder="المبلغ">
          <button class="btn btn-sm btn-primary" type="submit">سجّل</button>
        </form>
      </td>
    </tr>`
      )
      .join('')}</tbody>
  </table></div></div>`
    : ''}
</div>`,
  });
}

function billingStateBadge(st) {
  const map = {
    trial: ['badge-info', 'clock', 'تجربة مجانية'],
    ok: ['badge-ok', 'check', 'منتظم'],
    due: ['badge-info', 'receipt', 'عليه مستحقات'],
    grace: ['badge-warn', 'alert', 'في مهلة السداد'],
    restricted: ['badge-danger', 'x', 'مزاياه مقفولة'],
  };
  const [cls, ic, label] = map[st.state] || map.ok;
  return `<span class="badge ${cls}">${icon(ic)} ${esc(label)}</span>`;
}

export function adminSite({ user, site, client, check, maintenance, incidents, flash }) {
  return layout({
    title: `إدارة ${site.name}`,
    user,
    active: '/admin',
    flash,
    body: `<div class="stack">
  <a class="btn btn-sm" href="/admin/client/${site.user_id}">${icon('arrow')} ${esc(client.name)}</a>

  <section class="card">
    <div class="row" style="gap:var(--s-5);align-items:flex-start">
      ${healthRing(check?.health_score ?? null, 76)}
      <div class="grow">
        <h1>${esc(site.name)}</h1>
        <p class="site-url ltr small"><a href="${safeUrl(site.url)}" target="_blank" rel="noopener noreferrer">${esc(site.url)}</a></p>
        <div class="row">${statusBadge({ last_ok: check?.ok })} ${platformBadge(site)}</div>
      </div>
      <form method="POST" action="/admin/site/${site.id}/check">
        <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
        <button class="btn btn-primary" type="submit">افحص الآن</button>
      </form>
    </div>
  </section>

  <section class="card">
    <h2>${icon('wrench')} تسجيل صيانة</h2>
    <p class="faint">ما تسجّله هنا يراه العميل في لوحته — وهو ما يجعله يرى قيمة اشتراكه.</p>
    <form method="POST" action="/admin/site/${site.id}/maintenance" class="stack">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <div class="grid grid-2">
        <div class="field"><label for="mtitle">ما الذي تم؟</label><input id="mtitle" name="title" required maxlength="200" placeholder="تحديث الإضافات وفحص الأمان"></div>
        <div class="field"><label for="mtype">النوع</label>
          <select id="mtype" name="type">
            <option value="update">تحديثات</option><option value="backup">نسخة احتياطية</option>
            <option value="security">أمان</option><option value="fix">إصلاح عطل</option>
            <option value="content">محتوى</option><option value="audit">مراجعة</option>
          </select>
        </div>
      </div>
      <div class="field"><label for="mnotes">تفاصيل (اختياري)</label><textarea id="mnotes" name="notes" maxlength="2000"></textarea></div>
      <div class="grid grid-2">
        <div class="field"><label for="mby">مَن نفّذها</label><input id="mby" name="performed_by" maxlength="80" value="${esc(user.name)}"></div>
        <div class="field"><label for="mnext">الموعد القادم (اختياري)</label><input id="mnext" name="next_due_at" type="date"></div>
      </div>
      <button class="btn btn-primary" type="submit">تسجيل</button>
    </form>
  </section>

  <div class="grid grid-2">
    <section class="card">
      <h2>سجل الصيانة</h2>
      ${maintenance.length
        ? maintenance
            .map(
              (m) => `<div class="finding"><span class="muted">${icon('wrench', 'finding-icon')}</span>
        <div><div class="finding-problem">${esc(m.title)}</div>
        <div class="finding-fix">${esc(fmtDate(m.at))}${m.performed_by ? ` — ${esc(m.performed_by)}` : ''}</div></div></div>`
            )
            .join('')
        : '<p class="muted small">لا صيانة مسجلة.</p>'}
    </section>
    <section class="card">
      <h2>الأعطال</h2>
      ${incidents.length
        ? incidents
            .map(
              (i) => `<div class="finding"><span style="color:${i.resolved ? 'var(--ok)' : 'var(--danger)'}">${icon(i.resolved ? 'check' : 'alert', 'finding-icon')}</span>
        <div><div class="finding-problem">${esc(i.detail || incidentLabel(i.kind))}</div>
        <div class="finding-fix">${esc(fmtDate(i.started_at, true))}${i.ended_at ? ` — ${esc(fmtDate(i.ended_at, true))}` : ' — مفتوح'}</div></div></div>`
            )
            .join('')
        : '<p class="muted small">لا أعطال.</p>'}
    </section>
  </div>
</div>`,
  });
}

export function adminRequests({ user, requests, flash }) {
  return layout({
    title: 'طلبات إعادة التعيين',
    user,
    active: '/admin/requests',
    flash,
    body: `<div class="stack">
  <h1>طلبات إعادة تعيين كلمة السر</h1>
  <p class="muted">لا يتم أي شيء تلقائيًا. أنت من يولّد الرابط ويرسله للعميل — وهذا ما يمنع
    استغلال الخاصية لإقفال حسابات الآخرين.</p>

  ${requests.length
    ? `<div class="card card-flush"><div class="table-scroll"><table>
    <thead><tr><th>العميل</th><th>البريد</th><th>وقت الطلب</th><th>الحالة</th><th></th></tr></thead>
    <tbody>${requests
      .map(
        (r) => `<tr>
      <td><a href="/admin/client/${r.user_id}">${esc(r.name)}</a></td>
      <td class="ltr small">${esc(r.email)}</td>
      <td class="small">${esc(ago(r.requested_at))}</td>
      <td>${r.status === 'pending'
        ? `<span class="badge badge-warn">${icon('clock')} بانتظارك</span>`
        : `<span class="badge badge-ok">${icon('check')} صدر الرابط</span>`}</td>
      <td>${r.status === 'pending'
        ? `<form method="POST" action="/admin/client/${r.user_id}/reset-link">
             <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
             <input type="hidden" name="request_id" value="${r.id}">
             <button class="btn btn-sm btn-primary" type="submit">ولّد الرابط</button>
           </form>`
        : ''}</td>
    </tr>`
      )
      .join('')}</tbody>
  </table></div></div>`
    : `<div class="card empty">${icon('inbox')}<p>لا توجد طلبات.</p></div>`}
</div>`,
  });
}

// ——————————————————— المدفوعات ———————————————————

export function adminPayments({ user, claims, cfg, flash }) {
  const method = { instapay: 'إنستا باي', vodafone: 'فودافون كاش', other: 'أخرى' };
  return layout({
    title: 'المدفوعات',
    user,
    active: '/admin/payments',
    flash,
    body: `<div class="stack">
  <div class="row-between">
    <h1>إشعارات التحويل</h1>
    <a class="btn btn-sm" href="/admin/settings">${icon('shield')} إعدادات الدفع</a>
  </div>

  <div class="alert alert-info">${icon('alert')}<div>
    إنستا باي وفودافون كاش لا يبلّغان النظام تلقائيًا. العميل يبلّغ بالتحويل من لوحته،
    وأنت تطابقه مع حسابك ثم تؤكده هنا — والتأكيد يسجّل الدفعة ويفك القفل فورًا.
  </div></div>

  ${claims.length
    ? `<div class="card card-flush"><div class="table-scroll"><table>
    <thead><tr><th>العميل</th><th>الفاتورة</th><th>الطريقة</th><th>المبلغ</th><th>الإيصال</th><th>محوَّل من</th><th>الوقت</th><th></th></tr></thead>
    <tbody>${claims
      .map(
        (c) => `<tr>
      <td><a href="/admin/chat/${c.user_id}">${esc(c.client_name)}</a></td>
      <td class="mono small">${esc(c.invoice_number || '—')}</td>
      <td>${esc(method[c.method] || c.method)}</td>
      <td class="num">${esc(money.format(c.amount_cents))}</td>
      <!-- الإيصال هو ما يُراجَع فعلًا: صورة التحويل تُغني عن مطابقة رقم برقم.
           يُفتح في تبويب جديد لئلّا تضيع الصفوف التي لم تُراجَع بعد. -->
      <td>${c.receipt_name
        ? `<a class="btn btn-sm" href="/receipt/${esc(c.receipt_name)}" target="_blank" rel="noopener">${icon('receipt')} افتح</a>`
        : '<span class="faint small">بلا إيصال</span>'}</td>
      <td class="ltr small mono">${esc(c.sender_ref || '—')}</td>
      <td class="small">${esc(ago(c.at))}</td>
      <td>
        <div class="row">
          <form method="POST" action="/admin/claim/${c.id}/confirm"
                data-confirm="تأكيد استلام ${money.format(c.amount_cents)} من ${c.client_name}؟">
            <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
            <button class="btn btn-sm btn-primary" type="submit">${icon('check')} أكّد</button>
          </form>
          <form method="POST" action="/admin/claim/${c.id}/reject" class="row">
            <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
            <input name="reason" placeholder="السبب" maxlength="200" style="inline-size:130px">
            <button class="btn btn-sm" type="submit">رفض</button>
          </form>
        </div>
      </td>
    </tr>`
      )
      .join('')}</tbody>
  </table></div></div>`
    : `<div class="card empty">${icon('receipt')}<p>لا إشعارات تحويل بانتظار المراجعة.</p></div>`}

  <section class="card">
    <h2>أرقام التحصيل الحالية</h2>
    <div class="pay-grid">
      <div class="pay-method">
        <div class="pay-method-head">
          <span class="pay-logo pay-instapay" aria-hidden="true">IP</span>
          <div><div class="pay-name">إنستا باي</div><div class="faint mono ltr">${esc(cfg.instapay)}</div></div>
        </div>
      </div>
      <div class="pay-method">
        <div class="pay-method-head">
          <span class="pay-logo pay-vodafone" aria-hidden="true">VF</span>
          <div><div class="pay-name">فودافون كاش</div><div class="faint mono ltr">${esc(cfg.vodafone)}</div></div>
        </div>
      </div>
    </div>
    <p class="faint" style="margin-block-start:var(--s-3)">
      فترة الدعم المجاني: ${esc(cfg.trialMonths)} شهور · مهلة السداد: ${esc(cfg.graceDays)} أيام
    </p>
  </section>
</div>`,
  });
}

// ——————————————————— الإعدادات ———————————————————

export function adminSettings({ user, cfg, flash }) {
  return layout({
    title: 'إعدادات الدفع',
    user,
    active: '/admin/payments',
    flash,
    body: `<div class="stack">
  <a class="btn btn-sm" href="/admin/payments">${icon('arrow')} المدفوعات</a>
  <h1>إعدادات الدفع والاشتراك</h1>

  <section class="card">
    <form method="POST" action="/admin/settings" class="stack">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <div class="grid grid-2">
        <div class="field">
          <label for="ip">رقم إنستا باي</label>
          <input id="ip" name="pay_instapay" dir="ltr" value="${esc(cfg.instapay)}" maxlength="40">
        </div>
        <div class="field">
          <label for="vf">رقم فودافون كاش</label>
          <input id="vf" name="pay_vodafone" dir="ltr" value="${esc(cfg.vodafone)}" maxlength="40">
        </div>
        <div class="field">
          <label for="wa">رقم واتساب (بمفتاح الدولة)</label>
          <input id="wa" name="pay_whatsapp" dir="ltr" value="${esc(cfg.whatsapp)}" maxlength="40" placeholder="201099576398">
          <div class="hint">بدون علامة + — مثال: 201099576398</div>
        </div>
        <div class="field">
          <label for="holder">اسم المستلم</label>
          <input id="holder" name="pay_holder" value="${esc(cfg.holder)}" maxlength="80">
        </div>
        <div class="field">
          <label for="holder_latin">اسم المستلم بالحروف اللاتينية</label>
          <input id="holder_latin" name="pay_holder_latin" value="${esc(cfg.holderLatin || '')}" maxlength="80" dir="ltr">
          <div class="hint">بعض تطبيقات التحويل تعرض الاسم لاتينيًّا وحده.</div>
        </div>
        <div class="field">
          <label for="tm">فترة الدعم المجاني (شهور)</label>
          <input id="tm" name="trial_months" type="number" min="0" max="36" dir="ltr" value="${esc(cfg.trialMonths)}">
          <div class="hint">تُطبَّق على العملاء الجدد فقط.</div>
        </div>
        <div class="field">
          <label for="gd">مهلة السداد قبل القفل (أيام)</label>
          <input id="gd" name="grace_days" type="number" min="0" max="60" dir="ltr" value="${esc(cfg.graceDays)}">
        </div>
      </div>
      <button class="btn btn-primary" type="submit">حفظ</button>
    </form>
  </section>

  <div class="alert alert-warn">${icon('alert')}<div>
    تغيير مهلة السداد يسري فورًا على كل العملاء — بمن فيهم من هم داخل المهلة الآن.
    خفضها قد يقفل حسابات في اللحظة نفسها.
  </div></div>
</div>`,
  });
}
