// واجهات المحادثة — المساعد الآلي، والنقلة لفريق الدعم.
import { esc, icon, layout, fmtDate, ago, sami } from './layout.js';

/** ألوان الشات المتاحة للعميل — متباينة بما يكفي ليُميّزها المستخدم */
export const CHAT_COLORS = [
  { key: 'teal', hex: '#0d7a6f', label: 'أخضر مزرقّ' },
  { key: 'blue', hex: '#1d6ff2', label: 'أزرق' },
  { key: 'violet', hex: '#7c3aed', label: 'بنفسجي' },
  { key: 'rose', hex: '#e11d6b', label: 'وردي' },
  { key: 'amber', hex: '#d97706', label: 'برتقالي' },
  { key: 'green', hex: '#15803d', label: 'أخضر' },
  { key: 'slate', hex: '#475569', label: 'رمادي' },
];
export const isValidColor = (hex) => CHAT_COLORS.some((c) => c.hex === hex);

// اسم سامي يأتي من الإعدادات، فتغييره من مكان واحد يسري على كل الواجهة
let BOT_NAME = 'سامي';
export const setBotName = (n) => { BOT_NAME = n || 'سامي'; };
const roleLabel = (r) =>
  ({ client: 'العميل', admin: 'فريق الدعم', system: 'النظام', bot: BOT_NAME })[r] || '';

/** تنسيق خفيف: **عريض** وأسطر جديدة — بلا محرك ماركداون ولا مكتبة */
function rich(text) {
  return esc(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/^• /gm, '<span class="bullet">•</span> ');
}

