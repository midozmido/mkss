# فريق تصميم المواقع الاحترافي — Professional Web Design Team

نظام مهارات (Claude Code Skills) يحوّل كل طلب تصميم أو تخطيط موقع إلى عمل فريق من 5 خبراء عالميين، بمخرجات Production-Ready.

## بنية المهارات

كل مهارة في ملف منفصل داخل `.claude/skills/`:

| المهارة | الدور |
|---|---|
| [`web-design-team`](.claude/skills/web-design-team/SKILL.md) | المنسّق الرئيسي: أسئلة الاكتشاف → عمل الفريق → التقرير الاحترافي (24 قسمًا) |
| [`ux-ui-strategist`](.claude/skills/ux-ui-strategist/SKILL.md) | Agent 1 — تجربة المستخدم، الـ Layout، رحلة المستخدم، هيكل الصفحات |
| [`web-design-specialist`](.claude/skills/web-design-specialist/SKILL.md) | Agent 2 — أنواع المواقع، الـ Style، الترندات، نظام التصميم الكامل |
| [`motion-designer`](.claude/skills/motion-designer/SKILL.md) | Agent 3 — استراتيجية الحركة والـ Motion Map (قرار، لا تنفيذ) |
| [`performance-reviewer`](.claude/skills/performance-reviewer/SKILL.md) | Agent 4 — المراجعة التقنية: أداء، SEO، Accessibility، أمان، توسع |
| [`creative-director`](.claude/skills/creative-director/SKILL.md) | Agent 5 — الفكرة، الإحساس، الهوية البصرية، الأسلوب الإبداعي |

## كيف يعمل النظام

1. **الاكتشاف أولًا**: عند أي طلب موقع ("أريد موقع لشركة عقارات")، لا يبدأ التصميم قبل طرح كل أسئلة الفهم (النشاط، الجمهور، البراند، المحتوى، التصميم، الحركة، الأداء).
2. **عمل الفريق**: يمر المشروع على الخبراء الخمسة بالترتيب، ولخبير الأداء حق النقض على أي قرار يضر بالتجربة أو السرعة.
3. **التقرير النهائي**: 24 قسمًا تغطي كل شيء من الـ Site Map والـ Wireframe حتى الأخطاء المتوقعة وبدائل كل قرار.

## منع التضارب مع المهارات الأخرى

هذه المهارات هي طبقة **استراتيجية وتخطيط ومراجعة**، وتتكامل مع مهارات التنفيذ دون تكرار:

- **gsap-pro / gsap-core / gsap-performance** → تنفيذ كود الأنيميشن (خبير الحركة يقرر "ماذا ولماذا"، وGSAP تنفذ "كيف").
- **laft-brand** → المرجع النهائي لهوية مشاريع "لافت" (ألوان، خطوط، أسلوب).
- **frontend-design** → البناء الفعلي للواجهات بشكل مميز غير قالبي.
- **dataviz** → أي Charts أو Dashboards داخل الموقع.
