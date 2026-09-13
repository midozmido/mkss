// محرك المراقبة — الجدولة، تأكيد الأعطال، سجل الفجوات، التجميع اليومي.
//
// المبدأ الحاكم: **الإنذار الكاذب أسوأ من غياب الإنذار.** عميل يتلقى رسالة
// "موقعك وقع" وهو شغّال، يفقد الثقة في النظام كله. لذلك لا يُعلَن أي عطل
// قبل تأكيده مرتين، وقبل التأكد أن المشكلة ليست في اتصالنا نحن.
import net from 'node:net';
import { promises as dnsp } from 'node:dns';
import { all, get, run, nowISO, setting } from './db.js';
import { runCheck, toCheckRow } from './checks/run.js';
import * as support from './support.js';

const TICK_MS = 30_000;          // كل نصف دقيقة نسأل: مين مستحق للفحص؟
const MAX_CONCURRENT = 5;        // سقف الفحوصات المتوازية
const RETRY_AFTER_FAIL_MS = 60_000;  // إعادة المحاولة بعد أول فشل
const CONFIRM_FAILURES = 2;      // عدد الفشل المتتالي قبل إعلان العطل
const FLAP_WINDOW_MS = 5 * 60_000;   // عطل جديد خلال 5 دقائق = نفس العطل
const GAP_FACTOR = 2.5;          // فجوة = آخر فحص أقدم من 2.5 × الفترة

let timer = null;
let running = false;
const inFlight = new Set();

// ——————————————————— كشف انقطاع اتصالنا نحن ———————————————————

/**
 * هل المشكلة عندنا لا عند العميل؟
 * فحصان مستقلان: تحليل DNS + اتصال TCP خام. لا يعتمدان على أي خدمة أو مفتاح.
 */
export async function networkLooksDown({ timeout = 5000 } = {}) {
  const dnsOk = await Promise.race([
    dnsp.resolve4('cloudflare.com').then(() => true).catch(() => false),
    new Promise((r) => setTimeout(() => r(false), timeout)),
  ]);
  if (dnsOk) return false;

  const tcpOk = await new Promise((resolve) => {
    const s = net.connect({ host: '1.1.1.1', port: 443, timeout });
    const done = (v) => { try { s.destroy(); } catch {} resolve(v); };
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
    s.on('timeout', () => done(false));
  });
  return !tcpOk;
}

// ——————————————————— فجوات المراقبة ———————————————————

/**
 * تُستدعى عند الإقلاع: لو آخر فحص أقدم بكثير مما ينبغي، فقد توقفنا عن المراقبة.
 * نسجّل الفترة صراحة كفجوة، ولا نحسبها وقت تشغيل في أي تقرير.
 */
export function recordStartupGap(reason = 'restart') {
  const last = get('SELECT MAX(at) AS at FROM checks');
  if (!last?.at) return null;

  const shortest = get('SELECT MIN(interval_sec) AS s FROM sites WHERE active = 1')?.s || 300;
  const elapsedMs = Date.now() - new Date(last.at).getTime();
  if (elapsedMs <= shortest * 1000 * GAP_FACTOR) return null;

  const r = run(
    'INSERT INTO monitor_gaps(started_at, ended_at, reason) VALUES(?,?,?)',
    last.at,
    nowISO(),
    reason
  );
  const minutes = Math.round(elapsedMs / 60000);
  console.log(`  ⚠ فجوة مراقبة ${minutes} دقيقة سُجّلت — لن تُحسب وقت تشغيل`);
  return { id: Number(r.lastInsertRowid), minutes };
}

export function recordGap(startedAt, endedAt, reason = 'network') {
  run('INSERT INTO monitor_gaps(started_at, ended_at, reason) VALUES(?,?,?)', startedAt, endedAt, reason);
}

// ——————————————————— دورة حياة العطل ———————————————————

