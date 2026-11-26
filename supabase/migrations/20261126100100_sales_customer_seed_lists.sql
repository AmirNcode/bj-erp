-- FR-98: province reference + seed lists (cities = county seats, contractor categories). Company lists are seeded by private.sales_seed_customer_lists(company), also called by seed.sql.

insert into public.iran_provinces (code, name_fa, name_en, position) values
  ('AE', 'آذربایجان شرقی', 'East Azerbaijan', 1),
  ('AW', 'آذربایجان غربی', 'West Azerbaijan', 2),
  ('AR', 'اردبیل', 'Ardabil', 3),
  ('ES', 'اصفهان', 'Isfahan', 4),
  ('AL', 'البرز', 'Alborz', 5),
  ('IL', 'ایلام', 'Ilam', 6),
  ('BU', 'بوشهر', 'Bushehr', 7),
  ('TE', 'تهران', 'Tehran', 8),
  ('CB', 'چهارمحال و بختیاری', 'Chaharmahal and Bakhtiari', 9),
  ('KJ', 'خراسان جنوبی', 'South Khorasan', 10),
  ('KR', 'خراسان رضوی', 'Razavi Khorasan', 11),
  ('KS', 'خراسان شمالی', 'North Khorasan', 12),
  ('KZ', 'خوزستان', 'Khuzestan', 13),
  ('ZA', 'زنجان', 'Zanjan', 14),
  ('SE', 'سمنان', 'Semnan', 15),
  ('SB', 'سیستان و بلوچستان', 'Sistan and Baluchestan', 16),
  ('FA', 'فارس', 'Fars', 17),
  ('QZ', 'قزوین', 'Qazvin', 18),
  ('QM', 'قم', 'Qom', 19),
  ('KD', 'کردستان', 'Kurdistan', 20),
  ('KE', 'کرمان', 'Kerman', 21),
  ('KH', 'کرمانشاه', 'Kermanshah', 22),
  ('KB', 'کهگیلویه و بویراحمد', 'Kohgiluyeh and Boyer-Ahmad', 23),
  ('GO', 'گلستان', 'Golestan', 24),
  ('GI', 'گیلان', 'Gilan', 25),
  ('LO', 'لرستان', 'Lorestan', 26),
  ('MZ', 'مازندران', 'Mazandaran', 27),
  ('MA', 'مرکزی', 'Markazi', 28),
  ('HO', 'هرمزگان', 'Hormozgan', 29),
  ('HA', 'همدان', 'Hamadan', 30),
  ('YA', 'یزد', 'Yazd', 31);

