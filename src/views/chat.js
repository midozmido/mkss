// واجهات المحادثة — المساعد الآلي، والنقلة لفريق الدعم.
import { esc, icon, layout, fmtDate, ago } from './layout.js';

const ROLE_LABEL = { client: 'العميل', admin: 'فريق الدعم', system: 'النظام', bot: 'المساعد الآلي' };

/** تنسيق خفيف: **عريض** وأسطر جديدة — بلا محرك ماركداون ولا مكتبة */
function rich(text) {
  return esc(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/^• /gm, '<span class="bullet">•</span> ');
}

export function bubble(m, viewerRole, { csrf = '' } = {}) {
  const mine = m.author_role === viewerRole;
  const isInternal = m.visibility === 'internal';
  const isBot = m.author_role === 'bot';
  let meta = null;
  try { meta = m.meta ? JSON.parse(m.meta) : null; } catch { meta = null; }

  // أزرار تتبع الرد: التقييم يخبرنا أي مقال يحتاج إعادة كتابة،
  // وزر الدعم يبقى ظاهرًا دائمًا فلا يصل العميل إلى طريق مسدود.
  let actions = '';
  if (viewerRole === 'client' && isBot && meta?.kind === 'answer' && meta.articleId) {
    actions = `<div class="msg-actions">
      <form method="POST" action="/chat/feedback" class="row" style="gap:var(--s-1)">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <input type="hidden" name="articleId" value="${esc(meta.articleId)}">
        <input type="hidden" name="question" value="${esc(meta.question || '')}">
        <button class="chip" name="helpful" value="1" type="submit">👍 أفادني</button>
        <button class="chip" name="helpful" value="0" type="submit">👎 لم يفدني</button>
      </form>
      <form method="POST" action="/chat/escalate">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <input type="hidden" name="reason" value="بعد قراءة مقال">
        <button class="chip chip-strong" type="submit">${icon('chat')} كلم الدعم الفني</button>
      </form>
    </div>`;
  } else if (viewerRole === 'client' && isBot && (meta?.kind === 'no_answer' || meta?.kind === 'suggest')) {
    const sugg = (meta.suggestions || [])
      .map((s) => `<form method="POST" action="/chat/article" style="display:inline">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <input type="hidden" name="articleId" value="${esc(s.id)}">
          <button class="chip" type="submit">${esc(s.title)}</button>
        </form>`)
      .join('');
    actions = `<div class="msg-actions">${sugg}
      <form method="POST" action="/chat/escalate">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <input type="hidden" name="reason" value="${esc(meta.kind === 'no_answer' ? 'المساعد لم يجد إجابة' : 'الاقتراحات لم تكفِ')}">
        <button class="chip chip-strong" type="submit">${icon('chat')} كلم الدعم الفني</button>
      </form>
    </div>`;
  }

  return `<div class="msg ${mine ? 'msg-mine' : ''} ${isBot ? 'msg-bot' : ''} ${m.author_role === 'system' ? 'msg-system' : ''} ${isInternal ? 'msg-internal' : ''}" data-id="${m.id}">
    ${isInternal ? `<div class="msg-tag">${icon('shield')} ملاحظة داخلية — لا يراها العميل</div>` : ''}
    <div class="msg-body">${rich(m.body)}</div>
    ${actions}
    <div class="msg-meta">${esc(mine ? 'أنت' : ROLE_LABEL[m.author_role] || '')} · <time>${esc(fmtDate(m.created_at, true))}</time></div>
  </div>`;
}

function log(messages, viewerRole, csrf) {
  if (!messages.length) return '';
  return messages.map((m) => bubble(m, viewerRole, { csrf })).join('');
}

// ——————————————————— شات العميل ———————————————————

