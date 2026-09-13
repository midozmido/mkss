// واجهات الطبقة الاحترافية: الردود المحفوظة والبحث في المحادثات.
import { esc, icon, layout, fmtDate, ago } from './layout.js';

export function adminReplies({ user, replies, flash }) {
  return layout({
    title: 'الردود المحفوظة',
    user,
    active: '/admin/chat',
    flash,
    body: `<div class="stack">
  <a class="btn btn-sm" href="/admin/chat">${icon('arrow')} المحادثات</a>
  <h1>الردود المحفوظة</h1>
  <p class="muted">أغلب ردود الدعم متكررة. احفظها مرة، واستخدمها بضغطة من داخل المحادثة.</p>

  <section class="card">
    <h2>رد جديد</h2>
    <form method="POST" action="/admin/replies" class="stack">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <div class="grid grid-2">
        <div class="field">
          <label for="rtitle">العنوان</label>
          <input id="rtitle" name="title" required maxlength="120" placeholder="مثال: طلب صلاحية دخول">
        </div>
        <div class="field">
          <label for="rshort">اختصار (اختياري)</label>
          <input id="rshort" name="shortcut" maxlength="30" dir="ltr" placeholder="/access">
        </div>
      </div>
      <div class="field">
        <label for="rbody">النص</label>
        <textarea id="rbody" name="body" required rows="5" maxlength="4000"></textarea>
      </div>
      <button class="btn btn-primary" type="submit">حفظ</button>
    </form>
  </section>

  ${replies.length
    ? `<div class="card card-flush"><div class="table-scroll"><table>
    <thead><tr><th>العنوان</th><th>النص</th><th>الاستخدام</th><th></th></tr></thead>
    <tbody>${replies
      .map(
        (r) => `<tr>
      <td><b>${esc(r.title)}</b>${r.shortcut ? `<div class="faint mono ltr small">${esc(r.shortcut)}</div>` : ''}</td>
      <td class="small">${esc(String(r.body).replace(/\n/g, ' ').slice(0, 90))}…</td>
      <td class="num">${r.uses}</td>
      <td>
        <form method="POST" action="/admin/replies/${r.id}/delete" data-confirm="حذف «${esc(r.title)}»؟">
          <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
          <button class="btn btn-sm" type="submit">حذف</button>
        </form>
      </td>
    </tr>`
      )
      .join('')}</tbody>
  </table></div></div>`
    : `<div class="card empty">${icon('inbox')}<p>لا ردود محفوظة بعد.</p></div>`}
</div>`,
  });
}

export function adminSearch({ user, q, results, flash }) {
  return layout({
    title: 'بحث في المحادثات',
    user,
    active: '/admin/chat',
    flash,
    body: `<div class="stack">
  <a class="btn btn-sm" href="/admin/chat">${icon('arrow')} المحادثات</a>
  <h1>بحث في المحادثات</h1>

  <section class="card">
    <form method="GET" action="/admin/search" class="row">
      <input name="q" value="${esc(q)}" placeholder="اكتب كلمة من الرسالة…" class="grow" autofocus>
      <button class="btn btn-primary" type="submit">${icon('grid')} بحث</button>
    </form>
  </section>

  ${q
    ? results.length
      ? `<div class="card card-flush">${results
          .map(
            (m) => `<a class="thread" href="/admin/chat/${m.user_id}">
        <div class="thread-avatar" aria-hidden="true">${esc((m.client_name || '?').trim().charAt(0))}</div>
        <div class="grow">
          <div class="row-between">
            <b>${esc(m.client_name)}</b>
            <span class="faint small">${esc(ago(m.created_at))}</span>
          </div>
          <div class="faint small">${esc(String(m.body).replace(/\n/g, ' ').slice(0, 140))}</div>
          <div class="row" style="margin-block-start:var(--s-1)">
            <span class="badge">${esc({ client: 'العميل', admin: 'أنت', bot: 'سامي', system: 'النظام' }[m.author_role] || '')}</span>
            ${m.visibility === 'internal' ? `<span class="badge badge-warn">ملاحظة داخلية</span>` : ''}
          </div>
        </div>
      </a>`
          )
          .join('')}</div>`
      : `<div class="card empty">${icon('inbox')}<p>لا نتائج لـ «${esc(q)}».</p></div>`
    : ''}
</div>`,
  });
}