function openIncident(siteId, kind, detail, severity = 'major') {
  // منع الرفرفة: عطل من نفس النوع أُغلق قبل قليل — نعيد فتحه بدل إنشاء عطل جديد
  const recent = get(
    `SELECT * FROM incidents
      WHERE site_id = ? AND kind = ? AND resolved = 1 AND ended_at >= ?
      ORDER BY ended_at DESC LIMIT 1`,
    siteId,
    kind,
    new Date(Date.now() - FLAP_WINDOW_MS).toISOString()
  );
  if (recent) {
    run('UPDATE incidents SET resolved = 0, ended_at = NULL, detail = ? WHERE id = ?', detail, recent.id);
    return { id: recent.id, reopened: true };
  }

  const open = get('SELECT id FROM incidents WHERE site_id = ? AND kind = ? AND resolved = 0', siteId, kind);
  if (open) return { id: open.id, existing: true };

  const r = run(
    'INSERT INTO incidents(site_id, kind, severity, detail, started_at) VALUES(?,?,?,?,?)',
    siteId,
    kind,
    severity,
    detail,
    nowISO()
  );
  return { id: Number(r.lastInsertRowid), opened: true };
}

function resolveIncidents(siteId, kinds) {
  const now = nowISO();
  for (const kind of kinds) {
    run(
      'UPDATE incidents SET resolved = 1, ended_at = ? WHERE site_id = ? AND kind = ? AND resolved = 0',
      now,
      siteId,
      kind
    );
  }
}

// ——————————————————— فحص موقع واحد ———————————————————