export function clientChatPage({ user, messages, mode, topics, greeting, hours, flash, locked = false }) {
  const isLive = mode === 'live';

  const header = isLive
    ? `<span class="badge badge-ok">${icon('chat')} فريق الدعم${hours.open ? ' — متاح الآن' : ''}</span>`
    : `<span class="badge badge-brand">${icon('grid')} المساعد الآلي</span>`;

  const chips = !isLive && topics.length
    ? `<div class="topics" aria-label="مواضيع سريعة">
        ${topics
          .map(
            (t) => `<form method="POST" action="${t.articleId ? '/chat/article' : '/chat'}" style="display:inline">
          <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
          ${t.articleId
            ? `<input type="hidden" name="articleId" value="${esc(t.articleId)}">`
            : `<input type="hidden" name="body" value="${esc(t.label)}">`}
          <button class="chip" type="submit">${esc(t.label)}</button>
        </form>`
          )
          .join('')}
      </div>`
    : '';

  return layout({
    title: 'المحادثة',
    user,
    active: '/chat',
    flash,
    body: `<div class="stack">
  <div class="row-between">
    <div>
      <h1>المحادثة</h1>
      <p class="muted small" style="margin:0">${isLive ? 'أنت الآن مع فريق الدعم مباشرة' : 'إجابات فورية — وتقدر تطلب الدعم البشري في أي وقت'}</p>
    </div>
    <div class="row">${header}<span class="badge" id="chat-status">${icon('clock')} جارٍ الاتصال…</span></div>
  </div>

  ${locked ? `<div class="alert alert-warn">${icon('alert')}<div>
    مزايا لوحتك متوقفة، لكن المحادثة تظل مفتوحة دائمًا. <a href="/billing">تفعيل الاشتراك</a>
  </div></div>` : ''}

  ${!isLive && !messages.length
    ? `<div class="card bot-intro">
        <div class="bot-avatar" aria-hidden="true">🤖</div>
        <p>${esc(greeting)}</p>
      </div>`
    : ''}

  <section class="chat" data-chat-user="${user.id}" data-viewer="client" data-mode="${esc(mode)}">
    <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="سجل المحادثة">
      ${log(messages, 'client', user.csrf)}
    </div>
    ${chips}
    <form class="chat-form" method="POST" action="/chat" id="chat-form">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <textarea name="body" id="chat-input" rows="1" required maxlength="4000"
        placeholder="${isLive ? 'رسالتك…' : 'اسأل عن أي حاجة…'}"></textarea>
      <button class="btn btn-primary" type="submit">${icon('chat')} إرسال</button>
    </form>
  </section>

  ${!isLive
    ? `<form method="POST" action="/chat/escalate" class="center">
        <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
        <input type="hidden" name="reason" value="طلب مباشر">
        <button class="btn btn-block" type="submit" style="max-inline-size:420px;margin-inline:auto">
          ${icon('chat')} كلم الدعم الفني مباشرة
        </button>
        <p class="faint" style="margin-block-start:var(--s-2)">${esc(hours.open ? 'فريقنا متاح الآن' : `خارج مواعيد العمل (${hours.label}) — رسالتك تصلنا وسنرد أول ما نفتح`)}</p>
      </form>`
    : ''}
</div>`,
  });
}

// ——————————————————— لوحة الأدمن ———————————————————

export function adminChatList({ user, threads, flash }) {
  const badge = (t) => {
    if (t.support_mode === 'live' && t.escalated_at) {
      return `<span class="badge badge-danger">${icon('alert')} محوّل للدعم</span>`;
    }
    return `<span class="badge badge-brand">${icon('grid')} مع المساعد</span>`;
  };

  return layout({
    title: 'المحادثات',
    user,
    active: '/admin/chat',
    flash,
    body: `<div class="stack">
  <div class="row-between">
    <h1>المحادثات</h1>
    <div class="row">
      <a class="btn btn-sm" href="/admin/kb">${icon('inbox')} قاعدة المعرفة</a>
      <span class="badge" id="chat-status">${icon('clock')} جارٍ الاتصال…</span>
    </div>
  </div>

  ${threads.length
    ? `<div class="card card-flush" id="thread-list">${threads
        .map(
          (t) => `<a class="thread ${t.support_mode === 'live' ? 'thread-live' : ''}" href="/admin/chat/${t.user_id}">
      <div class="thread-avatar" aria-hidden="true">${esc((t.name || '?').trim().charAt(0))}</div>
      <div class="grow">
        <div class="row-between">
          <b>${esc(t.name)}</b>
          <span class="faint small">${esc(ago(t.last_at))}</span>
        </div>
        <div class="thread-last faint">${t.last_role === 'admin' ? 'أنت: ' : t.last_role === 'bot' ? 'المساعد: ' : ''}${esc((t.last_body || '').replace(/\n/g, ' ').slice(0, 80))}</div>
        <div class="row" style="margin-block-start:var(--s-2)">${badge(t)}</div>
      </div>
      ${t.unread ? `<span class="badge badge-danger">${t.unread}</span>` : ''}
    </a>`
        )
        .join('')}</div>`
    : `<div class="card empty">${icon('inbox')}<p>لا محادثات بعد.</p></div>`}
</div>`,
  });
}

