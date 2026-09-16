-- إيصال التحويل: العميل يرفع صورة الشاشة بدل أن ينسخ كودًا ويكتبه في خانة
-- ملاحظات التحويل. الكود كان يفترض أن العميل يفتح تطبيق البنك وتطبيقنا معًا
-- ويطابق بينهما — وهو أطول طريق لأبسط فعل، ويكفي أن ينساه ليضيع المطابقة.
--
-- الملفّ لا يُخزَّن في القاعدة: يُكتب في ‎data/uploads/‎ باسم عشوائي، ويبقى هنا
-- اسمُه ونوعه وحجمه. صفٌّ يُحذف مع العميل، وملفٌّ يُنظَّف بجواره.
ALTER TABLE payment_claims ADD COLUMN receipt_name  TEXT;
ALTER TABLE payment_claims ADD COLUMN receipt_type  TEXT;
ALTER TABLE payment_claims ADD COLUMN receipt_bytes INTEGER;