create function private.sales_seed_customer_lists(p_company uuid) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sales_contractor_categories (company_id, name_fa, name_key, name_en, position)
  select p_company, v.fa, private.sales_name_key(v.fa), v.en, v.pos
    from (values
      ('ساختمان', 'Building', 1),
      ('راه و ترابری', 'Road and transport', 2),
      ('آب', 'Water', 3),
      ('صنعت و معدن', 'Industry and mining', 4),
      ('تأسیسات و تجهیزات', 'Installations and equipment', 5),
      ('نفت و گاز', 'Oil and gas', 6),
      ('کشاورزی', 'Agriculture', 7),
      ('ارتباطات و فناوری اطلاعات', 'Telecom and IT', 8),
      ('نیرو', 'Power', 9)
    ) as v(fa, en, pos)
  on conflict (company_id, name_key) do nothing;

  insert into public.sales_cities (company_id, province_code, name_fa, name_key, name_en)
  select p_company, v.p, v.fa, private.sales_name_key(v.fa), v.en
    from (values
      -- East Azerbaijan
      ('AE', 'تبریز', 'Tabriz'), ('AE', 'اسکو', 'Osku'), ('AE', 'اهر', 'Ahar'), ('AE', 'بستان‌آباد', 'Bostanabad'), ('AE', 'بناب', 'Bonab'), ('AE', 'جلفا', 'Jolfa'), ('AE', 'سراب', 'Sarab'), ('AE', 'شبستر', 'Shabestar'), ('AE', 'عجب‌شیر', 'Ajab Shir'), ('AE', 'کلیبر', 'Kaleybar'), ('AE', 'مراغه', 'Maragheh'), ('AE', 'مرند', 'Marand'), ('AE', 'ملکان', 'Malekan'), ('AE', 'میانه', 'Mianeh'), ('AE', 'ورزقان', 'Varzaqan'), ('AE', 'هریس', 'Heris'), ('AE', 'هشترود', 'Hashtrud'), ('AE', 'آذرشهر', 'Azarshahr'),
      -- West Azerbaijan
      ('AW', 'ارومیه', 'Urmia'), ('AW', 'اشنویه', 'Oshnavieh'), ('AW', 'بوکان', 'Bukan'), ('AW', 'پیرانشهر', 'Piranshahr'), ('AW', 'تکاب', 'Takab'), ('AW', 'خوی', 'Khoy'), ('AW', 'سردشت', 'Sardasht'), ('AW', 'سلماس', 'Salmas'), ('AW', 'شاهین‌دژ', 'Shahin Dezh'), ('AW', 'ماکو', 'Maku'), ('AW', 'مهاباد', 'Mahabad'), ('AW', 'میاندوآب', 'Miandoab'), ('AW', 'نقده', 'Naqadeh'), ('AW', 'پلدشت', 'Poldasht'),
      -- Ardabil
      ('AR', 'اردبیل', 'Ardabil'), ('AR', 'بیله‌سوار', 'Bileh Savar'), ('AR', 'پارس‌آباد', 'Parsabad'), ('AR', 'خلخال', 'Khalkhal'), ('AR', 'گرمی', 'Germi'), ('AR', 'مشگین‌شهر', 'Meshgin Shahr'), ('AR', 'نمین', 'Namin'), ('AR', 'نیر', 'Nir'), ('AR', 'سرعین', 'Sareyn'),
      -- Isfahan
      ('ES', 'اصفهان', 'Isfahan'), ('ES', 'آران و بیدگل', 'Aran va Bidgol'), ('ES', 'اردستان', 'Ardestan'), ('ES', 'دولت‌آباد', 'Dowlatabad'), ('ES', 'چادگان', 'Chadegan'), ('ES', 'خمینی‌شهر', 'Khomeyni Shahr'), ('ES', 'خوانسار', 'Khansar'), ('ES', 'سمیرم', 'Semirom'), ('ES', 'شاهین‌شهر', 'Shahin Shahr'), ('ES', 'نجف‌آباد', 'Najafabad'), ('ES', 'نطنز', 'Natanz'), ('ES', 'داران', 'Daran'), ('ES', 'فریدونشهر', 'Fereydunshahr'), ('ES', 'فلاورجان', 'Falavarjan'), ('ES', 'کاشان', 'Kashan'), ('ES', 'گلپایگان', 'Golpayegan'), ('ES', 'زرین‌شهر', 'Zarrinshahr'), ('ES', 'مبارکه', 'Mobarakeh'), ('ES', 'نایین', 'Nain'), ('ES', 'تیران', 'Tiran'), ('ES', 'دهاقان', 'Dehaqan'), ('ES', 'خور', 'Khur'), ('ES', 'کوهپایه', 'Kuhpayeh'), ('ES', 'شهرضا', 'Shahreza'),
      -- Alborz
      ('AL', 'کرج', 'Karaj'), ('AL', 'هشتگرد', 'Hashtgerd'), ('AL', 'نظرآباد', 'Nazarabad'), ('AL', 'طالقان', 'Taleqan'), ('AL', 'اشتهارد', 'Eshtehard'), ('AL', 'فردیس', 'Fardis'),
      -- Ilam
      ('IL', 'ایلام', 'Ilam'), ('IL', 'ایوان', 'Eyvan'), ('IL', 'آبدانان', 'Abdanan'), ('IL', 'دره‌شهر', 'Darreh Shahr'), ('IL', 'دهلران', 'Dehloran'), ('IL', 'مهران', 'Mehran'), ('IL', 'سرابله', 'Sarableh'), ('IL', 'بدره', 'Badreh'),
      -- Bushehr
      ('BU', 'بوشهر', 'Bushehr'), ('BU', 'اهرم', 'Ahram'), ('BU', 'جم', 'Jam'), ('BU', 'برازجان', 'Borazjan'), ('BU', 'خورموج', 'Khormoj'), ('BU', 'دیر', 'Dayyer'), ('BU', 'دیلم', 'Deylam'), ('BU', 'کنگان', 'Kangan'), ('BU', 'گناوه', 'Genaveh'), ('BU', 'عسلویه', 'Asaluyeh'),
      -- Tehran
      ('TE', 'تهران', 'Tehran'), ('TE', 'اسلام‌شهر', 'Eslamshahr'), ('TE', 'پاکدشت', 'Pakdasht'), ('TE', 'پردیس', 'Pardis'), ('TE', 'پیشوا', 'Pishva'), ('TE', 'دماوند', 'Damavand'), ('TE', 'رباط‌کریم', 'Robat Karim'), ('TE', 'شهر ری', 'Shahr-e Rey'), ('TE', 'تجریش', 'Tajrish'), ('TE', 'شهریار', 'Shahriar'), ('TE', 'فیروزکوه', 'Firuzkuh'), ('TE', 'قدس', 'Qods'), ('TE', 'ملارد', 'Malard'), ('TE', 'ورامین', 'Varamin'), ('TE', 'قرچک', 'Qarchak'),
      -- Chaharmahal and Bakhtiari
      ('CB', 'شهرکرد', 'Shahr-e Kord'), ('CB', 'اردل', 'Ardal'), ('CB', 'بروجن', 'Borujen'), ('CB', 'بن', 'Ben'), ('CB', 'سامان', 'Saman'), ('CB', 'فارسان', 'Farsan'), ('CB', 'چلگرد', 'Chelgerd'), ('CB', 'شلمزار', 'Shalamzar'), ('CB', 'لردگان', 'Lordegan'),
      -- South Khorasan
      ('KJ', 'بیرجند', 'Birjand'), ('KJ', 'بشرویه', 'Boshruyeh'), ('KJ', 'اسدیه', 'Asadiyeh'), ('KJ', 'خوسف', 'Khusf'), ('KJ', 'حاجی‌آباد', 'Hajiabad'), ('KJ', 'سرایان', 'Sarayan'), ('KJ', 'سربیشه', 'Sarbisheh'), ('KJ', 'فردوس', 'Ferdows'), ('KJ', 'قاین', 'Qaen'), ('KJ', 'نهبندان', 'Nehbandan'), ('KJ', 'طبس', 'Tabas'),
      -- Razavi Khorasan
      ('KR', 'مشهد', 'Mashhad'), ('KR', 'بجستان', 'Bajestan'), ('KR', 'بردسکن', 'Bardaskan'), ('KR', 'تایباد', 'Taybad'), ('KR', 'تربت جام', 'Torbat-e Jam'), ('KR', 'تربت حیدریه', 'Torbat-e Heydarieh'), ('KR', 'جغتای', 'Joghatai'), ('KR', 'چناران', 'Chenaran'), ('KR', 'خلیل‌آباد', 'Khalilabad'), ('KR', 'خواف', 'Khaf'), ('KR', 'درگز', 'Dargaz'), ('KR', 'رشتخوار', 'Rashtkhar'), ('KR', 'سبزوار', 'Sabzevar'), ('KR', 'سرخس', 'Sarakhs'), ('KR', 'فریمان', 'Fariman'), ('KR', 'قوچان', 'Quchan'), ('KR', 'کاشمر', 'Kashmar'), ('KR', 'کلات', 'Kalat'), ('KR', 'گناباد', 'Gonabad'), ('KR', 'فیض‌آباد', 'Feyzabad'), ('KR', 'نیشابور', 'Neyshabur'), ('KR', 'باخرز', 'Bakharz'), ('KR', 'فیروزه', 'Firuzeh'), ('KR', 'داورزن', 'Davarzan'),
      -- North Khorasan
      ('KS', 'بجنورد', 'Bojnurd'), ('KS', 'اسفراین', 'Esfarayen'), ('KS', 'جاجرم', 'Jajarm'), ('KS', 'راز', 'Raz'), ('KS', 'شیروان', 'Shirvan'), ('KS', 'فاروج', 'Faruj'), ('KS', 'گرمه', 'Garmeh'), ('KS', 'آشخانه', 'Ashkhaneh'),
      -- Khuzestan
      ('KZ', 'اهواز', 'Ahvaz'), ('KZ', 'آبادان', 'Abadan'), ('KZ', 'آغاجاری', 'Aghajari'), ('KZ', 'امیدیه', 'Omidiyeh'), ('KZ', 'اندیمشک', 'Andimeshk'), ('KZ', 'ایذه', 'Izeh'), ('KZ', 'باغ‌ملک', 'Bagh-e Malek'), ('KZ', 'ماهشهر', 'Mahshahr'), ('KZ', 'بهبهان', 'Behbahan'), ('KZ', 'خرمشهر', 'Khorramshahr'), ('KZ', 'دزفول', 'Dezful'), ('KZ', 'سوسنگرد', 'Susangerd'), ('KZ', 'رامشیر', 'Ramshir'), ('KZ', 'رامهرمز', 'Ramhormoz'), ('KZ', 'شادگان', 'Shadegan'), ('KZ', 'شوش', 'Shush'), ('KZ', 'شوشتر', 'Shushtar'), ('KZ', 'گتوند', 'Gotvand'), ('KZ', 'لالی', 'Lali'), ('KZ', 'مسجدسلیمان', 'Masjed Soleyman'), ('KZ', 'هندیجان', 'Hendijan'), ('KZ', 'هفتکل', 'Haftkel'), ('KZ', 'هویزه', 'Hoveyzeh'), ('KZ', 'حمیدیه', 'Hamidiyeh'),
      -- Zanjan
      ('ZA', 'زنجان', 'Zanjan'), ('ZA', 'ابهر', 'Abhar'), ('ZA', 'ایجرود', 'Ijrud'), ('ZA', 'خدابنده', 'Khodabandeh'), ('ZA', 'خرمدره', 'Khorramdarreh'), ('ZA', 'طارم', 'Tarom'), ('ZA', 'ماهنشان', 'Mahneshan'), ('ZA', 'سلطانیه', 'Soltaniyeh'),
      -- Semnan
      ('SE', 'سمنان', 'Semnan'), ('SE', 'دامغان', 'Damghan'), ('SE', 'شاهرود', 'Shahrud'), ('SE', 'گرمسار', 'Garmsar'), ('SE', 'مهدی‌شهر', 'Mahdishahr'), ('SE', 'میامی', 'Miami'), ('SE', 'آرادان', 'Aradan'), ('SE', 'سرخه', 'Sorkheh'),
      -- Sistan and Baluchestan
      ('SB', 'زاهدان', 'Zahedan'), ('SB', 'ایرانشهر', 'Iranshahr'), ('SB', 'چابهار', 'Chabahar'), ('SB', 'خاش', 'Khash'), ('SB', 'زابل', 'Zabol'), ('SB', 'زهک', 'Zahak'), ('SB', 'سراوان', 'Saravan'), ('SB', 'سرباز', 'Sarbaz'), ('SB', 'سیب', 'Sib'), ('SB', 'نیک‌شهر', 'Nikshahr'), ('SB', 'کنارک', 'Konarak'), ('SB', 'میرجاوه', 'Mirjaveh'), ('SB', 'فنوج', 'Fanuj'), ('SB', 'قصرقند', 'Qasr-e Qand'), ('SB', 'راسک', 'Rask'),
      -- Fars
      ('FA', 'شیراز', 'Shiraz'), ('FA', 'آباده', 'Abadeh'), ('FA', 'ارسنجان', 'Arsanjan'), ('FA', 'استهبان', 'Estahban'), ('FA', 'اقلید', 'Eqlid'), ('FA', 'سوریان', 'Suriyan'), ('FA', 'سعادت‌شهر', 'Saadat Shahr'), ('FA', 'جهرم', 'Jahrom'), ('FA', 'خرامه', 'Kharameh'), ('FA', 'خرم‌بید', 'Khorram Bid'), ('FA', 'خنج', 'Khonj'), ('FA', 'داراب', 'Darab'), ('FA', 'حسن‌آباد', 'Hasanabad'), ('FA', 'اردکان', 'Ardakan'), ('FA', 'سروستان', 'Sarvestan'), ('FA', 'فراشبند', 'Farashband'), ('FA', 'فسا', 'Fasa'), ('FA', 'فیروزآباد', 'Firuzabad'), ('FA', 'قیر', 'Qir'), ('FA', 'کازرون', 'Kazerun'), ('FA', 'لار', 'Lar'), ('FA', 'لامرد', 'Lamerd'), ('FA', 'مرودشت', 'Marvdasht'), ('FA', 'نورآباد', 'Nurabad'), ('FA', 'مهر', 'Mohr'), ('FA', 'نی‌ریز', 'Neyriz'), ('FA', 'گراش', 'Gerash'), ('FA', 'کوار', 'Kavar'), ('FA', 'بیضا', 'Beyza'), ('FA', 'اوز', 'Evaz'),
      -- Qazvin
      ('QZ', 'قزوین', 'Qazvin'), ('QZ', 'آبیک', 'Abyek'), ('QZ', 'بوئین‌زهرا', 'Buin Zahra'), ('QZ', 'تاکستان', 'Takestan'), ('QZ', 'آوج', 'Avaj'),
      -- Qom
      ('QM', 'قم', 'Qom'),
      -- Kurdistan
      ('KD', 'سنندج', 'Sanandaj'), ('KD', 'بانه', 'Baneh'), ('KD', 'بیجار', 'Bijar'), ('KD', 'دیواندره', 'Divandarreh'), ('KD', 'دهگلان', 'Dehgolan'), ('KD', 'سروآباد', 'Sarvabad'), ('KD', 'سقز', 'Saqqez'), ('KD', 'قروه', 'Qorveh'), ('KD', 'کامیاران', 'Kamyaran'), ('KD', 'مریوان', 'Marivan'),
      -- Kerman
      ('KE', 'کرمان', 'Kerman'), ('KE', 'بافت', 'Baft'), ('KE', 'بردسیر', 'Bardsir'), ('KE', 'بم', 'Bam'), ('KE', 'جیرفت', 'Jiroft'), ('KE', 'رفسنجان', 'Rafsanjan'), ('KE', 'زرند', 'Zarand'), ('KE', 'سیرجان', 'Sirjan'), ('KE', 'شهربابک', 'Shahr-e Babak'), ('KE', 'عنبرآباد', 'Anbarabad'), ('KE', 'قلعه‌گنج', 'Qaleh Ganj'), ('KE', 'کوهبنان', 'Kuhbanan'), ('KE', 'منوجان', 'Manujan'), ('KE', 'ریگان', 'Rigan'), ('KE', 'فهرج', 'Fahraj'), ('KE', 'ارزوئیه', 'Arzuiyeh'), ('KE', 'رابر', 'Rabor'), ('KE', 'راور', 'Ravar'), ('KE', 'انار', 'Anar'),
      -- Kermanshah
      ('KH', 'کرمانشاه', 'Kermanshah'), ('KH', 'اسلام‌آباد غرب', 'Eslamabad-e Gharb'), ('KH', 'پاوه', 'Paveh'), ('KH', 'گهواره', 'Gahvareh'), ('KH', 'جوانرود', 'Javanrud'), ('KH', 'روانسر', 'Ravansar'), ('KH', 'سرپل ذهاب', 'Sarpol-e Zahab'), ('KH', 'سنقر', 'Sonqor'), ('KH', 'صحنه', 'Sahneh'), ('KH', 'قصر شیرین', 'Qasr-e Shirin'), ('KH', 'کنگاور', 'Kangavar'), ('KH', 'گیلانغرب', 'Gilan-e Gharb'), ('KH', 'هرسین', 'Harsin'),
      -- Kohgiluyeh and Boyer-Ahmad
      ('KB', 'یاسوج', 'Yasuj'), ('KB', 'لیکک', 'Likak'), ('KB', 'چرام', 'Cheram'), ('KB', 'سی‌سخت', 'Sisakht'), ('KB', 'دهدشت', 'Dehdasht'), ('KB', 'گچساران', 'Gachsaran'), ('KB', 'لنده', 'Landeh'), ('KB', 'باشت', 'Basht'),
      -- Golestan
      ('GO', 'گرگان', 'Gorgan'), ('GO', 'آزادشهر', 'Azadshahr'), ('GO', 'آق‌قلا', 'Aq Qala'), ('GO', 'بندر ترکمن', 'Bandar Torkaman'), ('GO', 'بندر گز', 'Bandar-e Gaz'), ('GO', 'رامیان', 'Ramian'), ('GO', 'علی‌آباد کتول', 'Aliabad-e Katul'), ('GO', 'کردکوی', 'Kordkuy'), ('GO', 'کلاله', 'Kalaleh'), ('GO', 'گالیکش', 'Galikesh'), ('GO', 'گمیشان', 'Gomishan'), ('GO', 'گنبد کاووس', 'Gonbad-e Kavus'), ('GO', 'مراوه‌تپه', 'Maraveh Tappeh'), ('GO', 'مینودشت', 'Minudasht'),
      -- Gilan
      ('GI', 'رشت', 'Rasht'), ('GI', 'آستارا', 'Astara'), ('GI', 'آستانه اشرفیه', 'Astaneh-ye Ashrafiyeh'), ('GI', 'املش', 'Amlash'), ('GI', 'بندر انزلی', 'Bandar Anzali'), ('GI', 'رضوانشهر', 'Rezvanshahr'), ('GI', 'رودبار', 'Rudbar'), ('GI', 'رودسر', 'Rudsar'), ('GI', 'سیاهکل', 'Siahkal'), ('GI', 'شفت', 'Shaft'), ('GI', 'صومعه‌سرا', 'Sowmeeh Sara'), ('GI', 'هشتپر', 'Hashtpar'), ('GI', 'فومن', 'Fuman'), ('GI', 'لاهیجان', 'Lahijan'), ('GI', 'لنگرود', 'Langarud'), ('GI', 'ماسال', 'Masal'),
      -- Lorestan
      ('LO', 'خرم‌آباد', 'Khorramabad'), ('LO', 'ازنا', 'Azna'), ('LO', 'الیگودرز', 'Aligudarz'), ('LO', 'بروجرد', 'Borujerd'), ('LO', 'پلدختر', 'Poldokhtar'), ('LO', 'دورود', 'Dorud'), ('LO', 'نورآباد', 'Nurabad'), ('LO', 'الشتر', 'Aleshtar'), ('LO', 'کوهدشت', 'Kuhdasht'),
      -- Mazandaran
      ('MZ', 'ساری', 'Sari'), ('MZ', 'آمل', 'Amol'), ('MZ', 'بابل', 'Babol'), ('MZ', 'بابلسر', 'Babolsar'), ('MZ', 'بهشهر', 'Behshahr'), ('MZ', 'تنکابن', 'Tonekabon'), ('MZ', 'جویبار', 'Juybar'), ('MZ', 'چالوس', 'Chalus'), ('MZ', 'رامسر', 'Ramsar'), ('MZ', 'پل‌سفید', 'Pol-e Sefid'), ('MZ', 'قائمشهر', 'Qaemshahr'), ('MZ', 'گلوگاه', 'Galugah'), ('MZ', 'محمودآباد', 'Mahmudabad'), ('MZ', 'نکا', 'Neka'), ('MZ', 'نور', 'Nur'), ('MZ', 'نوشهر', 'Nowshahr'), ('MZ', 'فریدونکنار', 'Fereydunkenar'), ('MZ', 'عباس‌آباد', 'Abbasabad'), ('MZ', 'میاندورود', 'Miandorud'), ('MZ', 'شیرگاه', 'Shirgah'),
      -- Markazi
      ('MA', 'اراک', 'Arak'), ('MA', 'آشتیان', 'Ashtian'), ('MA', 'تفرش', 'Tafresh'), ('MA', 'خمین', 'Khomein'), ('MA', 'خنداب', 'Khondab'), ('MA', 'دلیجان', 'Delijan'), ('MA', 'ساوه', 'Saveh'), ('MA', 'شازند', 'Shazand'), ('MA', 'کمیجان', 'Komijan'), ('MA', 'محلات', 'Mahallat'),
      -- Hormozgan
      ('HO', 'بندرعباس', 'Bandar Abbas'), ('HO', 'ابوموسی', 'Abu Musa'), ('HO', 'بستک', 'Bastak'), ('HO', 'بندر لنگه', 'Bandar Lengeh'), ('HO', 'پارسیان', 'Parsian'), ('HO', 'جاسک', 'Jask'), ('HO', 'حاجی‌آباد', 'Hajiabad'), ('HO', 'خمیر', 'Khamir'), ('HO', 'رودان', 'Rudan'), ('HO', 'سیریک', 'Sirik'), ('HO', 'قشم', 'Qeshm'), ('HO', 'میناب', 'Minab'),
      -- Hamadan
      ('HA', 'همدان', 'Hamadan'), ('HA', 'اسدآباد', 'Asadabad'), ('HA', 'بهار', 'Bahar'), ('HA', 'تویسرکان', 'Tuyserkan'), ('HA', 'رزن', 'Razan'), ('HA', 'فامنین', 'Famenin'), ('HA', 'کبودرآهنگ', 'Kabudarahang'), ('HA', 'ملایر', 'Malayer'), ('HA', 'نهاوند', 'Nahavand'),
      -- Yazd
      ('YA', 'یزد', 'Yazd'), ('YA', 'ابرکوه', 'Abarkuh'), ('YA', 'اردکان', 'Ardakan'), ('YA', 'اشکذر', 'Ashkezar'), ('YA', 'بافق', 'Bafq'), ('YA', 'بهاباد', 'Bahabad'), ('YA', 'تفت', 'Taft'), ('YA', 'مهریز', 'Mehriz'), ('YA', 'میبد', 'Meybod')
    ) as v(p, fa, en)
  on conflict (company_id, province_code, name_key) do nothing;
end $$;

revoke all on function private.sales_seed_customer_lists(uuid) from public, anon, authenticated;
select private.sales_seed_customer_lists(id) from public.companies;
