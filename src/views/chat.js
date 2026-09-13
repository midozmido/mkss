// واجهات الشات — العميل يكتب، والرسالة تصل لوحة الأدمن في نفس اللحظة عبر SSE.
import { esc, icon, layout, fmtDate, ago } from './layout.js';

function bubbles(messages, viewerRole) {
  if (!messages.length) {
    return `<div class="empty">${icon('chat')}<p>لا رسائل بعد.</p>
      <p class="small">اكتب رسالتك في الأسفل — نرد عليك في أسرع وقت.</p></div>`;
  }
  return messages.map((m) => bubble(m, viewerRole)).join('');
}

export function bubble(m, viewerRole) {
  const mine = m.author_role === viewerRole;
  const who = m.author_role === 'client' ? 'العميل' : m.author_role === 'admin' ? 'فريق الدعم' : 'النظام';
  return `<div class="msg ${mine ? 'msg-mine' : ''} ${m.author_role === 'system' ? 'msg-system' : ''}" data-id="${m.id}">
    <div class="msg-body">${esc(m.body)}</div>
    <div class="msg-meta">${esc(mine ? 'أنت' : who)} · <time>${esc(fmtDate(m.created_at, true))}</time></div>
  </div>`;
}

/** شات العميل — يبقى مفتوحًا حتى في حالة القفل */
export function clientChatPage({ user, messages, flash, locked = false }) {
  return layout({
    title: 'المحادثة',
    user,
    active: '/chat',
    flash,
    body: `<div class="stack">
  <div class="row-between">
    <div>
      <h1>المحادثة</h1>
      <p class="muted small" style="margin:0">اكتب لنا مباشرة — تصلنا رسالتك فورًا</p>
    </div>
    <span class="badge" id="chat-status">${icon('clock')} جارٍ الاتصال…</span>
  </div>

  ${locked ? `<div class="alert alert-warn">${icon('alert')}<div>
    مزايا لوحتك متوقفة، لكن هذه المحادثة تظل مفتوحة دائمًا.
    <a href="/billing">تفعيل الاشتراك</a>
  </div></div>` : ''}

  <section class="chat" data-chat-user="${user.id}" data-viewer="client">
    <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="سجل المحادثة">
      ${bubbles(messages, 'client')}
    </div>
    <form class="chat-form" method="POST" action="/chat" id="chat-form">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <textarea name="body" id="chat-input" rows="1" required maxlength="4000"
        placeholder="اكتب رسالتك… (Enter للإرسال، Shift+Enter لسطر جديد)"></textarea>
      <button class="btn btn-primary" type="submit" aria-label="إرسال">${icon('chat')} إرسال</button>
    </form>
  </section>
</div>`,
  });
}

/** قائمة محادثات الأدمن */
export function adminChatList({ user, threads, flash }) {
  return layout({
    title: 'المحادثات',
    user,
    active: '/admin/chat',
    flash,
    body: `<div class="stack">
  <div class="row-between">
    <h1>المحادثات</h1>
    <span class="badge" id="chat-status">${icon('clock')} جارٍ الاتصال…</span>
  </div>

  ${threads.length
    ? `<div class="card card-flush" id="thread-list">${threads
        .map(
          (t) => `<a class="thread" href="/admin/chat/${t.user_id}" data-user="${t.user_id}">
      <div class="thread-avatar" aria-hidden="true">${esc((t.name || '?').trim().charAt(0))}</div>
      <div class="grow">
        <div class="row-between">
          <b>${esc(t.name)}</b>
          <span class="faint small">${esc(ago(t.last_at))}</span>
        </div>
        <div class="thread-last faint">${t.last_role === 'admin' ? 'أنت: ' : ''}${esc((t.last_body || '').slice(0, 90))}</div>
      </div>
      ${t.unread ? `<span class="badge badge-danger">${t.unread}</span>` : ''}
    </a>`
        )
        .join('')}</div>`
    : `<div class="card empty">${icon('inbox')}<p>لا محادثات بعد.</p></div>`}
</div>`,
  });
}

/** محادثة واحدة في لوحة الأدمن */
export function adminChatThread({ user, client, messages, state, flash }) {
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
        <a class="btn btn-sm" href="/admin/client/${client.id}">ملف العميل</a>
      </div>
    </div>
  </section>

  <section class="chat" data-chat-user="${client.id}" data-viewer="admin">
    <div class="chat-log" id="chat-log" role="log" aria-live="polite">
      ${bubbles(messages, 'admin')}
    </div>
    <form class="chat-form" method="POST" action="/admin/chat/${client.id}" id="chat-form">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <textarea name="body" id="chat-input" rows="1" required maxlength="4000"
        placeholder="ردّك على ${esc(client.name)}…"></textarea>
      <button class="btn btn-primary" type="submit">${icon('chat')} إرسال</button>
    </form>
  </section>
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