export async function checkSite(site, { allowPrivate = false, networkCheck = networkLooksDown } = {}) {
  const result = await runCheck(site.url, { allowPrivate });
  const row = toCheckRow(site.id, result);

  run(
    `INSERT INTO checks(site_id, at, ok, status_code, response_ms, ttfb_ms, page_bytes, redirects,
                        final_url, error, dns_ok, dns_ms, ssl_valid, ssl_days_left, ssl_issuer,
                        sec_score, health_score, platform, detail)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    row.site_id, row.at, row.ok, row.status_code, row.response_ms, row.ttfb_ms, row.page_bytes,
    row.redirects, row.final_url, row.error, row.dns_ok, row.dns_ms, row.ssl_valid,
    row.ssl_days_left, row.ssl_issuer, row.sec_score, row.health_score, row.platform, row.detail
  );

  // تحديث المنصة المكتشفة على الموقع نفسه
  const p = result.fingerprint?.platform;
  if (p) {
    run(
      `UPDATE sites SET platform = ?, platform_version = ?, platform_confidence = ?,
                        platform_extras = ?, platform_checked_at = ?
        WHERE id = ?`,
      p.key,
      p.version,
      p.confidence,
      JSON.stringify({
        addons: result.fingerprint.addons,
        extras: result.fingerprint.extras,
        cdn: result.fingerprint.cdn,
        server: result.fingerprint.server,
      }),
      row.at,
      site.id
    );
  }

  const failed = !result.ok;
  let declared = null;

  if (failed) {
    const failures = (site.consecutive_failures || 0) + 1;
    run('UPDATE sites SET consecutive_failures = ? WHERE id = ?', failures, site.id);

    if (failures >= CONFIRM_FAILURES) {
      // قبل إعلان العطل على العميل: هل المشكلة في اتصالنا نحن؟
      const ourFault = await networkCheck();
      if (ourFault) {
        recordGap(new Date(Date.now() - RETRY_AFTER_FAIL_MS).toISOString(), nowISO(), 'network');
        console.log(`  ⚠ ${site.name}: فشل الفحص لكن اتصالنا نحن منقطع — لا يُعلن عطل`);
      } else {
        declared = openIncident(
          site.id,
          result.blocked ? 'blocked' : result.status >= 500 ? 'server_error' : 'down',
          result.error || `كود ${result.status}`,
          'major'
        );
      }
    }
  } else {
    if (site.consecutive_failures) run('UPDATE sites SET consecutive_failures = 0 WHERE id = ?', site.id);
    const hadOpen = get(
      "SELECT id FROM incidents WHERE site_id = ? AND resolved = 0 AND kind IN ('down','server_error','blocked')",
      site.id
    );
    resolveIncidents(site.id, ['down', 'server_error', 'blocked']);
    // العميل يستحق أن يعرف بالعودة كما عرف بالعطل
    if (hadOpen) { try { support.proactiveRecovered(site); } catch { /* لا نُفشل الفحص */ } }
  }

  // أعطال الشهادة مستقلة عن التشغيل — موقع شغّال بشهادة منتهية ما زال معطوبًا
  if (result.tls?.applicable && result.tls.verdict?.level === 'critical') {
    openIncident(site.id, 'ssl', result.tls.verdict.label, 'major');
  } else if (result.ok) {
    resolveIncidents(site.id, ['ssl']);
  }

  // رسائل سامي الاستباقية — لا تُفشل الفحص إن تعذّرت
  try { support.proactiveForCheck(site, result); } catch { /* تجاهل */ }

  // الفحص التالي: أقرب عند الفشل الأول لتأكيده بسرعة
  const nextMs = failed && (site.consecutive_failures || 0) + 1 < CONFIRM_FAILURES
    ? RETRY_AFTER_FAIL_MS
    : site.interval_sec * 1000 + jitter(site.interval_sec);

  run(
    'UPDATE sites SET last_checked_at = ?, next_check_at = ? WHERE id = ?',
    row.at,
    new Date(Date.now() + nextMs).toISOString(),
    site.id
  );

  return { result, declared };
}

/** توزيع عشوائي ±10% حتى لا تتكدس كل الفحوصات في نفس اللحظة */
function jitter(intervalSec) {
  const span = intervalSec * 1000 * 0.1;
  return Math.floor((Math.random() * 2 - 1) * span);
}

// ——————————————————— الدورة ———————————————————

export function dueSites(limit = MAX_CONCURRENT) {
  const now = nowISO();
  return all(
    `SELECT * FROM sites
      WHERE active = 1 AND (next_check_at IS NULL OR next_check_at <= ?)
      ORDER BY COALESCE(next_check_at, '') ASC
      LIMIT ?`,
    now,
    limit
  );
}

export async function tick(opts = {}) {
  if (running) return { skipped: true };
  running = true;
  const done = [];
  try {
    const sites = dueSites(MAX_CONCURRENT).filter((s) => !inFlight.has(s.id));
    await Promise.all(
      sites.map(async (site) => {
        inFlight.add(site.id);
        try {
          const r = await checkSite(site, opts);
          done.push({ site: site.name, score: r.result.health.score, ok: r.result.ok });
        } catch (e) {
          console.error(`  ✗ فشل فحص ${site.name}: ${e.message}`);
        } finally {
          inFlight.delete(site.id);
        }
      })
    );
  } finally {
    running = false;
  }
  return { checked: done };
}

// ——————————————————— التجميع اليومي ———————————————————

/** يجمّع فحوصات الأيام المنتهية ثم يحذف الصفوف القديمة — يمنع تضخّم الجدول */
export function rollupAndPrune({ keepDays = 30 } = {}) {
  const cutoff = new Date(Date.now() - keepDays * 86400_000).toISOString();
  const day = cutoff.slice(0, 10);

  run(
    `INSERT INTO checks_daily(site_id, day, checks, ok_checks, avg_ms, max_ms, min_health, avg_health)
     SELECT site_id, substr(at, 1, 10), COUNT(*), SUM(ok),
            CAST(AVG(response_ms) AS INTEGER), MAX(response_ms),
            MIN(health_score), CAST(AVG(health_score) AS INTEGER)
       FROM checks WHERE at < ?
      GROUP BY site_id, substr(at, 1, 10)
     ON CONFLICT(site_id, day) DO UPDATE SET
       checks = excluded.checks, ok_checks = excluded.ok_checks, avg_ms = excluded.avg_ms,
       max_ms = excluded.max_ms, min_health = excluded.min_health, avg_health = excluded.avg_health`,
    cutoff
  );
  const r = run('DELETE FROM checks WHERE at < ?', cutoff);
  setting('last_rollup_at', nowISO());
  return { prunedBefore: day, deleted: r.changes };
}

// ——————————————————— التشغيل ———————————————————

export function start(opts = {}) {
  recordStartupGap('restart');
  console.log('▶ المراقب يعمل — دورة كل 30 ثانية');
  tick(opts);
  timer = setInterval(() => {
    tick(opts);
    // تجميع يومي عند أول دورة بعد منتصف الليل
    const lastRollup = setting('last_rollup_at');
    if (!lastRollup || lastRollup.slice(0, 10) < nowISO().slice(0, 10)) rollupAndPrune();
  }, TICK_MS);
  if (timer.unref) timer.unref();
  return timer;
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

export { TICK_MS, CONFIRM_FAILURES, FLAP_WINDOW_MS };
