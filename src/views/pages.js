// صفحات العميل — الواجهة تحكي حالة الموقع بجُمل، لا تعرض نسبًا مجردة.
import {
  esc, safeUrl, icon, layout, fmtDate, ago, plural,
  statusBadge, gradeBadge, platformBadge, healthRing, uptimeBar, sparkline, gradeOf, bidi,
} from './layout.js';
import { money } from '../repo.js';

// ——————————————————— السرد ———————————————————

/**
 * الجملة التي تحكي حالة الموقع.
 * العميل غير التقني يفهم «شغّال من 47 يوم» ولا يفهم «Uptime 99.97%».
 */
export function narrative({ site, streak, uptime, lastMaintenance, tlsDays }) {
  const bits = [];

  if (site.last_ok == null) {
    bits.push('لم نبدأ فحص هذا الموقع بعد — أول تقرير خلال دقائق.');
  } else if (!site.last_ok) {
    bits.push('<b>الموقع لا يفتح حاليًا</b> وفريقنا يتابع المشكلة.');
  } else if (streak?.days >= 1) {
    bits.push(`موقعك شغّال من <b>${plural(streak.days, 'يوم', 'يومين', 'أيام', 'يوم')}</b> بدون انقطاع.`);
  } else if (streak) {
    bits.push(`موقعك شغّال من <b>${plural(streak.hours, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}</b>.`);
  }

  if (lastMaintenance) bits.push(`آخر صيانة ${ago(lastMaintenance)}.`);
  else bits.push('لم تُسجَّل صيانة بعد.');

  if (tlsDays != null) {
    if (tlsDays <= 0) bits.push('<b>شهادة الأمان منتهية</b> — التجديد عاجل.');
    else if (tlsDays <= 21) bits.push(`شهادة الأمان تنتهي بعد <b>${plural(tlsDays, 'يوم', 'يومين', 'أيام', 'يوم')}</b> وسنجددها قبلها.`);
    else bits.push(`شهادة الأمان سارية <b>${plural(tlsDays, 'يوم', 'يومين', 'أيام', 'يوم')}</b> أخرى.`);
  }

  if (uptime?.hasGaps) {
    bits.push(`<span class="muted">(لم نكن نراقب لمدة ${uptime.gapMinutes} دقيقة في هذه الفترة، ولم نحسبها وقت تشغيل.)</span>`);
  }

  return `<p class="narrative">${bits.join(' ')}</p>`;
}

// ——————————————————— لوحة العميل ———————————————————

