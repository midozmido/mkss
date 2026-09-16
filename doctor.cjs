#!/usr/bin/env node
// فحص الاستضافة قبل الرفع — شغّله على الخادم أوّلًا:  node doctor.cjs
//
// السبب: أكثر ما يُفشل هذا النظام على استضافة مشتركة ليس خطأً في الكود، بل
// نسخة Node أقدم مما تتطلّبه `node:sqlite`. وبلا هذا الفحص يظهر الفشل بعد
// الرفع بصورة رسالة غامضة، فتظنّ العلّة في البرنامج وهي في الاستضافة.
//
// يعمل هذا الملف على **أي** نسخة Node، ولا يستورد شيئًا من المشروع، لأنه
// يجب أن يخبرك بالمشكلة لا أن يقع فيها.
'use strict';

const { existsSync, mkdirSync, writeFileSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');
const os = require('node:os');

// ‎22.13.0‎ لا ‎22.5.0‎. الوحدة ‎node:sqlite‎ ظهرت في ‎22.5‎ لكنها ظلّت تحتاج
// راية ‎--experimental-sqlite‎ حتى ‎22.13.0‎، وهناك رُفعت الراية. ومديرو التطبيقات
// المُدارة (hPanel في هوستنجر، وPassenger في cPanel) لا يتيحون تمرير رايات
// لسطر الأوامر — فنسخة بين ‎22.5‎ و‎22.12‎ تبدو مطابقة وهي لا تقلع.
const NEED_NODE = [22, 13, 0];
const rows = [];
let fatal = 0;
let warn = 0;

function row(state, title, detail) {
  rows.push({ state, title, detail });
  if (state === 'fail') fatal++;
  if (state === 'warn') warn++;
}

// ——— ١) نسخة Node ———
const v = process.versions.node.split('.').map(Number);
const okNode =
  v[0] > NEED_NODE[0] || (v[0] === NEED_NODE[0] && (v[1] > NEED_NODE[1] || (v[1] === NEED_NODE[1] && v[2] >= NEED_NODE[2])));
row(
  okNode ? 'ok' : 'fail',
  `نسخة Node: ${process.versions.node}`,
  okNode
    ? 'مناسبة.'
    : `النظام يحتاج 22.13.0 فأحدث (والأأمن أن تختار 24).
     هوستنجر: hPanel → المواقع → تطبيق Node.js → Node.js version.
     cPanel: Setup Node.js App → Node.js version.
     إن كان أقصى المتاح أقل من ذلك فهذه الاستضافة لا تصلح كما هي — راجع docs/HOSTINGER.md.`
);

// ——— ٢) node:sqlite ———
let sqliteOk = false;
try {
  const { DatabaseSync } = require('node:sqlite');
  const probe = new DatabaseSync(':memory:');
  probe.exec('CREATE TABLE t(a)');
  probe.prepare('INSERT INTO t VALUES(?)').run(1);
  const got = probe.prepare('SELECT a FROM t').get();
  probe.close();
  sqliteOk = got && got.a === 1;
  row(sqliteOk ? 'ok' : 'fail', 'node:sqlite', sqliteOk ? 'تعمل.' : 'موجودة لكنها لا تنفّذ استعلامًا بسيطًا.');
} catch (e) {
  row('fail', 'node:sqlite', `غير متاحة: ${e.message}
     هذه الوحدة مدمجة في Node 22.13 فأحدث (بلا راية). لا تُنصَّب بـ npm.`);
}

// ——— ٣) الكتابة في data/ ———
const dataDir = join(__dirname, 'data');
try {
  mkdirSync(dataDir, { recursive: true });
  const probe = join(dataDir, '.doctor-probe');
  writeFileSync(probe, 'x');
  unlinkSync(probe);
  row('ok', 'الكتابة في data/', 'مسموحة.');
} catch (e) {
  row('fail', 'الكتابة في data/', `ممنوعة: ${e.message}
     صحّح الأذونات: chmod 755 data`);
}

// ——— ٤) WAL على نظام الملفات هذا ———
// WAL يحتاج ذاكرة مشتركة، وبعض أنظمة الملفات الشبكية على الاستضافات
// المشتركة لا تدعمها. نجرّبها هنا بدل أن نكتشفها عند أول كتابة حقيقية.
if (sqliteOk) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const f = join(dataDir, '.doctor-wal.db');
    const d = new DatabaseSync(f);
    d.exec('PRAGMA journal_mode = WAL');
    const mode = d.prepare('PRAGMA journal_mode').get();
    d.exec('CREATE TABLE IF NOT EXISTS t(a)');
    d.prepare('INSERT INTO t VALUES(?)').run(1);
    d.close();
    for (const ext of ['', '-wal', '-shm']) { try { unlinkSync(f + ext); } catch {} }
    const m = String(mode && (mode.journal_mode || mode['journal_mode'])).toLowerCase();
    if (m === 'wal') row('ok', 'وضع WAL', 'مدعوم.');
    else row('warn', 'وضع WAL', `غير مدعوم هنا (الوضع: ${m}). النظام سيعمل، لكن اضبط MKSS_JOURNAL=DELETE لتجنّب تحذيرات.`);
  } catch (e) {
    row('warn', 'وضع WAL', `تعذّر اختباره: ${e.message}`);
  }
}

