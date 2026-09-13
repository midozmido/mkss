// واجهات قاعدة المعرفة — للعميل وللأدمن.
import { esc, icon, layout, fmtDate, ago } from './layout.js';

const rich = (t) =>
  esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/^• /gm, '<span class="bullet">•</span> ');

// ——————————————————— للعميل ———————————————————

export function helpIndex({ user, categories, articles, q = '', results = null, flash }) {
  const byCat = {};
  for (const a of articles) (byCat[a.category] ||= []).push(a);

  return layout({
    title: 'المساعدة',
    user,
    active: '/help',
    flash,
    body: `<div class="stack">
  <div class="row-between">
    <div>
      <h1>المساعدة</h1>
      <p class="muted small" style="margin:0">إجابات الأسئلة الشائعة — ولو محتاج حاجة تانية، المحادثة مفتوحة</p>
    </div>
    <a class="btn btn-sm btn-primary" href="/chat">${icon('chat')} اسأل المساعد</a>
  </div>

  <form class="card search-card" method="GET" action="/help">
    <div class="row" style="gap:var(--s-2)">
      <input name="q" class="grow" value="${esc(q)}" placeholder="ابحث… مثال: الدومين خلص" autocomplete="off">
      <button class="btn btn-primary" type="submit">${icon('grid')} بحث</button>
    </div>
  </form>

  ${results
    ? results.length
      ? `<section class="stack">
          <h2>نتائج البحث عن «${esc(q)}»</h2>
          <div class="kb-grid">${results
            .map((a) => `<a class="kb-card" href="/help/${esc(a.slug)}">
              <h3>${esc(a.title)}</h3>
              <p class="faint" style="margin:0">${esc(String(a.body).replace(/\n/g, ' ').slice(0, 110))}…</p>
            </a>`)
            .join('')}</div>
        </section>`
      : `<div class="card empty">${icon('inbox')}
          <p>لم نجد مقالًا عن «${esc(q)}».</p>
          <p class="small">اسأل المساعد مباشرة — وإن لم يعرف حوّلك لفريق الدعم فورًا.</p>
          <a class="btn btn-primary" href="/chat">${icon('chat')} اسأل الآن</a>
        </div>`
    : ''}

  ${categories
    .map(
      (c) => `<section class="stack">
    <h2>${esc(c.category)}</h2>
    <div class="kb-grid">${(byCat[c.category] || [])
      .map(
        (a) => `<a class="kb-card" href="/help/${esc(a.slug)}">
        <h3>${esc(a.title)}</h3>
        <p class="faint" style="margin:0">${esc(String(a.body).replace(/\n/g, ' ').slice(0, 110))}…</p>
      </a>`
      )
      .join('')}</div>
  </section>`
    )
    .join('')}

  ${!articles.length ? `<div class="card empty">${icon('inbox')}<p>لا توجد مقالات بعد.</p></div>` : ''}
</div>`,
  });
}

export function helpArticle({ user, article, flash }) {
  return layout({
    title: article.title,
    user,
    active: '/help',
    flash,
    body: `<div class="stack">
  <a class="btn btn-sm" href="/help">${icon('arrow')} كل المقالات</a>
  <article class="card">
    <span class="badge badge-brand">${esc(article.category)}</span>
    <h1 style="margin-block:var(--s-3)">${esc(article.title)}</h1>
    <div class="kb-body">${rich(article.body)}</div>
  </article>
  <div class="card center stack">
    <p style="margin:0">لسه محتاج مساعدة؟</p>
    <a class="btn btn-primary" href="/chat">${icon('chat')} كلم الدعم الفني</a>
  </div>
</div>`,
  });
}

// ——————————————————— للأدمن ———————————————————

