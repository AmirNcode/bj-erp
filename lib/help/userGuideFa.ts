// Persian user guide (employee + manager), from the 2026-10-31 SOP. Screenshots use demo data.
// Trusted static markup, rendered by app/[locale]/(app)/help/user-guide; styles: .help-guide in app/globals.css.

export const USER_GUIDE_TOC: { id: string; level: 2 | 3; text: string }[] = [
  {
    "id": "s1",
    "level": 2,
    "text": "۱. هدف، دامنه و تعاریف"
  },
  {
    "id": "s2",
    "level": 2,
    "text": "۲. نقش‌ها و مسئولیت‌ها"
  },
  {
    "id": "s3",
    "level": 2,
    "text": "۳. شروع کار"
  },
  {
    "id": "s3-1",
    "level": 3,
    "text": "۳٫۱ ورود به سامانه"
  },
  {
    "id": "s3-2",
    "level": 3,
    "text": "۳٫۲ انتخاب رمز شخصی (ورود اول)"
  },
  {
    "id": "s3-3",
    "level": 3,
    "text": "۳٫۳ نصب روی صفحه اصلی گوشی"
  },
  {
    "id": "s4",
    "level": 2,
    "text": "۴. راهنمای کارمند"
  },
  {
    "id": "s4-1",
    "level": 3,
    "text": "۴٫۱ صفحه خانه و نوار پایین"
  },
  {
    "id": "s4-2",
    "level": 3,
    "text": "۴٫۲ ذخیره امضا (یک بار برای همیشه)"
  },
  {
    "id": "s4-3",
    "level": 3,
    "text": "۴٫۳ ثبت مرخصی روزانه"
  },
  {
    "id": "s4-4",
    "level": 3,
    "text": "۴٫۴ ثبت مرخصی ساعتی"
  },
  {
    "id": "s4-5",
    "level": 3,
    "text": "۴٫۵ ثبت ماموریت ساعتی"
  },
  {
    "id": "s4-6",
    "level": 3,
    "text": "۴٫۶ ثبت ماموریت روزانه"
  },
  {
    "id": "s4-7",
    "level": 3,
    "text": "۴٫۷ پیگیری، نتیجه و لغو درخواست"
  },
  {
    "id": "s4-8",
    "level": 3,
    "text": "۴٫۸ تقویم، پروفایل و نمودار سازمانی"
  },
  {
    "id": "s5",
    "level": 2,
    "text": "۵. راهنمای مدیر"
  },
  {
    "id": "s5-1",
    "level": 3,
    "text": "۵٫۱ صفحه خانه مدیر"
  },
  {
    "id": "s5-2",
    "level": 3,
    "text": "۵٫۲ صف تأیید درخواست‌ها"
  },
  {
    "id": "s5-3",
    "level": 3,
    "text": "۵٫۳ تأیید درخواست"
  },
  {
    "id": "s5-4",
    "level": 3,
    "text": "۵٫۴ رد درخواست"
  },
  {
    "id": "s5-5",
    "level": 3,
    "text": "۵٫۵ کارکنان زیرمجموعه و تقویم تیم"
  },
  {
    "id": "s6",
    "level": 2,
    "text": "۶. سؤالات متداول و رفع اشکال"
  }
];

