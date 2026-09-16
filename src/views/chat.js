// واجهات المحادثة — المساعد الآلي، والنقلة لفريق الدعم.
import { esc, icon, layout, fmtDate, ago, sami } from './layout.js';

/** ألوان الشات المتاحة للعميل — متباينة بما يكفي ليُميّزها المستخدم */
export const CHAT_COLORS = [
  { key: 'teal', hex: '#0d7a6f', label: 'أخضر مزرقّ' },
  { key: 'blue', hex: '#1d6ff2', label: 'أزرق' },
  { key: 'violet', hex: '#7c3aed', label: 'بنفسجي' },
  { key: 'rose', hex: '#e11d6b', label: 'وردي' },
  // ‎#d97706‎ مع الأبيض = ‎3.19:1‎ — لونٌ يستطيع العميل اختياره فتصير رسائله
  // هو نفسه غير مقروءة. الأغمق يعطي ‎5.05:1‎ ويبقى برتقاليًّا في العين.
  { key: 'amber', hex: '#b45309', label: 'برتقالي' },
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

export function bubble(m, viewerRole, { csrf = '', group = 'only', convId = null } = {}) {
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
      <form method="POST" action="/chat/${convId}/feedback" class="row" style="gap:var(--s-1)">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <input type="hidden" name="articleId" value="${esc(meta.articleId)}">
        <input type="hidden" name="question" value="${esc(meta.question || '')}">
        <button class="chip" name="helpful" value="1" type="submit">👍 أفادني</button>
        <button class="chip" name="helpful" value="0" type="submit">👎 لم يفدني</button>
      </form>
      <form method="POST" action="/chat/${convId}/escalate">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <input type="hidden" name="reason" value="بعد قراءة مقال">
        <button class="chip chip-strong" type="submit">${icon('chat')} تحدّث إلى الدعم الفني</button>
      </form>
    </div>`;
  } else if (viewerRole === 'client' && isBot && (meta?.kind === 'no_answer' || meta?.kind === 'suggest')) {
    const sugg = (meta.suggestions || [])
      .map((s) => `<form method="POST" action="/chat/${convId}/article" style="display:inline">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <input type="hidden" name="articleId" value="${esc(s.id)}">
          <button class="chip" type="submit">${esc(s.title)}</button>
        </form>`)
      .join('');
    actions = `<div class="msg-actions">${sugg}
      <form method="POST" action="/chat/${convId}/escalate">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <input type="hidden" name="reason" value="${esc(meta.kind === 'no_answer' ? 'المساعد لم يجد إجابة' : 'الاقتراحات لم تكفِ')}">
        <button class="chip chip-strong" type="submit">${icon('chat')} تحدّث إلى الدعم الفني</button>
      </form>
    </div>`;
  } else if (meta?.kind === 'receipt' && meta.receiptName) {
    // الإيصال يصل في المحادثة، لا في جدولٍ يُفتح عمدًا: هذه أسرع قناة إلى
    // الأدمن وأقربها إلى العميل. والرابط محروس — المسار يتحقّق من الملكية
    // قبل أن يرسل بايتًا، فظهوره هنا لا يُغني عن ذلك ولا يُضعفه.
    actions = `<div class="msg-actions">
      <a class="chip chip-strong" href="/receipt/${esc(meta.receiptName)}" target="_blank" rel="noopener">
        ${icon('receipt')} افتح صورة الإيصال
      </a>
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

  // ‎data-role‎ و‎data-at‎ ليسا زينة: سكربت البث الحيّ يقرأهما ليعرف هل الرسالة
  // الواصلة تكمل مجموعة سابقة، فيرسمها بنفس بنية الخادم بدل بنية ثانية.
  return `<div class="msg-wrap">
    <div class="${classes}" data-id="${m.id}" data-role="${esc(m.author_role)}" data-at="${esc(m.created_at)}">
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

function log(messages, viewerRole, csrf, convId = null) {
  if (!messages.length) return '';
  return messages.map((m, i) => bubble(m, viewerRole, { csrf, convId, group: groupOf(messages, i) })).join('');
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

// ——————————————————— مركز المحادثات (العميل) ———————————————————

const STATUS_BADGE = {
  open: `<span class="badge badge-ok">مفتوحة</span>`,
  closed: `<span class="badge">منتهية</span>`,
};

/** الصفحة الرئيسية للدعم: بحث ثم محادثة جديدة ثم سجل المحادثات */
export function supportHome({ user, conversations, botName = 'سامي', color, hours, popular = [], flash }) {
  const accent = color || '#0d7a6f';
  return layout({
    title: 'الدعم',
    user,
    active: '/chat',
    flash,
    body: `<div class="stack support-home" style="--chat-accent:${esc(accent)};--chat-accent-text:#fff">
  <section class="card hero-support">
    ${sami(64)}
    <div class="grow">
      <h1>كيف نساعدك؟</h1>
      <p class="muted" style="margin:0">
        اسأل ${esc(botName)} مباشرة عن أي شيء يخصّ موقعك أو متجرك —
        ${hours.open ? 'وفريق الدعم متاح الآن إن احتجته.' : `وفريق الدعم يرد من ${esc(hours.label)}.`}
      </p>
    </div>
  </section>

  ${popular.length
    ? `<section class="card topics-card" data-reveal>
        <h2 class="topics-title">${icon('book')} مواضيع يسألها الناس كثيرًا</h2>
        <div class="topics-list">${popular
          .map((a) => `<a class="topic-link" href="/help/${esc(a.slug)}">
            <span class="grow">${esc(a.title)}</span>${icon('arrow')}
          </a>`).join('')}</div>
        <a class="topics-all" href="/help">كل مكتبة المساعدة ${icon('arrow')}</a>
      </section>`
    : ''}

  <form method="POST" action="/chat/new">
    <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
    <button class="btn btn-primary btn-block new-conv" type="submit">
      ${icon('chat')} ابدأ محادثة جديدة
    </button>
  </form>

  ${conversations.length
    ? `<section class="stack">
        <h2>محادثاتك</h2>
        <div class="card card-flush">${conversations
          .map(
            (c) => `<a class="thread" href="/chat/${c.id}">
          <span class="msg-ava">${sami(34, { floating: false })}</span>
          <div class="grow">
            <div class="row-between">
              <b>${esc(c.title || 'محادثة جديدة')}</b>
              <span class="faint small">${esc(ago(c.last_at))}</span>
            </div>
            <div class="thread-last faint">${c.last_role === 'client' ? 'أنت: ' : c.last_role === 'bot' ? esc(botName) + ': ' : ''}${esc(String(c.last_body || '').replace(/\n/g, ' ').slice(0, 80))}</div>
            <div class="row" style="margin-block-start:var(--s-2)">
              ${STATUS_BADGE[c.status] || ''}
              ${c.mode === 'live' && c.status === 'open' ? `<span class="badge badge-info">${icon('chat')} مع فريق الدعم</span>` : ''}
            </div>
          </div>
          ${c.unread ? `<span class="badge badge-danger">${c.unread}</span>` : ''}
        </a>`
          )
          .join('')}</div>
      </section>`
    : `<div class="card empty">${icon('chat')}<p>لا محادثات بعد.</p>
        <p class="small">ابدأ واحدة وسأجيبك فورًا.</p></div>`}
</div>`,
  });
}

/** محادثة واحدة */
export function conversationPage({ user, conv, messages, topics, greeting, hours, botName = 'سامي', color, flash, locked = false }) {
  setBotName(botName);
  const accent = color || '#0d7a6f';
  const isLive = conv.mode === 'live';
  const closed = conv.status === 'closed';

  const chips = !isLive && !closed && topics.length
    ? `<div class="topics" aria-label="مواضيع سريعة">
        ${topics
          .map(
            (t) => `<form method="POST" action="${t.articleId ? `/chat/${conv.id}/article` : `/chat/${conv.id}`}" style="display:inline">
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
    title: conv.title || 'محادثة',
    user,
    active: '/chat',
    flash,
    body: `<div class="stack">
  <div class="row-between">
    <div class="row">
      <a class="btn btn-sm" href="/chat">${icon('arrow')} كل المحادثات</a>
      <h1 class="title-sm">${esc(conv.title || 'محادثة')}</h1>
    </div>
    <div class="row">
      ${isLive
        ? `<span class="badge badge-ok">${icon('chat')} فريق الدعم${hours.open ? ' — متاح الآن' : ''}</span>`
        : `<span class="badge badge-brand">${icon('grid')} ${esc(botName)}</span>`}
      ${closed ? STATUS_BADGE.closed : `<span class="badge" id="chat-status">${icon('clock')} جارٍ الاتصال…</span>`}
    </div>
  </div>

  ${locked ? `<div class="alert alert-warn">${icon('alert')}<div>
    مزايا لوحتك متوقفة، لكن المحادثة تظل مفتوحة دائمًا. <a href="/billing">تفعيل الاشتراك</a>
  </div></div>` : ''}

  ${!messages.length
    ? `<div class="card bot-intro" style="--chat-accent:${esc(accent)};--chat-accent-text:#fff">
        ${sami(56)}
        <p>${esc(greeting)}</p>
      </div>`
    : ''}

  <section class="chat" data-chat-conv="${conv.id}" data-viewer="client" data-mode="${esc(conv.mode)}"
           data-bot-name="${esc(botName)}"
           style="--chat-accent:${esc(accent)};--chat-accent-text:#fff">
    <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="سجل المحادثة">
      ${log(messages, 'client', user.csrf, conv.id)}
    </div>
    ${closed ? '' : typingBar()}
    ${chips}
    ${closed
      ? `<div class="closed-note">
          <p style="margin:0">هذه المحادثة منتهية ومحفوظة في سجلك.</p>
          <form method="POST" action="/chat/new">
            <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
            <button class="btn btn-primary" type="submit">${icon('chat')} ابدأ محادثة جديدة</button>
          </form>
        </div>`
      : `<form class="chat-form" method="POST" action="/chat/${conv.id}" id="chat-form">
          <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
          <textarea name="body" id="chat-input" rows="1" required maxlength="4000"
            placeholder="${isLive ? 'اكتب رسالتك…' : `اسأل ${esc(botName)} عن أي شيء…`}"></textarea>
          <button class="chat-send" type="submit" aria-label="إرسال">${SEND_ICON}</button>
        </form>`}
    ${closed ? '' : colorBar(accent, user.csrf)}
  </section>

  ${!closed
    ? `<div class="row" style="justify-content:center;gap:var(--s-3)">
        ${!isLive
          ? `<form method="POST" action="/chat/${conv.id}/escalate">
              <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
              <input type="hidden" name="reason" value="طلب مباشر">
              <button class="btn" type="submit">${icon('chat')} تحدّث إلى الدعم الفني</button>
            </form>`
          : ''}
        <form method="POST" action="/chat/${conv.id}/close" data-confirm="إنهاء هذه المحادثة؟ ستبقى محفوظة في سجلك.">
          <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
          <button class="btn btn-sm" type="submit">${icon('check')} إنهاء المحادثة</button>
        </form>
      </div>
      ${!isLive ? `<p class="faint center" style="margin:0">${esc(hours.open ? 'فريقنا متاح الآن' : `خارج مواعيد العمل (${hours.label}) — رسالتك تصلنا وسنرد أول ما نفتح`)}</p>` : ''}`
    : ''}
</div>`,
  });
}

// ——————————————————— لوحة الأدمن ———————————————————

/** «—» لا قياس · «<1 د» لرد في أقل من دقيقة · وإلا الدقائق */
const firstReplyLabel = (min) => {
  if (min == null) return '—';
  const unit = '<span class="faint" style="font-size:var(--t-sm)"> د</span>';
  return min === 0 ? `&lt;1${unit}` : `${min}${unit}`;
};

export function adminChatList({ user, threads, stats = null, flash }) {
  const badge = (t) => {
    if (t.status === 'closed') return `<span class="badge">منتهية</span>`;
    if (t.mode === 'live') return `<span class="badge badge-danger">${icon('alert')} محوّل للدعم</span>`;
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
      <div class="stat"><div class="stat-value">${firstReplyLabel(stats.avgFirstReplyMinutes)}</div><div class="stat-label">متوسط أول رد</div></div>
      <div class="stat"><div class="stat-value" style="color:${stats.openLive ? 'var(--danger)' : 'var(--ok)'}">${stats.openLive}</div><div class="stat-label">محادثة مفتوحة مع الفريق</div></div>
      <div class="stat"><div class="stat-value">${stats.replied}</div><div class="stat-label">تحويل رُدّ عليه</div></div>
    </div>`
    : ''}

  ${threads.length
    ? `<div class="card card-flush" id="thread-list">${threads
        .map(
          (t) => `<a class="thread ${t.mode === 'live' && t.status === 'open' ? 'thread-live' : ''}" href="/admin/chat/${t.conversation_id}">
      <div class="thread-avatar" aria-hidden="true">${esc((t.name || '?').trim().charAt(0))}</div>
      <div class="grow">
        <div class="row-between">
          <b>${esc(t.name)}</b>
          <span class="faint small">${esc(ago(t.last_at))}</span>
        </div>
        <div class="faint small">${esc(t.title || 'محادثة')}</div>
        <div class="thread-last faint">${t.last_role === 'admin' ? 'أنت: ' : t.last_role === 'bot' ? BOT_NAME + ': ' : ''}${esc((t.last_body || '').replace(/\n/g, ' ').slice(0, 70))}</div>
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

export function adminChatThread({ user, client, conv, messages, state, replies = [], botName = 'سامي', flash }) {
  setBotName(botName);
  const isLive = conv.mode === 'live';
  const closed = conv.status === 'closed';
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
          <h1 class="title-sm">${esc(client.name)}</h1>
          <div class="faint small">${esc(conv.title || 'محادثة')}</div>
          <div class="faint small ltr">${esc(client.email)}${client.whatsapp ? ` · ${esc(client.whatsapp)}` : ''}</div>
        </div>
      </div>
      <div class="row">
        ${stateBadge(state)}
        ${closed
          ? `<span class="badge">منتهية</span>`
          : isLive
            ? `<span class="badge badge-danger">${icon('alert')} محوّل للدعم</span>`
            : `<span class="badge badge-brand">${icon('grid')} مع المساعد</span>`}
        <a class="btn btn-sm" href="/admin/client/${client.id}">ملف العميل</a>
        <form method="POST" action="/admin/chat/${conv.id}/snooze" class="row" style="gap:var(--s-1)">
          <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
          <select class="snooze-select" name="hours" aria-label="تأجيل المحادثة">
            <option value="4">أجّل 4 ساعات</option>
            <option value="24">أجّل يومًا</option>
            <option value="72">أجّل 3 أيام</option>
            <option value="0">إلغاء التأجيل</option>
          </select>
          <button class="btn btn-sm" type="submit">${icon('clock')}</button>
        </form>
        ${!closed
          ? `<form method="POST" action="/admin/chat/${conv.id}/close" data-confirm="إنهاء المحادثة؟ ستُحفظ في سجل العميل ويمكنه فتح جديدة.">
              <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
              <button class="btn btn-sm" type="submit">${icon('check')} إنهاء المحادثة</button>
            </form>`
          : ''}
      </div>
    </div>
  </section>

  <section class="chat" data-chat-conv="${conv.id}" data-viewer="admin" data-mode="${esc(conv.mode)}"
           data-bot-name="${esc(BOT_NAME)}">
    <div class="chat-log" id="chat-log" role="log" aria-live="polite">
      ${log(messages, 'admin', user.csrf, conv.id)}
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
    ${closed ? '<div class="closed-note"><p style="margin:0">هذه المحادثة منتهية. الرد عليها يعيد فتحها.</p></div>' : ''}
    <form class="chat-form" method="POST" action="/admin/chat/${conv.id}" id="chat-form">
      <input type="hidden" name="_csrf" value="${esc(user.csrf)}">
      <textarea name="body" id="chat-input" rows="1" required maxlength="4000"
        placeholder="ردّك…"></textarea>
      <button class="chat-send" type="submit" aria-label="إرسال">${SEND_ICON}</button>
    </form>
  </section>

  <details class="card">
    <summary><b>ملاحظة داخلية</b> — لا يراها العميل</summary>
    <form method="POST" action="/admin/chat/${conv.id}/note" class="stack" style="margin-block-start:var(--s-4)">
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