export function adminKbList({ user, articles, unanswered, weak, flash }) {
  return layout({
    title: 'قاعدة المعرفة',
    user,
    active: '/admin/kb',
    flash,
    body: `<div class="stack">
  <div class="row-between">
    <h1>قاعدة المعرفة</h1>
    <a class="btn btn-primary btn-sm" href="/admin/kb/new">${icon('inbox')} مقال جديد</a>
  </div>

  ${unanswered.length
    ? `<section class="card">
      <h2>${icon('alert')} أسئلة لم يجد المساعد إجابة لها</h2>
      <p class="faint">دي بالظبط المقالات اللي المفروض تكتبها بعد كده — مرتّبة بالتكرار.</p>
      <div class="table-scroll"><table>
        <thead><tr><th>السؤال</th><th>تكرر</th><th>آخر مرة</th><th></th></tr></thead>
        <tbody>${unanswered
          .map(
            (q) => `<tr>
          <td>${esc(q.question)}</td>
          <td class="num">${q.times}</td>
          <td class="small">${esc(ago(q.last_at))}</td>
          <td><a class="btn btn-sm" href="/admin/kb/new">اكتب مقالًا</a></td>
        </tr>`
          )
          .join('')}</tbody>
      </table></div>
    </section>`
    : ''}

  ${weak.length
    ? `<div class="alert alert-warn">${icon('alert')}<div>
      <b>مقالات قال عنها العملاء إنها لم تفد:</b>
      ${weak.map((w) => `<a href="/admin/kb/${w.id}">${esc(w.title)}</a> (👎 ${w.not_helpful})`).join(' · ')}
    </div></div>`
    : ''}

  <div class="card card-flush"><div class="table-scroll"><table>
    <thead><tr><th>المقال</th><th>التصنيف</th><th>قراءات</th><th>مفيد</th><th>الحالة</th><th></th></tr></thead>
    <tbody>${articles
      .map(
        (a) => `<tr>
      <td><a href="/admin/kb/${a.id}">${esc(a.title)}</a><div class="faint small mono ltr">${esc(a.slug)}</div></td>
      <td class="small">${esc(a.category)}</td>
      <td class="num">${a.views}</td>
      <td class="num">👍 ${a.helpful} · 👎 ${a.not_helpful}</td>
      <td>${a.active
        ? `<span class="badge badge-ok">${icon('check')} منشور</span>`
        : `<span class="badge">مخفي</span>`}</td>
      <td>
        <form method="POST" action="/admin/kb/${a.id}/delete" data-confirm="حذف «${esc(a.title)}» نهائيًا؟">
          <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
          <button class="btn btn-sm" type="submit">حذف</button>
        </form>
      </td>
    </tr>`
      )
      .join('')}</tbody>
  </table></div></div>
</div>`,
  });
}

export function adminKbForm({ user, article, flash }) {
  const a = article || {};
  return layout({
    title: article ? `تعديل ${a.title}` : 'مقال جديد',
    user,
    active: '/admin/kb',
    flash,
    body: `<div class="stack">
  <a class="btn btn-sm" href="/admin/kb">${icon('arrow')} قاعدة المعرفة</a>
  <h1>${article ? 'تعديل مقال' : 'مقال جديد'}</h1>

  <section class="card">
    <form method="POST" action="/admin/kb" class="stack">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      ${article ? `<input type="hidden" name="id" value="${a.id}">` : ''}
      <div class="field">
        <label for="title">العنوان</label>
        <input id="title" name="title" required maxlength="200" value="${esc(a.title || '')}"
               placeholder="مثال: موقعي لا يفتح — ماذا أفعل؟">
        <div class="hint">اكتبه بصيغة السؤال الذي يطرحه العميل، لا بصيغة تقنية.</div>
      </div>
      <div class="field">
        <label for="body">المحتوى</label>
        <textarea id="body" name="body" required rows="12" maxlength="8000">${esc(a.body || '')}</textarea>
        <div class="hint">**نص عريض** بين نجمتين · ابدأ السطر بـ «• » لنقطة.</div>
      </div>
      <div class="field">
        <label for="keywords">كلمات البحث</label>
        <input id="keywords" name="keywords" maxlength="300" value="${esc(a.keywords || '')}"
               placeholder="واقع مقفول داون مش شغال">
        <div class="hint"><b>أهم حقل في الصفحة.</b> اكتب الكلمات <b>بالعامية كما ينطقها عميلك</b>،
          لا بالفصحى — «اتقفلت» و«مش شغال» و«فين» هي ما يكتبه فعلًا.</div>
      </div>
      <div class="grid grid-2">
        <div class="field">
          <label for="category">التصنيف</label>
          <input id="category" name="category" maxlength="60" value="${esc(a.category || 'عام')}" list="cats">
          <datalist id="cats">
            <option value="حالة الموقع"><option value="الأمان"><option value="الاشتراك والدفع">
            <option value="الصيانة"><option value="التقارير"><option value="عام">
          </datalist>
        </div>
        <div class="field">
          <label for="sort_order">الترتيب</label>
          <input id="sort_order" name="sort_order" type="number" dir="ltr" value="${esc(a.sort_order ?? 100)}">
        </div>
      </div>
      <label class="row" style="gap:var(--s-2)">
        <input type="checkbox" name="active" value="1" ${a.active === 0 ? '' : 'checked'} style="inline-size:auto;min-block-size:auto">
        <span>منشور ويظهر للعملاء</span>
      </label>
      <button class="btn btn-primary" type="submit">حفظ</button>
    </form>
  </section>
</div>`,
  });
}