export function adminChatThread({ user, client, messages, state, mode, replies = [], flash }) {
  const isLive = mode === 'live';
  return layout({
    title: `محادثة ${client.name}`,
    user,
    active: '/admin/chat',
    flash,
    body: `<div class="stack">
  <a class="btn btn-sm" href="/admin/chat">${icon('arrow')} كل المحادثات</a>

  <section class="card">
    <div class="row-between">
      <div class="row">
        <div class="thread-avatar" aria-hidden="true">${esc((client.name || '?').trim().charAt(0))}</div>
        <div>
          <h1 style="font-size:var(--t-md)">${esc(client.name)}</h1>
          <div class="faint small ltr">${esc(client.email)}${client.whatsapp ? ` · ${esc(client.whatsapp)}` : ''}</div>
        </div>
      </div>
      <div class="row">
        ${stateBadge(state)}
        ${isLive
          ? `<span class="badge badge-danger">${icon('alert')} محوّل للدعم</span>`
          : `<span class="badge badge-brand">${icon('grid')} مع المساعد</span>`}
        <a class="btn btn-sm" href="/admin/client/${client.id}">ملف العميل</a>
        ${isLive
          ? `<form method="POST" action="/admin/chat/${client.id}/close" data-confirm="إنهاء المحادثة وإعادة العميل للمساعد الآلي؟">
              <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
              <button class="btn btn-sm" type="submit">${icon('check')} إنهاء المحادثة</button>
            </form>`
          : ''}
      </div>
    </div>
  </section>

  <section class="chat" data-chat-user="${client.id}" data-viewer="admin" data-mode="${esc(mode)}">
    <div class="chat-log" id="chat-log" role="log" aria-live="polite">
      ${log(messages, 'admin', user.csrf)}
    </div>
    ${replies.length
      ? `<details class="canned">
          <summary>${icon('inbox')} ردود محفوظة (${replies.length})</summary>
          <div class="canned-list">${replies
            .map((r) => `<button type="button" class="chip" data-insert="${esc(r.body)}">${esc(r.title)}</button>`)
            .join('')}</div>
        </details>`
      : ''}
    <form class="chat-form" method="POST" action="/admin/chat/${client.id}" id="chat-form">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <textarea name="body" id="chat-input" rows="1" required maxlength="4000"
        placeholder="ردّك…"></textarea>
      <button class="btn btn-primary" type="submit">${icon('chat')} إرسال</button>
    </form>
  </section>

  <details class="card">
    <summary><b>ملاحظة داخلية</b> — لا يراها العميل</summary>
    <form method="POST" action="/admin/chat/${client.id}/note" class="stack" style="margin-block-start:var(--s-4)">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <textarea name="body" rows="2" required maxlength="2000" placeholder="سياق للفريق…"></textarea>
      <button class="btn btn-sm" type="submit">حفظ الملاحظة</button>
    </form>
  </details>
</div>`,
  });
}

export function stateBadge(st) {
  if (!st) return '';
  const map = {
    trial: ['badge-info', 'clock', 'تجربة مجانية'],
    ok: ['badge-ok', 'check', 'منتظم'],
    due: ['badge-info', 'receipt', 'عليه مستحقات'],
    grace: ['badge-warn', 'alert', 'في المهلة'],
    restricted: ['badge-danger', 'x', 'مقفول'],
  };
  const [cls, ic, label] = map[st.state] || map.ok;
  return `<span class="badge ${cls}">${icon(ic)} ${esc(label)}</span>`;
}
