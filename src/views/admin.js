// لوحة الأدمن — كل الإعداد يتم هنا، فلا يُطلب من العميل أي خطوة.
import { esc, safeUrl, icon, layout, fmtDate, ago, plural, statusBadge, platformBadge, healthRing, gradeBadge } from './layout.js';
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
          <td><span class="badge badge-danger">${esc(i.kind)}</span></td>
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

export function adminClient({ user, client, sites, invoices, link, flash }) {
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
    <div class="row" style="margin-block-start:var(--s-4)">
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
        <div><div class="finding-problem">${esc(i.detail || i.kind)}</div>
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