export function dashboardPage({ user, data, flash, billingBanner: banner = '' }) {
  const { sites, counts, outstanding: due, mvp, openTickets } = data;

  // بطاقة المنتج (MVP) — أبرز عنصر، وتختفي تلقائيًا لمن لا منتج له
  const mvpCard = mvp
    ? `<section class="card mvp rise" aria-labelledby="mvp-h">
        <div>
          <h2 id="mvp-h">${esc(mvp.label)}</h2>
          <p class="mvp-meta" style="margin:0">المنتج الخاص بك — جاهز للفتح في أي وقت</p>
        </div>
        <a class="btn btn-light" href="${safeUrl(mvp.url)}" target="_blank" rel="noopener noreferrer">
          ${icon('external')} افتح المنتج
        </a>
      </section>`
    : '';

  const dueBanner =
    due.cents > 0
      ? `<div class="alert alert-${due.overdueCount ? 'warn' : 'info'}" role="status">
          ${icon('receipt')}
          <div>
            عليك <b>${esc(money.format(due.cents))}</b> على ${plural(due.invoices, 'فاتورة واحدة', 'فاتورتين', 'فواتير', 'فاتورة')}.
            ${due.overdueCount ? `منها ${plural(due.overdueCount, 'واحدة تجاوزت موعدها', 'اثنتان تجاوزتا موعدهما', 'تجاوزت موعدها', 'تجاوزت موعدها')}.` : ''}
            <a href="/invoices">عرض الفواتير</a>
          </div>
        </div>`
      : '';

  // لو كل المواقع قيد الفحص، عرض أربعة أصفار يبدو خللًا — نعرض الفئة الرابعة
  // «قيد الفحص» بدل «تحتاج انتباه» حتى لا تختفي المواقع من العدّ.
  const showPending = counts.unknown > 0;
  const stats = `<div class="stats rise">
    <div class="stat"><div class="stat-value">${sites.length}</div><div class="stat-label">${sites.length === 1 ? 'موقع' : 'مواقع'}</div></div>
    <div class="stat"><div class="stat-value" style="color:var(--ok)">${counts.excellent + counts.good}</div><div class="stat-label">بحالة جيدة</div></div>
    ${showPending
      ? `<div class="stat"><div class="stat-value" style="color:var(--text-faint)">${counts.unknown}</div><div class="stat-label">قيد الفحص</div></div>`
      : `<div class="stat"><div class="stat-value" style="color:var(--warn)">${counts.attention}</div><div class="stat-label">تحتاج انتباه</div></div>`}
    <div class="stat"><div class="stat-value" style="color:var(--danger)">${counts.problems + counts.critical}</div><div class="stat-label">فيها مشاكل</div></div>
  </div>`;

  const cards = sites.length
    ? `<div class="grid grid-2">${sites
        .map(
          (s) => `<a class="card site-card rise" href="/site/${s.id}">
      ${healthRing(s.health_score)}
      <div class="grow">
        <div class="site-name">${esc(s.name)}</div>
        <div class="site-url ltr">${esc(s.url)}</div>
        <div class="row" style="margin-block-start:var(--s-3)">
          ${statusBadge(s)} ${platformBadge(s)}
          ${s.open_incidents ? `<span class="badge badge-danger">${icon('alert')} ${plural(s.open_incidents, 'عطل مفتوح', 'عطلان مفتوحان', 'أعطال مفتوحة', 'عطل مفتوح')}</span>` : ''}
        </div>
        <p class="faint" style="margin-block:var(--s-3) 0">
          ${s.last_maintenance_at ? `آخر صيانة ${esc(ago(s.last_maintenance_at))}` : 'لم تُسجَّل صيانة بعد'}
          ${s.last_check_at ? ` · آخر فحص ${esc(ago(s.last_check_at))}` : ''}
        </p>
      </div>
    </a>`
        )
        .join('')}</div>`
    : `<div class="card empty">${icon('globe', '')}<p>لم يُضَف أي موقع لحسابك بعد.</p>
       <p class="small">فريقنا هو من يضيف المواقع — لا تحتاج لعمل أي شيء.</p></div>`;

  return layout({
    title: 'مواقعي',
    user,
    active: '/',
    flash,
    body: `<div class="stack">
  <div class="row-between">
    <div>
      <h1>أهلًا ${esc((user.name || '').split(' ')[0])}</h1>
      <p class="muted small" style="margin:0">هذه حالة مواقعك الآن</p>
    </div>
    ${openTickets ? `<a class="btn btn-sm" href="/tickets">${icon('chat')} ${plural(openTickets, 'تذكرة مفتوحة', 'تذكرتان مفتوحتان', 'تذاكر مفتوحة', 'تذكرة مفتوحة')}</a>` : ''}
  </div>
  ${mvpCard}
  ${banner || dueBanner}
  ${stats}
  ${cards}
</div>`,
  });
}

// ——————————————————— تفاصيل الموقع ———————————————————

