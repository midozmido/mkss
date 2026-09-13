// فحص شهادة SSL — node:tls مباشرة، بدون أي خدمة خارجية
import tls from 'node:tls';
import { URL } from 'node:url';

const DAY = 86400_000;

/**
 * يفتح اتصال TLS ويقرأ الشهادة كما يقرأها المتصفح.
 * يرجع: صلاحية، أيام متبقية، المُصدِر، أسماء الدومينات المغطاة، الإصدار.
 */
export function inspectTLS(urlStr, { timeout = 12000 } = {}) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch {
      return resolve({ applicable: false, reason: 'رابط غير صالح' });
    }
    if (url.protocol !== 'https:') {
      return resolve({
        applicable: false,
        reason: 'الموقع يعمل على HTTP بدون تشفير',
        insecureHttp: true,
      });
    }

    const port = Number(url.port) || 443;
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(v);
    };

    const socket = tls.connect(
      {
        host: url.hostname,
        port,
        servername: url.hostname,   // SNI — ضروري للاستضافة المشتركة
        rejectUnauthorized: false,  // نقيّم بأنفسنا بدل ما نفشل
        timeout,
      },
      () => {
        const cert = socket.getPeerCertificate(false);
        const authorized = socket.authorized;
        const authError = socket.authorizationError;

        if (!cert || !cert.valid_to) {
          return done({
            applicable: true,
            valid: false,
            reason: 'لم نستطع قراءة الشهادة',
          });
        }

        const validTo = new Date(cert.valid_to);
        const validFrom = new Date(cert.valid_from);
        const now = Date.now();
        const daysLeft = Math.floor((validTo.getTime() - now) / DAY);
        const notYetValid = validFrom.getTime() > now;
        const expired = validTo.getTime() < now;

        const names = [];
        if (cert.subject?.CN) names.push(cert.subject.CN);
        if (cert.subjectaltname) {
          for (const part of cert.subjectaltname.split(',')) {
            const n = part.trim().replace(/^DNS:/, '');
            if (n && !names.includes(n)) names.push(n);
          }
        }

        done({
          applicable: true,
          valid: Boolean(authorized) && !expired && !notYetValid,
          authorized: Boolean(authorized),
          authError: authError ? translateAuthError(authError) : null,
          expired,
          notYetValid,
          daysLeft,
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
          issuer: cert.issuer?.O || cert.issuer?.CN || 'غير معروف',
          subject: cert.subject?.CN || url.hostname,
          names: names.slice(0, 12),
          coversHost: hostCovered(url.hostname, names),
          protocol: socket.getProtocol(),
          cipher: socket.getCipher()?.name || null,
          keyBits: cert.bits || null,
        });
      }
    );

    socket.on('timeout', () => done({ applicable: true, valid: false, reason: 'انتهت مهلة اتصال TLS' }));
    socket.on('error', (e) =>
      done({ applicable: true, valid: false, reason: translateAuthError(e.code || e.message) })
    );
  });
}

/** هل الشهادة فعلًا بتغطي الدومين ده؟ (مع دعم الـ wildcard) */
function hostCovered(host, names) {
  const h = host.toLowerCase();
  return names.some((raw) => {
    const n = String(raw).toLowerCase();
    if (n === h) return true;
    if (n.startsWith('*.')) {
      const base = n.slice(2);
      // الـ wildcard يغطي مستوى واحد فقط
      return h.endsWith('.' + base) && h.slice(0, -(base.length + 1)).indexOf('.') === -1;
    }
    return false;
  });
}

function translateAuthError(code) {
  const map = {
    CERT_HAS_EXPIRED: 'الشهادة منتهية الصلاحية',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'الشهادة موقّعة ذاتيًا وغير موثوقة',
    SELF_SIGNED_CERT_IN_CHAIN: 'سلسلة الشهادة تحتوي شهادة موقّعة ذاتيًا',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'تعذر التحقق من سلسلة الشهادة (شهادة وسيطة ناقصة)',
    ERR_TLS_CERT_ALTNAME_INVALID: 'الشهادة لا تغطي اسم الدومين',
    CERT_NOT_YET_VALID: 'الشهادة لم تبدأ صلاحيتها بعد',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'تعذر الوصول لشهادة الجهة المُصدِرة',
    ECONNREFUSED: 'السيرفر رفض اتصال TLS على المنفذ 443',
    ETIMEDOUT: 'انتهت مهلة اتصال TLS',
  };
  return map[code] || code || 'خطأ في TLS';
}

/** تصنيف حالة الشهادة لعرضها للعميل */
export function tlsVerdict(t) {
  if (!t?.applicable) {
    return t?.insecureHttp
      ? { level: 'critical', label: 'بدون شهادة SSL', note: 'الموقع يعمل على HTTP — بيانات الزوار غير مشفّرة' }
      : { level: 'unknown', label: 'غير متاح', note: t?.reason || '' };
  }
  if (!t.valid) {
    return {
      level: 'critical',
      label: 'شهادة غير صالحة',
      note: t.authError || t.reason || 'المتصفح هيعرض تحذير أمان للزوار',
    };
  }
  if (!t.coversHost) {
    return { level: 'critical', label: 'الشهادة لا تغطي الدومين', note: 'المتصفح هيعرض تحذير للزوار' };
  }
  if (t.daysLeft <= 0) return { level: 'critical', label: 'منتهية', note: 'جدّد الشهادة فورًا' };
  if (t.daysLeft <= 7) return { level: 'critical', label: `تنتهي خلال ${t.daysLeft} يوم`, note: 'التجديد عاجل' };
  if (t.daysLeft <= 21) return { level: 'warn', label: `تنتهي خلال ${t.daysLeft} يوم`, note: 'قرّب موعد التجديد' };
  return { level: 'ok', label: `صالحة — ${t.daysLeft} يوم متبقي`, note: `صادرة من ${t.issuer}` };
}