export function bubble(m, viewerRole, { csrf = '', group = 'only' } = {}) {
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
        <button class="chip chip-strong" type="submit">${icon('chat')} تحدّث إلى الدعم الفني</button>
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
        <button class="chip chip-strong" type="submit">${icon('chat')} تحدّث إلى الدعم الفني</button>
      </form>
    </div>`;
  }

  const isSystem = m.author_role === 'system';
  // الصورة تظهر مرة واحدة في آخر مجموعة الرسائل المتتالية — سلوك ماسنجر
  const showAvatar = isBot && !mine && (group === 'only' || group === 'last');
  const avatar = isBot && !mine
    ? (showAvatar ? `<span class="msg-ava">${sami(32, { floating: false })}</span>` : '<span class="msg-ava-spacer"></span>')
    : '';
  // الوقت والاسم يظهران في نهاية المجموعة فقط، فلا يتكرران تحت كل سطر
  const showMeta = group === 'only' || group === 'last';

  const classes = [
    'msg',
    mine ? 'msg-mine' : '',
    isBot ? 'msg-bot' : '',
    isSystem ? 'msg-system' : '',
    isInternal ? 'msg-internal' : '',
    `msg-group-${group}`,
  ].filter(Boolean).join(' ');

  return `<div class="msg-wrap">
    <div class="${classes}" data-id="${m.id}">
      ${avatar}
      <div>
        ${isInternal ? `<div class="msg-tag">${icon('shield')} ملاحظة داخلية — لا يراها العميل</div>` : ''}
        <div class="msg-body">${rich(m.body)}</div>
        ${actions}
      </div>
    </div>
    ${showMeta && !isSystem
      ? `<div class="msg-meta ${mine ? 'mine' : ''}">${esc(mine ? 'أنت' : roleLabel(m.author_role))} · <time>${esc(fmtDate(m.created_at, true))}</time></div>`
      : ''}
  </div>`;
}

/** يحسب موضع كل رسالة داخل مجموعة الرسائل المتتالية من نفس المرسِل */
function groupOf(list, i) {
  const same = (a, b) =>
    a && b && a.author_role === b.author_role && a.visibility === b.visibility &&
    Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at)) < 5 * 60_000;
  const prev = same(list[i - 1], list[i]);
  const next = same(list[i], list[i + 1]);
  if (prev && next) return 'mid';
  if (prev) return 'last';
  if (next) return 'first';
  return 'only';
}

function log(messages, viewerRole, csrf) {
  if (!messages.length) return '';
  return messages.map((m, i) => bubble(m, viewerRole, { csrf, group: groupOf(messages, i) })).join('');
}

const SEND_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.2 20.6 21.4 12 3.2 3.4l.1 6.7 12.6 1.9-12.6 1.9z"/></svg>';

function typingBar() {
  return `<div class="typing" id="typing" aria-live="polite">
    <span class="msg-ava">${sami(32, { floating: false })}</span>
    <span class="typing-bubble"><i></i><i></i><i></i></span>
    <span class="sr-only">يكتب الآن…</span>
  </div>`;
}

function colorBar(current, csrf) {
  return `<form class="color-bar" method="POST" action="/chat/color" id="color-bar">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <span class="faint">لون المحادثة</span>
    ${CHAT_COLORS.map(
      (c) => `<button class="swatch" type="submit" name="color" value="${esc(c.hex)}"
        style="background:${esc(c.hex)}" title="${esc(c.label)}" aria-label="${esc(c.label)}"
        aria-pressed="${current === c.hex ? 'true' : 'false'}"></button>`
    ).join('')}
  </form>`;
}

// ——————————————————— شات العميل ———————————————————

export function clientChatPage({ user, messages, mode, topics, greeting, hours, botName = 'سامي', color, pendingRating = null, flash, locked = false }) {
  setBotName(botName);
  const isLive = mode === 'live';
  const accent = color || '#0d7a6f';

  const header = isLive
    ? `<span class="badge badge-ok">${icon('chat')} فريق الدعم${hours.open ? ' — متاح الآن' : ''}</span>`
    : `<span class="badge badge-brand">${icon('grid')} ${esc(botName)}</span>`;

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
      <p class="muted small" style="margin:0">${isLive ? 'أنت الآن مع فريق الدعم مباشرة' : `${esc(botName)} يجيبك فورًا — ويمكنك طلب زميل من الفريق في أي وقت`}</p>
    </div>
    <div class="row">${header}<span class="badge" id="chat-status">${icon('clock')} جارٍ الاتصال…</span></div>
  </div>

  ${locked ? `<div class="alert alert-warn">${icon('alert')}<div>
    مزايا لوحتك متوقفة، لكن المحادثة تظل مفتوحة دائمًا. <a href="/billing">تفعيل الاشتراك</a>
  </div></div>` : ''}

  ${pendingRating
    ? `<section class="card rating-card" style="--chat-accent:${esc(accent)}">
        <p style="margin:0"><b>كيف كانت محادثتك مع فريق الدعم؟</b></p>
        <form method="POST" action="/chat/rate" class="row" style="justify-content:center;margin-block-start:var(--s-3)">
          <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
          <input type="hidden" name="escalationId" value="${pendingRating.id}">
          <button class="chip chip-strong" name="score" value="1" type="submit">👍 راضٍ</button>
          <button class="chip" name="score" value="0" type="submit">👎 غير راضٍ</button>
        </form>
        <p class="faint" style="margin-block-start:var(--s-2);margin-block-end:0">تقييمك يساعدنا على التحسّن.</p>
      </section>`
    : ''}

  ${!isLive && !messages.length
    ? `<div class="card bot-intro" style="--chat-accent:${esc(accent)}">
        ${sami(56)}
        <p>${esc(greeting)}</p>
      </div>`
    : ''}

  <section class="chat" data-chat-user="${user.id}" data-viewer="client" data-mode="${esc(mode)}"
           style="--chat-accent:${esc(accent)}">
    <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="سجل المحادثة">
      ${log(messages, 'client', user.csrf)}
    </div>
    ${typingBar()}
    ${chips}
    <form class="chat-form" method="POST" action="/chat" id="chat-form">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <textarea name="body" id="chat-input" rows="1" required maxlength="4000"
        placeholder="${isLive ? 'اكتب رسالتك…' : `اسأل ${esc(botName)} عن أي شيء…`}"></textarea>
      <button class="chat-send" type="submit" aria-label="إرسال">${SEND_ICON}</button>
    </form>
    ${colorBar(accent, user.csrf)}
  </section>

  ${!isLive
    ? `<form method="POST" action="/chat/escalate" class="center">
        <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
        <input type="hidden" name="reason" value="طلب مباشر">
        <button class="btn btn-block" type="submit" style="max-inline-size:420px;margin-inline:auto">
          ${icon('chat')} تحدّث إلى الدعم الفني مباشرة
        </button>
        <p class="faint" style="margin-block-start:var(--s-2)">${esc(hours.open ? 'فريقنا متاح الآن' : `خارج مواعيد العمل (${hours.label}) — رسالتك تصلنا وسنرد أول ما نفتح`)}</p>
      </form>`
    : ''}
</div>`,
  });
}