export function sitePage({ user, site, check, checks, incidents, maintenance, uptime, streak, detail, flash }) {
  const findings = detail?.findings || [];
  const tlsDays = check?.ssl_days_left ?? null;

  const findingIcon = (level) =>
    level === 'critical' ? icon('x', 'finding-icon') : level === 'warn' ? icon('alert', 'finding-icon') : icon('shield', 'finding-icon');
  const findingColor = (level) =>
    level === 'critical' ? 'var(--danger)' : level === 'warn' ? 'var(--warn)' : 'var(--text-faint)';

  return layout({
    title: site.name,
    user,
    active: '/',
    flash,
    body: `<div class="stack">
  <a class="btn btn-sm" href="/">${icon('arrow')} كل المواقع</a>

  <section class="card">
    <div class="row" style="align-items:flex-start;gap:var(--s-5)">
      ${healthRing(check?.health_score ?? null, 84)}
      <div class="grow">
        <h1>${esc(site.name)}</h1>
        <p class="site-url ltr" style="margin-block:2px var(--s-3)">
          <a href="${safeUrl(site.url)}" target="_blank" rel="noopener noreferrer">${esc(site.url)} ${icon('external')}</a>
        </p>
        <div class="row">
          ${statusBadge({ last_ok: check ? check.ok : null })}
          ${check ? gradeBadge(check.health_score) : ''}
          ${platformBadge(site)}
        </div>
      </div>
    </div>
    <div style="margin-block-start:var(--s-5)">
      ${narrative({ site: { last_ok: check?.ok }, streak, uptime, lastMaintenance: maintenance[0]?.at, tlsDays })}
    </div>
  </section>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${uptime.percent == null ? '—' : uptime.percent + '%'}</div>
      <div class="stat-label">تشغيل آخر ${uptime.days} يوم</div>
    </div>
    <div class="stat">
      <div class="stat-value">${check?.response_ms ?? '—'}<span class="faint" style="font-size:var(--t-sm)">ms</span></div>
      <div class="stat-label">زمن الاستجابة</div>
    </div>
    <div class="stat">
      <div class="stat-value">${tlsDays == null ? '—' : tlsDays}</div>
      <div class="stat-label">يوم لانتهاء الشهادة</div>
    </div>
    <div class="stat">
      <div class="stat-value">${check?.sec_score ?? '—'}</div>
      <div class="stat-label">درجة هيدرات الأمان</div>
    </div>
  </div>

  <section class="card">
    <h2>سجل التشغيل</h2>
    ${checks.length
      ? `<p class="faint">كل عمود فحص. آخر ${checks.length} فحص.</p>${uptimeBar(checks)}`
      : `<p class="muted small">لم تُسجَّل فحوصات بعد — يبدأ السجل مع أول فحص.</p>`}
    <div style="margin-block-start:var(--s-5)">
      <h2>زمن الاستجابة</h2>
      <p class="faint">مقيس من سيرفر المراقبة لدينا — قد يختلف عن تجربة زائر في بلد آخر.</p>
      ${sparkline(checks)}
    </div>
  </section>

  ${findings.length
    ? `<section class="card">
        <h2>ما وجدناه في آخر فحص</h2>
        <p class="faint">كل ملاحظة ومعها الحل المقترح.</p>
        <div>${findings
          .map(
            (f) => `<div class="finding">
          <span style="color:${findingColor(f.level)}">${findingIcon(f.level)}</span>
          <div>
            <div class="finding-problem">${bidi(f.problem)}</div>
            <div class="finding-fix">${bidi(f.fix)}</div>
          </div>
        </div>`
          )
          .join('')}</div>
      </section>`
    : ''}

  <div class="grid grid-2">
    <section class="card">
      <h2>${icon('wrench')} سجل الصيانة</h2>
      ${maintenance.length
        ? `<div>${maintenance
            .map(
              (m) => `<div class="finding">
          <span class="muted">${icon('wrench', 'finding-icon')}</span>
          <div class="grow">
            <div class="finding-problem">${esc(m.title)}</div>
            <div class="finding-fix">${esc(fmtDate(m.at))}${m.performed_by ? ` — ${esc(m.performed_by)}` : ''}</div>
            ${m.notes ? `<div class="finding-fix">${esc(m.notes)}</div>` : ''}
          </div>
        </div>`
            )
            .join('')}</div>`
        : `<p class="muted small">لم تُسجَّل صيانة على هذا الموقع بعد.</p>`}
    </section>

    <section class="card">
      <h2>${icon('alert')} سجل الأعطال</h2>
      ${incidents.length
        ? `<div>${incidents
            .map(
              (i) => `<div class="finding">
          <span style="color:${i.resolved ? 'var(--ok)' : 'var(--danger)'}">${icon(i.resolved ? 'check' : 'alert', 'finding-icon')}</span>
          <div class="grow">
            <div class="finding-problem">${esc(i.detail || i.kind)}</div>
            <div class="finding-fix">
              بدأ ${esc(fmtDate(i.started_at, true))}
              ${i.ended_at ? ` — انتهى ${esc(fmtDate(i.ended_at, true))}` : ' — <b>ما زال مفتوحًا</b>'}
            </div>
          </div>
        </div>`
            )
            .join('')}</div>`
        : `<p class="muted small">لم يُسجَّل أي عطل — الموقع مستقر.</p>`}
    </section>
  </div>

  ${uptime.hasGaps
    ? `<div class="alert alert-info">${icon('clock')}<div>
        <b>شفافية:</b> توقفت مراقبتنا ${uptime.gapMinutes} دقيقة خلال هذه الفترة
        (${plural(uptime.gaps.length, 'انقطاع واحد', 'انقطاعان', 'انقطاعات', 'انقطاعًا')}).
        لم نحسب هذه المدة وقت تشغيل، ولا ندّعي معرفة ما حدث فيها.
      </div></div>`
    : ''}
</div>`,
  });
}

// ——————————————————— الفواتير ———————————————————