export const USER_GUIDE_HTML = `
<div class="note"><b>راهنمای خواندن تصاویر:</b> در هر تصویر، بخش‌های مهم با کادر قرمز و یک <b>شماره</b> مشخص شده‌اند. توضیح هر شماره در فهرست کنار همان تصویر آمده است. تصاویر از نسخه گوشی گرفته شده‌اند؛ روی رایانه همین بخش‌ها در منوی کناری دیده می‌شوند. نام‌ها و داده‌های تصاویر نمونه‌اند.</div>

<section class="chapter">
  <h2 id="s1">۱. هدف، دامنه و تعاریف</h2>
  <h3 id="s1-1">هدف</h3>
  <p>این دستورالعمل روش ثبت، پیگیری و تأیید درخواست‌های مرخصی و ماموریت را در سامانه منابع انسانی شرح می‌دهد. با این سامانه، فرم کاغذی مرخصی کنار گذاشته می‌شود و همه مراحل — از درخواست کارمند تا امضای مدیر — روی گوشی یا رایانه انجام می‌شود.</p>
  <h3 id="s1-2">دامنه</h3>
  <p>این سند برای همه <b>کارکنان</b> (ثبت درخواست) و <b>مدیران و سرپرستان</b> (بررسی و تأیید درخواست کارکنان زیرمجموعه) است. وظایف منابع انسانی و مدیر سیستم در سند جداگانه‌ای آمده است.</p>
  <h3 id="s1-3">تعاریف</h3>
  <table class="grid">
    <tr><th style="width:28%">اصطلاح</th><th>معنی</th></tr>
    <tr><td>کد پرسنلی</td><td>شماره‌ای که با آن وارد سامانه می‌شوید (همان شماره پرسنلی شما).</td></tr>
    <tr><td>مرخصی روزانه</td><td>مرخصی یک یا چند روز کامل. انواع: استحقاقی، استعلاجی، بدون حقوق.</td></tr>
    <tr><td>مرخصی ساعتی</td><td>مرخصی کمتر از یک روز؛ حداکثر ۴ ساعت در روز و فقط یک بار در هر روز.</td></tr>
    <tr><td>ماموریت ساعتی / روزانه</td><td>خروج از محل کار برای کار اداری. <b>از مانده مرخصی کم نمی‌شود.</b></td></tr>
    <tr><td>مانده مرخصی</td><td>مقدار مرخصی باقی‌مانده هر نوع، به روز و ساعت.</td></tr>
    <tr><td>جانشین</td><td>همکاری از واحد خودتان که در نبود شما کارتان را انجام می‌دهد (اختیاری).</td></tr>
    <tr><td>مراحل تأیید</td><td>کسانی که باید درخواست را امضا کنند؛ معمولاً مدیر مستقیم، و بسته به تنظیمات شرکت مراحل بعدی (مثلاً مدیر واحد یا منابع انسانی).</td></tr>
    <tr><td>شماره پیگیری</td><td>شماره یکتای هر درخواست (مثل ۱۴۰۵-۰۰۰۱) برای پیگیری و بایگانی.</td></tr>
  </table>
  <h3 id="s1-4">وضعیت‌های درخواست</h3>
  <table class="grid">
    <tr><th style="width:28%">وضعیت</th><th>معنی</th></tr>
    <tr><td><span class="badge b-pend">در انتظار</span></td><td>ثبت شده و منتظر امضای یکی از مراحل تأیید است.</td></tr>
    <tr><td><span class="badge b-ok">تأیید شده</span></td><td>همه مراحل امضا کرده‌اند؛ مرخصی از مانده کم شده است.</td></tr>
    <tr><td><span class="badge b-no">رد شده</span></td><td>یکی از تأییدکنندگان رد کرده است؛ دلیل رد زیر درخواست نمایش داده می‌شود.</td></tr>
    <tr><td><span class="badge b-cancel">لغو شده</span></td><td>خود کارمند درخواست را لغو کرده است.</td></tr>
  </table>

  <h2 id="s2">۲. نقش‌ها و مسئولیت‌ها</h2>
  <table class="grid">
    <tr><th style="width:28%">نقش</th><th>مسئولیت در سامانه</th></tr>
    <tr><td>کارمند</td><td>ثبت به‌موقع درخواست مرخصی و ماموریت، امضای درخواست، پیگیری وضعیت، لغو درخواست‌هایی که دیگر لازم نیست، حفظ رمز عبور.</td></tr>
    <tr><td>مدیر / سرپرست</td><td>بررسی منظم صف تأیید (ترجیحاً روزانه)، تأیید با امضا یا رد با ذکر دلیل، توجه به حضور تیم در تقویم.</td></tr>
    <tr><td>منابع انسانی</td><td>تعریف کارکنان و صدور رمز اولیه، تنظیم مانده مرخصی، رسیدگی به فراموشی رمز و اصلاح اطلاعات شخصی.</td></tr>
  </table>
</section>

<section class="chapter">
  <h2 id="s3">۳. شروع کار</h2>

  <h3 id="s3-1"><span class="num">۳٫۱</span>ورود به سامانه</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e01-login.webp" alt="صفحه ورود" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">صفحه ورود</div></div>
    <div>
      <ol class="steps">
        <li>در مرورگر گوشی (Chrome یا Safari) نشانی <span class="ltr">bjeng.app</span> را باز کنید.</li>
        <li>کد پرسنلی و رمز عبوری را که از منابع انسانی گرفته‌اید وارد کنید.</li>
        <li>روی <b>ورود</b> بزنید.</li>
      </ol>
      <ol class="legend">
        <li><b class="n">۱</b><b>کد پرسنلی</b> — فقط شماره پرسنلی خودتان.</li>
        <li><b class="n">۲</b><b>رمز عبور</b> — به حروف بزرگ و کوچک انگلیسی حساس است.</li>
        <li><b class="n">۳</b>نماد چشم: رمز تایپ‌شده را نمایش می‌دهد تا اشتباه تایپی را ببینید.</li>
        <li><b class="n">۴</b>دکمه <b>ورود</b>.</li>
      </ol>
      <div class="tip"><b>نکته:</b> پس از یک بار ورود، سامانه شما را به خاطر می‌سپارد و لازم نیست هر بار رمز بزنید.</div>
    </div>
  </div>

  <h3 id="s3-2"><span class="num">۳٫۲</span>انتخاب رمز شخصی (ورود اول)</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e02-set-password.webp" alt="انتخاب رمز عبور شخصی" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">انتخاب رمز عبور شخصی</div></div>
    <div>
      <p>در اولین ورود، رمز موقت باید با رمزی که فقط خودتان می‌دانید عوض شود. تا این کار انجام نشود، بخش‌های دیگر سامانه باز نمی‌شوند.</p>
      <ol class="legend">
        <li><b class="n">۱</b><b>رمز عبور جدید</b> — حداقل ۸ نویسه، شامل حروف و اعداد انگلیسی.</li>
        <li><b class="n">۲</b><b>تکرار رمز عبور جدید</b> — دقیقاً همان رمز.</li>
        <li><b class="n">۳</b><b>ذخیره و ادامه</b> — پس از آن به صفحه خانه می‌روید.</li>
      </ol>
      <div class="warn"><b>مهم:</b> رمز خود را به هیچ‌کس، حتی همکار یا مدیر، ندهید. هر درخواستی که با حساب شما ثبت شود به نام شما امضا می‌شود.</div>
    </div>
  </div>

  <h3 id="s3-3"><span class="num">۳٫۳</span>نصب روی صفحه اصلی گوشی</h3>
  <p>سامانه مثل یک برنامه روی گوشی نصب می‌شود و با یک لمس باز می‌شود. نیازی به بازار یا اپ‌استور نیست.</p>
  <table class="grid">
    <tr><th style="width:30%">گوشی</th><th>مراحل</th></tr>
    <tr><td>اندروید (Chrome)</td><td>سامانه را باز کنید ← منوی سه‌نقطه <kbd>⋮</kbd> بالای صفحه ← <b>Install app</b> یا <b>Add to Home screen</b> (افزودن به صفحه اصلی) ← <b>Install</b>.</td></tr>
    <tr><td>آیفون (Safari)</td><td>سامانه را در <b>Safari</b> باز کنید ← دکمه اشتراک‌گذاری <kbd>⬆︎</kbd> پایین صفحه ← <b>Add to Home Screen</b> ← <b>Add</b>.</td></tr>
  </table>
  <div class="note"><b>تغییر زبان:</b> زبان پیش‌فرض فارسی است. برای انگلیسی از بخش پروفایل (بخش ۴٫۸) استفاده کنید.</div>
</section>

<section class="chapter">
  <h2 id="s4">۴. راهنمای کارمند</h2>

  <h3 id="s4-1"><span class="num">۴٫۱</span>صفحه خانه و نوار پایین</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e03-home.webp" alt="صفحه خانه" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">صفحه خانه</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b><b>یادآور پروفایل</b> — تا وقتی امضای خود را ذخیره نکرده‌اید نمایش داده می‌شود (بخش ۴٫۲).</li>
        <li><b class="n">۲</b>تاریخ امروز و خوشامدگویی با نام شما.</li>
        <li><b class="n">۳</b><b>درخواست‌های اخیر من</b> — آخرین درخواست‌ها و وضعیت هرکدام. «همه درخواست‌های من» فهرست کامل را باز می‌کند.</li>
      </ol>
      <p>پایین‌تر در همین صفحه، کارت <b>تیم من</b> مدیر و هم‌تیمی‌های شما و مرخصی‌های پیش‌روی آن‌ها را نشان می‌دهد.</p>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e05-home-balance.webp" alt="مانده مرخصی و تعطیلی بعدی" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">مانده مرخصی و تعطیلی بعدی</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b><b>مانده مرخصی من</b> — مانده هر نوع مرخصی (استحقاقی، استعلاجی). پس از تأیید هر مرخصی خودکار به‌روز می‌شود.</li>
        <li><b class="n">۲</b><b>تعطیلی رسمی بعدی</b> — نزدیک‌ترین تعطیل رسمی تقویم شرکت.</li>
      </ol>
      <div class="tip"><b>نکته:</b> اگر مانده شما با سوابق‌تان همخوان نیست، به منابع انسانی اطلاع دهید.</div>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e04-nav.webp" alt="نوار پایین صفحه" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">نوار پایین صفحه</div></div>
    <div>
      <p>نوار پایین در همه صفحه‌ها ثابت است:</p>
      <ol class="legend">
        <li><b class="n">۱</b><b>خانه</b> — خلاصه وضعیت شما.</li>
        <li><b class="n">۲</b><b>درخواست</b> — ثبت درخواست جدید و فهرست درخواست‌های من.</li>
        <li><b class="n">۳</b><b>تقویم</b> — مرخصی‌های تأییدشده تیم.</li>
        <li><b class="n">۴</b><b>پروفایل</b> — امضا، زبان، رمز عبور، خروج.</li>
      </ol>
      <div class="note">مدیران یک گزینه اضافه به نام <b>مدیریت</b> هم در این نوار دارند (فصل ۵).</div>
    </div>
  </div>

  <h3 id="s4-2"><span class="num">۴٫۲</span>ذخیره امضا (یک بار برای همیشه)</h3>
  <p>هر درخواست با امضای شما ثبت می‌شود. اگر امضا را یک بار در پروفایل ذخیره کنید، در فرم‌ها خودکار قرار می‌گیرد و فقط کافی است تأیید کنید.</p>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e06-signature-card.webp" alt="پروفایل ← امضای ذخیره‌شده" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">پروفایل ← امضای ذخیره‌شده</div></div>
    <div>
      <ol class="steps">
        <li>از نوار پایین به <b>پروفایل</b> بروید (یا روی «ذخیره امضا» در یادآور خانه بزنید).</li>
        <li>در کارت <b>امضای ذخیره‌شده</b> یکی از دو روش را انتخاب کنید:</li>
      </ol>
      <ol class="legend">
        <li><b class="n">۱</b><b>رسم امضا</b> — با انگشت روی صفحه امضا کنید.</li>
        <li><b class="n">۲</b><b>بارگذاری عکس</b> — عکس امضای خود روی کاغذ سفید را انتخاب کنید.</li>
      </ol>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e07-signature-draw.webp" alt="رسم امضا" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">رسم امضا</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b>کادر امضا — با انگشت امضا کنید. اگر خراب شد «پاک کردن» را بزنید.</li>
        <li><b class="n">۲</b><b>بعدی</b> — پیش‌نمایش امضا را نشان می‌دهد.</li>
      </ol>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e07b-signature-save.webp" alt="پیش‌نمایش و ذخیره" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">پیش‌نمایش و ذخیره</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b>پیش‌نمایش امضا.</li>
        <li><b class="n">۲</b><b>ذخیره</b> — امضا ذخیره می‌شود و یادآور صفحه خانه دیگر نمایش داده نمی‌شود.</li>
      </ol>
      <div class="note">هر زمان می‌توانید امضا را از همین کارت عوض یا حذف کنید.</div>
    </div>
  </div>

  <h3 id="s4-3"><span class="num">۴٫۳</span>ثبت مرخصی روزانه</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e08-request-page.webp" alt="صفحه درخواست" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">صفحه درخواست</div></div>
    <div>
      <p>از نوار پایین روی <b>درخواست</b> بزنید. این صفحه دو بخش بازشونده دارد:</p>
      <ol class="legend">
        <li><b class="n">۱</b><b>ثبت درخواست جدید</b> — فرم درخواست را باز می‌کند.</li>
        <li><b class="n">۲</b><b>درخواست‌های من</b> — همه درخواست‌های شما و وضعیت‌شان (بخش ۴٫۷).</li>
      </ol>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e09-daily-top.webp" alt="فرم مرخصی روزانه — بخش بالا" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">فرم مرخصی روزانه — بخش بالا</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b><b>نوع درخواست</b> — «مرخصی روزانه» را انتخاب کنید. سه گزینه دیگر: مرخصی ساعتی، ماموریت روزانه، ماموریت ساعتی.</li>
        <li><b class="n">۲</b><b>نوع مرخصی</b> — استحقاقی، استعلاجی یا بدون حقوق.</li>
        <li><b class="n">۳</b><b>تاریخ شروع</b> — روی کادر بزنید و روز اول مرخصی را از تقویم شمسی انتخاب کنید.</li>
        <li><b class="n">۴</b><b>تاریخ پایان</b> — آخرین روز مرخصی (برای یک روز، همان تاریخ شروع).</li>
      </ol>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e09b-daily-middle.webp" alt="جانشین، تاریخ بازگشت و دلیل" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">جانشین، تاریخ بازگشت و دلیل</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b><b>جانشین (اختیاری)</b> — همکاری از واحد خودتان. کسی که خودش در آن روزها مرخصی است در فهرست نیست. اگر جانشین ندارید «بدون جانشین» را بزنید.</li>
        <li><b class="n">۲</b><b>تاریخ بازگشت به کار</b> — سامانه خودش حساب می‌کند. آن را با برنامه خود مقایسه کنید.</li>
        <li><b class="n">۳</b><b>دلیل (اختیاری)</b> — توضیح کوتاه برای مدیر.</li>
      </ol>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e10-daily-bottom.webp" alt="امضا و ارسال" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">امضا و ارسال</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b><b>امضا</b> — اگر امضا را ذخیره کرده باشید خودکار قرار می‌گیرد؛ وگرنه با انگشت امضا کنید.</li>
        <li><b class="n">۲</b>تیک <b>«استفاده از امضای دیجیتال خود را … مجاز می‌دانم»</b> — بدون این تیک درخواست ثبت نمی‌شود.</li>
        <li><b class="n">۳</b><b>مدت درخواست</b> (فقط روزهای کاری) و <b>مانده مرخصی پس از این درخواست</b> — قبل از ارسال بررسی کنید.</li>
        <li><b class="n">۴</b><b>ارسال درخواست</b>.</li>
      </ol>
      <div class="warn"><b>خطاهای رایج:</b> «نوع مرخصی را انتخاب کنید» (بند ۲ تصویر قبل را انتخاب نکرده‌اید)؛ همپوشانی با درخواست قبلی خودتان؛ مانده ناکافی؛ بازه‌ای که فقط تعطیل است.</div>
    </div>
  </div>

  <h3 id="s4-4"><span class="num">۴٫۴</span>ثبت مرخصی ساعتی</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e12-hourly.webp" alt="فرم مرخصی ساعتی" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">فرم مرخصی ساعتی</div></div>
    <div>
      <ol class="steps"><li>در فرم درخواست، نوع درخواست را <b>مرخصی ساعتی</b> بگذارید.</li></ol>
      <ol class="legend">
        <li><b class="n">۱</b><b>نوع مرخصی</b> — استحقاقی یا بدون حقوق.</li>
        <li><b class="n">۲</b><b>تاریخ</b> — روز مرخصی.</li>
        <li><b class="n">۳</b><b>از ساعت</b>.</li>
        <li><b class="n">۴</b><b>الی ساعت</b>.</li>
      </ol>
      <p>سپس مانند مرخصی روزانه، جانشین و دلیل (اختیاری) را وارد کنید، امضا و تیک تأیید را بزنید و <b>ثبت درخواست ساعتی</b> را بزنید.</p>
      <div class="note"><b>قانون:</b> حداکثر ۴ ساعت در روز، و فقط یک مرخصی ساعتی در هر روز.</div>
    </div>
  </div>

  <h3 id="s4-5"><span class="num">۴٫۵</span>ثبت ماموریت ساعتی</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e13-errand.webp" alt="فرم ماموریت ساعتی" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">فرم ماموریت ساعتی</div></div>
    <div>
      <p>برای کار اداری بیرون از شرکت در بخشی از روز (مثلاً مراجعه به بانک یا اداره). ماموریت از مانده مرخصی کم نمی‌شود.</p>
      <ol class="legend">
        <li><b class="n">۱</b><b>تاریخ</b> ماموریت.</li>
        <li><b class="n">۲</b><b>ساعت خروج</b>.</li>
        <li><b class="n">۳</b><b>ساعت برگشت</b>.</li>
        <li><b class="n">۴</b><b>محل ماموریت</b> — الزامی است.</li>
      </ol>
      <p>شرح ماموریت اختیاری است. در پایان امضا، تیک تأیید و <b>ثبت درخواست ماموریت</b>.</p>
    </div>
  </div>

  <h3 id="s4-6"><span class="num">۴٫۶</span>ثبت ماموریت روزانه</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e14-daily-errand.webp" alt="فرم ماموریت روزانه" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">فرم ماموریت روزانه</div></div>
    <div>
      <p>برای ماموریت یا سفر کاری یک یا چند روز کامل.</p>
      <ol class="legend">
        <li><b class="n">۱</b><b>تاریخ شروع</b>.</li>
        <li><b class="n">۲</b><b>تاریخ پایان</b>.</li>
        <li><b class="n">۳</b><b>محل ماموریت یا سفر</b> — الزامی است.</li>
      </ol>
      <p>شرح اختیاری است. امضا، تیک تأیید و <b>ثبت ماموریت روزانه</b>.</p>
    </div>
  </div>

  <h3 id="s4-7"><span class="num">۴٫۷</span>پیگیری، نتیجه و لغو درخواست</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e11-my-requests.webp" alt="درخواست‌های من — در انتظار تأیید" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">درخواست‌های من — در انتظار تأیید</div></div>
    <div>
      <p>در صفحه <b>درخواست</b>، بخش <b>درخواست‌های من</b> را باز کنید. هر کارت یک درخواست است با نوع، تاریخ، مدت و <b>شماره پیگیری</b>.</p>
      <ol class="legend">
        <li><b class="n">۱</b><b>وضعیت</b> درخواست (در انتظار، تأیید شده، رد شده، لغو شده).</li>
        <li><b class="n">۲</b><b>لغو</b> — درخواست را پس می‌گیرد. پس از تأیید را بزنید.</li>
        <li><b class="n">۳</b><b>مراحل تأیید</b> — باز و بسته کردن فهرست تأییدکنندگان.</li>
        <li><b class="n">۴</b>هر مرحله، نام تأییدکننده و وضعیت آن (مثلاً «مدیر مستقیم — در انتظار رضا کریمی»).</li>
      </ol>
      <p>«مشاهده امضا» امضای ثبت‌شده شما را نشان می‌دهد.</p>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e18-approved.webp" alt="درخواست تأییدشده" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">درخواست تأییدشده</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b>وضعیت <span class="badge b-ok">تأیید شده</span> — همه مراحل امضا کرده‌اند و مرخصی از مانده کم شده است. امضای تأییدکننده هم قابل مشاهده است.</li>
      </ol>
      <div class="note"><b>لغو مرخصی تأییدشده:</b> تا وقتی مرخصی شروع نشده، دکمه <b>لغو</b> باقی است. با لغو، مانده به حساب شما برمی‌گردد.</div>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e20-rejected.webp" alt="درخواست ردشده با دلیل" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">درخواست ردشده با دلیل</div></div>
    <div>
      <p>اگر درخواست رد شود، وضعیت <span class="badge b-no">رد شده</span> می‌شود و <b>دلیل رد</b> که مدیر نوشته در کادر قرمز زیر آن نمایش داده می‌شود. در این حالت از مانده شما چیزی کم نمی‌شود. در صورت نیاز درخواست تازه‌ای با تاریخ یا شرایط دیگر ثبت کنید.</p>
    </div>
  </div>

  <h3 id="s4-8"><span class="num">۴٫۸</span>تقویم، پروفایل و نمودار سازمانی</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e19-calendar.webp" alt="تقویم مرخصی" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">تقویم مرخصی</div></div>
    <div>
      <p>تقویم، مرخصی‌های <b>تأییدشده</b> شما و تیم‌تان را نشان می‌دهد تا بتوانید مرخصی‌ها را هماهنگ کنید.</p>
      <ol class="legend">
        <li><b class="n">۱</b>جابه‌جایی بین ماه‌ها با فلش‌ها.</li>
        <li><b class="n">۲</b>نمای <b>فهرست</b> یا <b>ماه</b> (جدول روزها).</li>
      </ol>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e15-profile-top.webp" alt="پروفایل — بالای صفحه" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">پروفایل — بالای صفحه</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b><b>نمودار سازمانی</b> — مدیر شما و همکاران زیرمجموعه.</li>
        <li><b class="n">۲</b><b>اطلاعات شخصی</b> — فقط مشاهده. برای اصلاح به منابع انسانی اطلاع دهید.</li>
        <li><b class="n">۳</b><b>امضای ذخیره‌شده</b> — مشاهده، تعویض یا حذف امضا.</li>
      </ol>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/e16-profile-bottom.webp" alt="پروفایل — پایین صفحه" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">پروفایل — پایین صفحه</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b><b>زبان</b> — فارسی یا English.</li>
        <li><b class="n">۲</b><b>تغییر رمز عبور</b> — رمز فعلی، رمز جدید و تکرار آن را وارد کنید و «تغییر رمز عبور» را بزنید.</li>
        <li><b class="n">۳</b><b>خروج از حساب</b> — روی گوشی یا رایانه مشترک حتماً از حساب خارج شوید.</li>
      </ol>
    </div>
  </div>
</section>

<section class="chapter">
  <h2 id="s5">۵. راهنمای مدیر</h2>
  <p>مدیران همه امکانات فصل ۴ را برای درخواست‌های خودشان دارند. علاوه بر آن، درخواست کارکنان زیرمجموعه به صف تأیید آن‌ها می‌رسد.</p>

  <h3 id="s5-1"><span class="num">۵٫۱</span>صفحه خانه مدیر</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/m01-home.webp" alt="خانه مدیر" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">خانه مدیر</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b><b>وضعیت امروز تیم</b> — تعداد حاضر، در مرخصی و در ماموریت.</li>
        <li><b class="n">۲</b><b>منتظر تأیید شما</b> — تعداد درخواست‌هایی که امضای شما را لازم دارند، و قدیمی‌ترین آن‌ها.</li>
        <li><b class="n">۳</b><b>درخواست‌های در انتظار</b> — می‌توانید همین‌جا <b>تأیید</b> یا <b>رد</b> کنید. «همه تأییدها» صف کامل را باز می‌کند.</li>
      </ol>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/m02-manage.webp" alt="منوی مدیریت" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">منوی مدیریت</div></div>
    <div>
      <p>در نوار پایین، گزینه <b>مدیریت</b> اضافه شده است:</p>
      <ol class="legend">
        <li><b class="n">۱</b><b>کارکنان</b> — فهرست کارکنان و زیرمجموعه‌های شما.</li>
        <li><b class="n">۲</b><b>تأییدها</b> — صف درخواست‌هایی که باید بررسی کنید.</li>
      </ol>
    </div>
  </div>

  <h3 id="s5-2"><span class="num">۵٫۲</span>صف تأیید درخواست‌ها</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/m03-queue.webp" alt="مدیریت ← تأییدها" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">مدیریت ← تأییدها</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b>کارت درخواست: نام کارمند، نوع، تاریخ‌ها، مدت، شماره پیگیری و دلیل.</li>
        <li><b class="n">۲</b><b>مراحل تأیید</b> — مرحله‌ای که اکنون منتظر شماست، و مراحل بعدی در صورت وجود.</li>
        <li><b class="n">۳</b><b>امضای درخواست‌کننده</b> — «مشاهده امضا» را بزنید و امضای کارمند را ببینید.</li>
        <li><b class="n">۴</b><b>تأیید</b>.</li>
        <li><b class="n">۵</b><b>رد</b>.</li>
      </ol>
      <div class="tip"><b>توصیه:</b> صف تأیید را روزانه بررسی کنید. پیش از تأیید، تقویم تیم را ببینید تا چند نفر هم‌زمان غایب نباشند.</div>
    </div>
  </div>

  <h3 id="s5-3"><span class="num">۵٫۳</span>تأیید درخواست</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/m04-approve.webp" alt="پنجره تأیید با امضا" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">پنجره تأیید با امضا</div></div>
    <div>
      <ol class="steps"><li>روی <b>تأیید</b> بزنید. پنجره تأیید باز می‌شود و نقشی که با آن امضا می‌کنید (مثلاً «مدیر مستقیم») را نشان می‌دهد.</li></ol>
      <ol class="legend">
        <li><b class="n">۱</b><b>امضای تأییدکننده</b> — امضای ذخیره‌شده خودکار قرار می‌گیرد؛ وگرنه امضا کنید.</li>
        <li><b class="n">۲</b>تیک مجوز استفاده از امضای دیجیتال.</li>
        <li><b class="n">۳</b><b>تأیید</b> — درخواست از صف شما خارج می‌شود.</li>
      </ol>
      <div class="note">اگر درخواست مراحل دیگری هم داشته باشد، پس از امضای شما به تأییدکننده بعدی می‌رود و وضعیت آن تا امضای آخرین مرحله «در انتظار» می‌ماند. اگر چند مرحله با شما باشد، یک امضا برای همه کافی است.</div>
    </div>
  </div>

  <h3 id="s5-4"><span class="num">۵٫۴</span>رد درخواست</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/m05-reject.webp" alt="پنجره رد درخواست" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">پنجره رد درخواست</div></div>
    <div>
      <ol class="steps"><li>روی <b>رد</b> بزنید.</li></ol>
      <ol class="legend">
        <li><b class="n">۱</b><b>دلیل رد درخواست</b> — اختیاری، اما <b>همیشه بنویسید</b>؛ کارمند همین متن را می‌بیند (بخش ۴٫۷).</li>
        <li><b class="n">۲</b><b>رد</b> — تأیید نهایی. «انصراف» پنجره را می‌بندد.</li>
      </ol>
      <div class="warn"><b>توجه:</b> رد درخواست قابل برگشت نیست. کارمند باید درخواست تازه ثبت کند.</div>
    </div>
  </div>

  <h3 id="s5-5"><span class="num">۵٫۵</span>کارکنان زیرمجموعه و تقویم تیم</h3>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/m07-employees.webp" alt="مدیریت ← کارکنان" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">مدیریت ← کارکنان</div></div>
    <div>
      <ol class="legend">
        <li><b class="n">۱</b>فیلترها: <b>همه</b>، <b>زیرمجموعه‌های من</b>، <b>غیرفعال</b>.</li>
      </ol>
      <p>با جستجو (نام یا کد پرسنلی) و فیلتر واحد، کارمند مورد نظر را پیدا کنید. با زدن روی نام، جزئیات او باز می‌شود. مدیر فقط <b>نام</b> و <b>تاریخ استخدام</b> زیرمجموعه‌ها را ویرایش می‌کند؛ بقیه موارد (ستون‌های قفل‌دار) با منابع انسانی است.</p>
    </div>
  </div>
  <div class="step">
    <div><div class="shot"><img src="/help/user-guide/m09-calendar-month.webp" alt="تقویم تیم — نمای ماه" width="390" height="844" loading="lazy" decoding="async"></div><div class="cap">تقویم تیم — نمای ماه</div></div>
    <div>
      <p>در <b>تقویم</b>، نمای <b>ماه</b> را انتخاب کنید. روزهایی که کسی مرخصی دارد با تعداد و نام مشخص شده‌اند. با زدن روی هر روز، فهرست افراد در مرخصی آن روز زیر تقویم نمایش داده می‌شود.</p>
    </div>
  </div>
</section>

<section class="chapter">
  <h2 id="s6">۶. سؤالات متداول و رفع اشکال</h2>
  <table class="grid">
    <tr><th style="width:40%">مشکل یا سؤال</th><th>راه‌حل</th></tr>
    <tr><td>رمز عبورم را فراموش کرده‌ام.</td><td>به منابع انسانی مراجعه کنید تا رمز موقت جدید صادر شود. در ورود بعدی رمز شخصی تازه انتخاب می‌کنید.</td></tr>
    <tr><td>وارد سامانه نمی‌شوم.</td><td>کد پرسنلی را بدون فاصله وارد کنید؛ زبان صفحه‌کلید را برای رمز انگلیسی کنید؛ با نماد چشم رمز را بررسی کنید. اگر بارها پشت سر هم اشتباه بزنید، چند دقیقه صبر کنید.</td></tr>
    <tr><td>دکمه ارسال کار نمی‌کند یا خطا می‌دهد.</td><td>متن خطای قرمز بالای دکمه را بخوانید: معمولاً نوع مرخصی انتخاب نشده، امضا یا تیک مجوز جا افتاده، یا تاریخ با درخواست قبلی شما همپوشانی دارد.</td></tr>
    <tr><td>همکارم در فهرست جانشین نیست.</td><td>فقط همکاران همان واحد که در آن روزها مرخصی ندارند نمایش داده می‌شوند. جانشین اختیاری است؛ «بدون جانشین» را بزنید.</td></tr>
    <tr><td>مانده مرخصی‌ام درست نیست.</td><td>مانده را منابع انسانی تنظیم می‌کند؛ موضوع را با شماره پرسنلی به منابع انسانی اطلاع دهید.</td></tr>
    <tr><td>درخواستم مدت زیادی «در انتظار» مانده است.</td><td>در «مراحل تأیید» ببینید منتظر کیست و به همان فرد یادآوری کنید.</td></tr>
    <tr><td>اطلاعات شخصی‌ام اشتباه است.</td><td>این بخش فقط‌خواندنی است؛ اصلاح را از منابع انسانی بخواهید.</td></tr>
    <tr><td>صفحه به‌روز نیست.</td><td>دکمه «به‌روزرسانی» بالای صفحه را بزنید یا صفحه را ببندید و دوباره باز کنید.</td></tr>
    <tr><td>(مدیر) درخواستی که انتظارش را دارم در صف نیست.</td><td>شاید هنوز در مرحله قبلی باشد، یا کارمند در سامانه زیرمجموعه شما ثبت نشده باشد. با منابع انسانی هماهنگ کنید.</td></tr>
  </table>
  <div class="note"><b>دوره آزمایشی:</b> در این دوره هر اشکال یا پیشنهادی را همراه با <b>عکس از صفحه</b>، <b>ساعت</b> و <b>کاری که انجام می‌دادید</b> به مسئول سامانه اطلاع دهید.</div>
</section>
`;