// ——————————————————— لوحة الأدمن ———————————————————

export function adminChatList({ user, threads, stats = null, flash }) {
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
      <a class="btn btn-sm" href="/admin/search">${icon('grid')} بحث</a>
      <a class="btn btn-sm" href="/admin/replies">${icon('chat')} ردود محفوظة</a>
      <a class="btn btn-sm" href="/admin/kb">${icon('inbox')} قاعدة المعرفة</a>
      <span class="badge" id="chat-status">${icon('clock')} جارٍ الاتصال…</span>
    </div>
  </div>

  ${stats
    ? `<div class="stats">
      <div class="stat"><div class="stat-value">${stats.escalations}</div><div class="stat-label">تحويل خلال 30 يومًا</div></div>
      <div class="stat"><div class="stat-value">${stats.avgFirstReplyMinutes ?? '—'}<span class="faint" style="font-size:var(--t-sm)">${stats.avgFirstReplyMinutes != null ? ' د' : ''}</span></div><div class="stat-label">متوسط أول رد</div></div>
      <div class="stat"><div class="stat-value" style="color:${stats.satisfaction == null ? 'var(--text-faint)' : stats.satisfaction >= 80 ? 'var(--ok)' : 'var(--warn)'}">${stats.satisfaction == null ? '—' : stats.satisfaction + '%'}</div><div class="stat-label">نسبة الرضا</div></div>
      <div class="stat"><div class="stat-value">${stats.rated}</div><div class="stat-label">تقييم مُستلَم</div></div>
    </div>`
    : ''}

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
        <div class="thread-last faint">${t.last_role === 'admin' ? 'أنت: ' : t.last_role === 'bot' ? BOT_NAME + ': ' : ''}${esc((t.last_body || '').replace(/\n/g, ' ').slice(0, 80))}</div>
        <div class="row" style="margin-block-start:var(--s-2)">${badge(t)}</div>
      </div>
      ${t.unread ? `<span class="badge badge-danger">${t.unread}</span>` : ''}
      ${t.snooze_until && t.snooze_until > new Date().toISOString()
        ? `<span class="badge">${icon('clock')} مؤجّلة</span>` : ''}
    </a>`
        )
        .join('')}</div>`
    : `<div class="card empty">${icon('inbox')}<p>لا محادثات بعد.</p></div>`}
</div>`,
  });
}

export function adminChatThread({ user, client, messages, state, mode, replies = [], botName = 'سامي', flash }) {
  setBotName(botName);
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
        <form method="POST" action="/admin/chat/${client.id}/snooze" class="row" style="gap:var(--s-1)">
          <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
          <select name="hours" style="inline-size:auto;min-block-size:30px;padding-block:2px">
            <option value="4">أجّل 4 ساعات</option>
            <option value="24">أجّل يومًا</option>
            <option value="72">أجّل 3 أيام</option>
            <option value="0">إلغاء التأجيل</option>
          </select>
          <button class="btn btn-sm" type="submit">${icon('clock')}</button>
        </form>
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
    ${typingBar()}
    <form class="chat-form" method="POST" action="/admin/chat/${client.id}" id="chat-form">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <textarea name="body" id="chat-input" rows="1" required maxlength="4000"
        placeholder="ردّك…"></textarea>
      <button class="chat-send" type="submit" aria-label="إرسال">${SEND_ICON}</button>
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