export function invoicesPage({ user, invoices, due, flash }) {
  const statusBadgeFor = (inv) => {
    const paid = inv.paid_cents || 0;
    if (inv.status === 'paid' || paid >= inv.amount_cents) return `<span class="badge badge-ok">${icon('check')} مدفوعة</span>`;
    if (inv.status === 'void') return `<span class="badge">ملغاة</span>`;
    const overdue = inv.due_at && inv.due_at < new Date().toISOString().slice(0, 10);
    if (paid > 0) return `<span class="badge badge-info">${icon('clock')} مدفوعة جزئيًا</span>`;
    return overdue
      ? `<span class="badge badge-warn">${icon('alert')} تجاوزت الموعد</span>`
      : `<span class="badge">${icon('clock')} غير مدفوعة</span>`;
  };

  return layout({
    title: 'الفواتير',
    user,
    active: '/invoices',
    flash,
    body: `<div class="stack">
  <h1>الفواتير</h1>
  ${due.cents > 0
    ? `<div class="alert alert-${due.overdueCount ? 'warn' : 'info'}">${icon('receipt')}<div>
        الإجمالي المستحق: <b>${esc(money.format(due.cents))}</b>
      </div></div>`
    : `<div class="alert alert-ok">${icon('check')}<div>لا توجد مستحقات — كل الفواتير مسدَّدة. شكرًا لك.</div></div>`}

  ${invoices.length
    ? `<div class="card card-flush"><div class="table-scroll"><table>
    <thead><tr><th>الفاتورة</th><th>الوصف</th><th>المبلغ</th><th>المدفوع</th><th>الاستحقاق</th><th>الحالة</th></tr></thead>
    <tbody>${invoices
      .map(
        (i) => `<tr>
      <td><a href="/invoice/${i.id}" class="mono">${esc(i.number)}</a></td>
      <td>${esc(i.description || '—')}</td>
      <td class="num">${esc(money.format(i.amount_cents, i.currency))}</td>
      <td class="num">${esc(money.format(i.paid_cents || 0, i.currency))}</td>
      <td>${esc(i.due_at ? fmtDate(i.due_at) : '—')}</td>
      <td>${statusBadgeFor(i)}</td>
    </tr>`
      )
      .join('')}</tbody></table></div></div>`
    : `<div class="card empty">${icon('receipt')}<p>لا توجد فواتير على حسابك.</p></div>`}
</div>`,
  });
}

export function invoicePage({ user, invoice, flash }) {
  return layout({
    title: `فاتورة ${invoice.number}`,
    user,
    active: '/invoices',
    flash,
    body: `<div class="stack">
  <a class="btn btn-sm no-print" href="/invoices">${icon('arrow')} كل الفواتير</a>
  <section class="card">
    <div class="row-between">
      <div>
        <h1>فاتورة <span class="mono">${esc(invoice.number)}</span></h1>
        <p class="muted small" style="margin:0">صدرت ${esc(fmtDate(invoice.issued_at))}</p>
      </div>
      <button class="btn btn-sm no-print" type="button" onclick="window.print()">طباعة</button>
    </div>
    <div class="stats" style="margin-block-start:var(--s-5)">
      <div class="stat"><div class="stat-value">${esc(money.format(invoice.amount_cents, invoice.currency))}</div><div class="stat-label">إجمالي الفاتورة</div></div>
      <div class="stat"><div class="stat-value" style="color:var(--ok)">${esc(money.format(invoice.paid_cents, invoice.currency))}</div><div class="stat-label">المدفوع</div></div>
      <div class="stat"><div class="stat-value" style="color:${invoice.due_cents ? 'var(--warn)' : 'var(--ok)'}">${esc(money.format(invoice.due_cents, invoice.currency))}</div><div class="stat-label">المتبقي</div></div>
      <div class="stat"><div class="stat-value" style="font-size:var(--t-md)">${esc(invoice.due_at ? fmtDate(invoice.due_at) : '—')}</div><div class="stat-label">تاريخ الاستحقاق</div></div>
    </div>
    ${invoice.description ? `<p style="margin-block-start:var(--s-5)">${esc(invoice.description)}</p>` : ''}
  </section>

  ${invoice.payments.length
    ? `<section class="card">
      <h2>الدفعات</h2>
      <div class="table-scroll"><table>
        <thead><tr><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>ملاحظة</th></tr></thead>
        <tbody>${invoice.payments
          .map(
            (p) => `<tr><td>${esc(fmtDate(p.at))}</td><td class="num">${esc(money.format(p.amount_cents, invoice.currency))}</td><td>${esc(p.method || '—')}</td><td>${esc(p.note || '—')}</td></tr>`
          )
          .join('')}</tbody>
      </table></div>
    </section>`
    : ''}
</div>`,
  });
}

