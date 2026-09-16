#!/usr/bin/env node
// دورة مراقبة واحدة ثم خروج — هذا ما يشغّله كرون cPanel.
//
// لماذا كرون لا مؤقّت داخل التطبيق: Passenger (الذي تشغّل به cPanel تطبيقات
// Node) يوقف التطبيق عند الخمول. مؤقّتٌ داخله يموت مع أول فترة هدوء، فتتوقّف
// المراقبة بلا أن يدري أحد — ويبقى العميل يرى آخر فحص وكأنه الآن.
// عمليةٌ مستقلّة تقوم وتموت كل خمس دقائق لا يوقفها خمول.
//
// الجدولة في cPanel → Cron Jobs:
//     */5 * * * *  cd ~/mkss && /home/USER/nodevenv/mkss/22/bin/node cron/check.js >> data/cron.log 2>&1
//
// (استبدل المسار بمسار Node الذي تعرضه لك لوحة «Setup Node.js App».)
import '../src/require-node.js';
import { migrate } from '../src/migrations.js';
import { setting, nowISO, db, get } from '../src/db.js';
import { purgeExpiredSessions } from '../src/auth.js';
import * as monitor from '../src/monitor.js';

// دورة واحدة تفحص خمسة مواقع فقط (سقف التوازي). داخل التطبيق كان ذلك يكفي
// لأن الدورة تتكرّر كل ثلاثين ثانية؛ أما هنا فالتشغيل واحد كل خمس دقائق،
// فلو اكتفينا بدورة واحدة بقي من له أكثر من خمسة مواقع بلا فحص إلى الأبد.
// نستنزف المستحقّ حتى يفرغ، بسقف زمني يمنع تراكب التشغيلات.
const DRAIN_BUDGET_MS = Number(process.env.CRON_BUDGET_MS || 4 * 60_000);
const MAX_ROUNDS = 40;

const started = Date.now();

// قفل بسيط: دورة سابقة لم تنتهِ بعد يجب ألّا تتزامن مع هذه. موقعٌ بطيء قد
// يمدّ الدورة فوق خمس دقائق، فيتراكب تشغيلان ويُسجَّل الفحص مرتين.
const LOCK_KEY = 'cron_lock_until';
const LOCK_MS = 10 * 60_000;

function acquireLock() {
  const until = setting(LOCK_KEY);
  if (until && until > nowISO()) return false;
  setting(LOCK_KEY, new Date(Date.now() + LOCK_MS).toISOString());
  return true;
}
const releaseLock = () => setting(LOCK_KEY, nowISO());

async function main() {
  migrate({ quiet: true });

  if (!acquireLock()) {
    console.log(`[${nowISO()}] دورة سابقة ما زالت تعمل — تخطّينا هذه.`);
    return;
  }

  try {
    let checked = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (Date.now() - started > DRAIN_BUDGET_MS) {
        console.warn(`[${nowISO()}] نفدت المهلة وبقيت مواقع مستحقّة — ستُفحص في الدورة التالية.`);
        break;
      }
      if (!monitor.dueSites(1).length) break;
      const r = await monitor.tick();
      const n = r?.checked?.length || 0;
      if (!n) break;          // لا تقدّم: نتوقّف بدل الدوران بلا طائل
      checked += n;
    }

    // التجميع اليومي: أول تشغيل بعد منتصف الليل يكفي
    const last = setting('last_rollup_at');
    if (!last || last.slice(0, 10) < nowISO().slice(0, 10)) {
      monitor.rollupAndPrune();
      // تنظيف الجلسات المنتهية. الدالة كانت مكتوبة منذ البداية ولا يستدعيها
      // أحد: كل دخول يترك صفًّا لا يُحذف أبدًا، فينمو الجدول بلا سقف على
      // تنصيب يعمل شهورًا. هنا مكانها الطبيعي — مهمة دورية خارج مسار الطلب.
      const before = get('SELECT COUNT(*) AS n FROM sessions')?.n || 0;
      purgeExpiredSessions();
      const after = get('SELECT COUNT(*) AS n FROM sessions')?.n || 0;
      if (before !== after) console.log(`[${nowISO()}] حُذفت ${before - after} جلسة منتهية.`);
    }

    console.log(`[${nowISO()}] فُحص ${checked} موقعًا في ${Date.now() - started}ms`);
  } finally {
    releaseLock();
  }
}

main()
  .catch((e) => {
    // الخروج بحالة غير صفرية يجعل كرون يرسل لك بريدًا بالخطأ بدل أن يبتلعه
    console.error(`[${nowISO()}] فشلت دورة المراقبة:`, e?.stack || e);
    process.exitCode = 1;
  })
  .finally(() => {
    try { db.close(); } catch { /* أُغلقت بالفعل */ }
  });