// ——— ٥) الاستماع على منفذ ———
const net = require('node:net');
const srv = net.createServer();
srv.once('error', (e) => {
  row('warn', 'الاستماع على منفذ', `تعذّر: ${e.code}. تحت Passenger هذا طبيعي — المحمّل يتولّى الربط.`);
  finish();
});
srv.once('listening', () => {
  row('ok', 'الاستماع على منفذ', `متاح (${srv.address().port}).`);
  srv.close(finish);
});
srv.listen(0, '127.0.0.1');

// ——— ٦) بيئة Passenger ———
const passenger = Boolean(
  process.env.PASSENGER_APP_ENV || process.env.PASSENGER_BASE_URI || typeof globalThis.PhusionPassenger !== 'undefined'
);

function finish() {
  row('info', 'البيئة', `${os.platform()} · ${os.arch()} · ${passenger ? 'داخل Passenger' : 'طرفية عادية'}`);

  if (!process.env.BASE_URL) {
    row('warn', 'BASE_URL', `غير مضبوط. اضبطه على عنوان موقعك بـ https حتى تعمل كوكيز الجلسة بأمان:
     BASE_URL=https://example.com`);
  } else {
    const https = String(process.env.BASE_URL).startsWith('https:');
    row(https ? 'ok' : 'warn', 'BASE_URL', https ? process.env.BASE_URL : `${process.env.BASE_URL} — بلا https لن تُرسل الكوكيز بعلامة Secure.`);
  }
  if (process.env.TRUST_PROXY !== '1') {
    row('warn', 'TRUST_PROXY', 'غير مضبوط. خلف Apache في cPanel اضبطه على 1 وإلا سُجّل عنوان الخادم مكان عنوان الزائر.');
  } else {
    row('ok', 'TRUST_PROXY', 'مضبوط.');
  }

  const glyph = { ok: '✓', warn: '!', fail: '✗', info: '·' };
  const line = '─'.repeat(64);
  console.log(`\n${line}\n  فحص الاستضافة — Support VIP System\n${line}`);
  for (const r of rows) {
    console.log(`  ${glyph[r.state]} ${r.title}`);
    if (r.detail) console.log(`     ${r.detail}`);
  }
  console.log(line);
  if (fatal) {
    console.log(`  ✗ ${fatal} مانع تشغيل. النظام لن يعمل قبل حلّها.`);
  } else if (warn) {
    console.log(`  ! جاهز، مع ${warn} تنبيهًا يُستحسن ضبطها.`);
  } else {
    console.log('  ✓ الاستضافة جاهزة بالكامل.');
  }
  console.log(`${line}\n`);
  process.exit(fatal ? 1 : 0);
}