// ——————————————————— التذاكر ———————————————————

export function ticketsPage({ user, tickets, sites, flash, csrf }) {
  const statusOf = (t) =>
    t.status === 'closed'
      ? `<span class="badge">${icon('check')} مغلقة</span>`
      : t.status === 'answered'
        ? `<span class="badge badge-ok">${icon('chat')} تم الرد</span>`
        : `<span class="badge badge-info">${icon('clock')} مفتوحة</span>`;

  return layout({
    title: 'الدعم',
    user,
    active: '/tickets',
    flash,
    body: `<div class="stack">
  <h1>الدعم الفني</h1>

  <section class="card">
    <h2>افتح طلبًا جديدًا</h2>
    <form method="POST" action="/tickets" class="stack">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <div class="field">
        <label for="subject">الموضوع</label>
        <input id="subject" name="subject" type="text" required maxlength="200" placeholder="مثال: الصفحة الرئيسية بطيئة">
      </div>
      ${sites.length
        ? `<div class="field">
        <label for="siteId">الموقع (اختياري)</label>
        <select id="siteId" name="siteId">
          <option value="">— غير محدد —</option>
          ${sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
        </select>
      </div>`
        : ''}
      <div class="field">
        <label for="body">التفاصيل</label>
        <textarea id="body" name="body" required maxlength="5000" placeholder="اشرح المشكلة بالتفصيل"></textarea>
      </div>
      <button class="btn btn-primary" type="submit">${icon('chat')} إرسال</button>
    </form>
  </section>

  ${tickets.length
    ? `<div class="card card-flush"><div class="table-scroll"><table>
      <thead><tr><th>الموضوع</th><th>الحالة</th><th>الرسائل</th><th>آخر تحديث</th></tr></thead>
      <tbody>${tickets
        .map(
          (t) => `<tr>
        <td><a href="/ticket/${t.id}">${esc(t.subject)}</a></td>
        <td>${statusOf(t)}</td>
        <td class="num">${t.messages}</td>
        <td>${esc(ago(t.updated_at))}</td>
      </tr>`
        )
        .join('')}</tbody>
    </table></div></div>`
    : `<div class="card empty">${icon('chat')}<p>لا توجد طلبات دعم.</p></div>`}
</div>`,
  });
}

export function ticketPage({ user, ticket, flash, csrf }) {
  return layout({
    title: ticket.subject,
    user,
    active: '/tickets',
    flash,
    body: `<div class="stack">
  <a class="btn btn-sm" href="/tickets">${icon('arrow')} كل الطلبات</a>
  <section class="card">
    <h1>${esc(ticket.subject)}</h1>
    <p class="muted small">فُتح ${esc(fmtDate(ticket.created_at, true))}</p>
  </section>

  <section class="card stack">
    ${ticket.messages
      .map(
        (m) => `<div class="finding" style="border-block-start:1px solid var(--border)">
      <span style="color:${m.author_role === 'client' ? 'var(--brand)' : 'var(--info)'}">${icon('chat', 'finding-icon')}</span>
      <div class="grow">
        <div class="finding-problem">${m.author_role === 'client' ? 'أنت' : 'فريق الدعم'}</div>
        <div style="white-space:pre-wrap;margin-block-start:var(--s-2)">${esc(m.body)}</div>
        <div class="faint" style="margin-block-start:var(--s-2)">${esc(fmtDate(m.created_at, true))}</div>
      </div>
    </div>`
      )
      .join('')}
  </section>

  ${ticket.status !== 'closed'
    ? `<section class="card">
    <form method="POST" action="/ticket/${ticket.id}/reply" class="stack">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <div class="field">
        <label for="body">ردّك</label>
        <textarea id="body" name="body" required maxlength="5000"></textarea>
      </div>
      <button class="btn btn-primary" type="submit">إرسال الرد</button>
    </form>
  </section>`
    : `<div class="alert alert-info">${icon('check')}<div>هذا الطلب مغلق. افتح طلبًا جديدًا إذا احتجت.</div></div>`}
</div>`,
  });
}

// ——————————————————— صفحات عامة ———————————————————

export function errorPage({ user = null, status = 404, message = 'الصفحة غير موجودة' }) {
  return layout({
    title: `خطأ ${status}`,
    user,
    body: `<div class="card empty">
      ${icon('alert')}
      <h1>${status}</h1>
      <p>${esc(message)}</p>
      <a class="btn" href="/">${icon('arrow')} العودة للرئيسية</a>
    </div>`,
  });
}
