/**
 * Doğal dil komut çözümleyicinin doğrulaması.
 *
 * Çalıştırma (docs/MULTI_TEACHER_NOTES.md ile aynı yöntem):
 *   npx -y tsc --module commonjs --target ES2022 --outDir tmp_cmd --esModuleInterop true \
 *     --skipLibCheck true --moduleResolution node --rootDir . \
 *     services/commandParser.ts scripts/verify-command-parser.ts
 *   node tmp_cmd/scripts/verify-command-parser.js
 */

import { parseCommands, applyActions } from '../services/commandParser';
import type { CommandAction } from '../services/commandParser';
import type { TimetableData } from '../types';
import { SchoolLevel, ClassGroup } from '../types';

const baseData = (): TimetableData => ({
  teachers: [{
    id: 't1',
    name: 'Ali Yılmaz',
    branches: ['Türkçe'],
    availability: Array.from({ length: 5 }, () => Array.from({ length: 16 }, () => true)),
    canTeachMiddleSchool: true,
    canTeachHighSchool: false,
  }],
  classrooms: [{ id: 'c1', name: '5-A', level: SchoolLevel.Middle, group: ClassGroup.None, sessionType: 'full' }],
  subjects: [{ id: 's1', name: 'Türkçe', weeklyHours: 6, blockHours: 0, assignedClassIds: ['c1'] }],
  locations: [],
  fixedAssignments: [],
  lessonGroups: [],
  duties: [],
});

let failures = 0;
const check = (title: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    console.log(`  ✓ ${title}`);
  } else {
    failures++;
    console.log(`  ✗ ${title}`);
    if (detail !== undefined) console.log('     ', JSON.stringify(detail, null, 1));
  }
};

const kinds = (actions: CommandAction[]) => actions.map(a => a.kind);
const find = <K extends CommandAction['kind']>(actions: CommandAction[], kind: K) =>
  actions.find(a => a.kind === kind) as Extract<CommandAction, { kind: K }> | undefined;

// 1 — Öğretmen ekleme, branş katalogdan
console.log('1. Öğretmen ekleme');
{
  const r = parseCommands('Kaan Özarık fen bilimleri öğretmeni ekle', baseData());
  const a = find(r.actions, 'addTeacher');
  check('addTeacher üretildi', !!a, kinds(r.actions));
  check('ad doğru okundu', a?.name === 'Kaan Özarık', a?.name);
  check('branş Fen Bilimleri', a?.branches[0] === 'Fen Bilimleri', a?.branches);
}

// 2 — Toplu şube açma
console.log('2. Şube açma');
{
  const r = parseCommands('6. sınıf 3 şube', baseData());
  const rooms = r.actions.filter(a => a.kind === 'addClassroom') as Extract<CommandAction, { kind: 'addClassroom' }>[];
  check('3 sınıf eklendi', rooms.length === 3, rooms.map(x => x.name));
  check('mevcut ayraç korundu (5-A varken 6-A)', rooms[0]?.name === '6-A', rooms[0]?.name);
  check('ortaokul seviyesi', rooms[0]?.level === SchoolLevel.Middle, rooms[0]?.level);
}

// 3 — Sınıfa ders ve saat
console.log('3. Ders ve saat');
{
  const r = parseCommands('5/A matematik 5 saat', baseData());
  const a = find(r.actions, 'addSubject');
  check('ders eklendi', !!a, kinds(r.actions));
  check('haftalık saat 5', a?.weeklyHours === 5, a?.weeklyHours);
  check('var olan 5-A sınıfına bağlandı (yeni sınıf açılmadı)', a?.classroomIds.length === 1 && a?.classroomIds[0] === 'c1', a?.classroomIds);
}

// 4 — Türkçe ekler: "matematiğe" ve var olan dersin saatini değiştirme
console.log('4. Ek kırpma ve ünsüz yumuşaması');
{
  const data = applyActions(baseData(), parseCommands('5/A matematik 5 saat', baseData()).actions);
  const r = parseCommands('matematiğe 6 saat', data);
  const a = find(r.actions, 'setHours');
  check('setHours üretildi', !!a, kinds(r.actions));
  check('6 saate çekildi', a?.weeklyHours === 6, a?.weeklyHours);
}

// 5 — Öğretmeni derse bağlama (satırlar birbirini görüyor)
console.log('5. Çok satırlı, birbirine bağlı komut');
{
  const r = parseCommands(
    'Kaan Özarık fen bilimleri öğretmeni ekle\n5/A fen dersine Kaan girsin',
    baseData(),
  );
  const teacher = find(r.actions, 'addTeacher');
  const pin = find(r.actions, 'pinTeacher');
  check('iki satır da çözüldü', r.lines.length === 2 && r.lines.every(l => !l.problem), r.lines.map(l => l.problem));
  check('öğretmen pinlendi', pin?.teacherId === teacher?.id, { pin, teacher });
  check('pin 5-A sınıfına', pin?.classroomIds[0] === 'c1', pin?.classroomIds);

  const next = applyActions(baseData(), r.actions);
  const fen = next.subjects.find(s => s.name === 'Fen Bilimleri');
  check('ders gerçekten eklendi', !!fen, next.subjects.map(s => s.name));
  check('pin veriye işlendi', fen?.pinnedTeacherByClassroom?.['c1']?.length === 1, fen?.pinnedTeacherByClassroom);
}

// 6 — Branşı olmayan derse pin: branş da eklenmeli
console.log('6. Pin sırasında branş tamamlama');
{
  const r = parseCommands('5/A matematik dersine Ali Yılmaz girsin', baseData());
  const branch = find(r.actions, 'addBranch');
  check('addBranch üretildi', !!branch, kinds(r.actions));
  check('branş Matematik', branch?.branch === 'Matematik', branch?.branch);
  const next = applyActions(baseData(), r.actions);
  check('Ali Yılmaz artık Matematik okutabilir', next.teachers[0].branches.includes('Matematik'), next.teachers[0].branches);
}

// 7 — Müsaitlik
console.log('7. Müsaitlik');
{
  const r = parseCommands('Ali Yılmaz salı günü gelmiyor', baseData());
  const a = find(r.actions, 'setAvailability');
  check('setAvailability üretildi', !!a, kinds(r.actions));
  check('salı = 1. gün', a?.days.length === 1 && a?.days[0] === 1, a?.days);
  check('kapatılıyor', a?.available === false, a?.available);
  const next = applyActions(baseData(), r.actions);
  check('salı tamamen kapandı', next.teachers[0].availability[1].every(x => x === false), next.teachers[0].availability[1]);
  check('pazartesi bozulmadı', next.teachers[0].availability[0].every(x => x === true));
}

// 8 — Öğleden sonra
console.log('8. Öğleden sonra');
{
  const r = parseCommands('Ali Yılmaz cuma öğleden sonra yok', baseData());
  const next = applyActions(baseData(), r.actions);
  const cuma = next.teachers[0].availability[4];
  check('ilk 4 saat açık', cuma.slice(0, 4).every(x => x === true), cuma);
  check('5. saatten sonrası kapalı', cuma.slice(4).every(x => x === false), cuma);
}

// 9 — Silme ve temizlik
console.log('9. Silme');
{
  const start = applyActions(baseData(), parseCommands('5/A türkçe dersine Ali Yılmaz girsin', baseData()).actions);
  const r = parseCommands('Ali Yılmaz\'ı sil', start);
  check('removeTeacher üretildi', !!find(r.actions, 'removeTeacher'), kinds(r.actions));
  const next = applyActions(start, r.actions);
  check('öğretmen gitti', next.teachers.length === 0, next.teachers);
  const pins = next.subjects[0].pinnedTeacherByClassroom || {};
  check('derse çakılı kaydı da temizlendi', Object.keys(pins).length === 0, pins);
}

// 10 — Toplu: tüm 6. sınıflara ders
console.log('10. Sınıf grubuna toplu ders');
{
  const withRooms = applyActions(baseData(), parseCommands('6. sınıf 3 şube', baseData()).actions);
  const r = parseCommands('6. sınıflara sosyal bilgiler 3 saat', withRooms);
  const a = find(r.actions, 'addSubject');
  check('ders eklendi', !!a, kinds(r.actions));
  check('üç şubeye de bağlandı', a?.classroomIds.length === 3, a?.classroomIds);
  check('adı resmî hâliyle yazıldı', a?.name === 'Sosyal Bilgiler', a?.name);
}

// 11 — Anlaşılmayan satır sessizce bir şey yapmamalı
console.log('11. Anlaşılmayan komut');
{
  const r = parseCommands('bugün hava çok güzel', baseData());
  check('eylem üretilmedi', r.actions.length === 0, kinds(r.actions));
  check('sorun bildirildi', !!r.lines[0].problem, r.lines[0]);
}

// 12 — Var olan veriyi bozmuyor (saf fonksiyon)
console.log('12. Girdi verisi değişmiyor');
{
  const data = baseData();
  const snapshot = JSON.stringify(data);
  const r = parseCommands('7/B fen dersine Ayşe Demir girsin', data);
  applyActions(data, r.actions);
  check('kaynak veri aynı kaldı', JSON.stringify(data) === snapshot);
  const next = applyActions(data, r.actions);
  check('7/B açıldı', next.classrooms.some(c => c.name === '7-B'), next.classrooms.map(c => c.name));
  check('Ayşe Demir eklendi', next.teachers.some(t => t.name === 'Ayşe Demir'), next.teachers.map(t => t.name));
}

// 13 — Dolgu kelimeleri ada karışmamalı
console.log('13. Dolgu kelimeleri');
{
  const r = parseCommands('Kaan Özarık diye bir fen öğretmeni var', baseData());
  const a = find(r.actions, 'addTeacher');
  check('ad temiz alındı', a?.name === 'Kaan Özarık', a?.name);
}

// 14 — Kısa komut kelimeleri özel adlara yapışmamalı
console.log('14. Kısa kelime çakışması');
{
  const r = parseCommands('Veli Atakan müzik öğretmeni ekle', baseData());
  const a = find(r.actions, 'addTeacher');
  check('"ve" ve "ata" ada karışmadı', a?.name === 'Veli Atakan', a?.name);
  check('branş Müzik', a?.branches[0] === 'Müzik', a?.branches);
}

// 15 — Tek cümlede iki öğretmen
console.log('15. Cümlede iki öğretmen');
{
  const start = applyActions(baseData(), parseCommands('Nihal Kaya matematik öğretmeni ekle', baseData()).actions);
  const r = parseCommands('Nihal ve Ali perşembe gelmiyor', start);
  const both = r.actions.filter(a => a.kind === 'setAvailability');
  check('ikisine de uygulandı', both.length === 2, both);

  const pin = parseCommands('5/A matematik dersine Nihal ve Ali girsin', start);
  check('iki öğretmenli pin sessizce yarım kalmıyor', pin.actions.length === 0 && !!pin.lines[0].problem, pin.lines[0]);
}

// 16 — Sıfırdan başlayan okul: hiç kayıt yokken
console.log('16. Sıfırdan okul');
{
  const empty: TimetableData = {
    teachers: [], classrooms: [], subjects: [],
    locations: [], fixedAssignments: [], lessonGroups: [], duties: [],
  };
  const r = parseCommands(
    'abdullah felsefe öğretmeni ekle\n9. sınıf 3 şube\n9. sınıflara felsefe 2 saat\n9/A felsefe dersine abdullah girsin',
    empty,
  );
  check('dört satır da çözüldü', r.lines.length === 4 && r.lines.every(l => !l.problem), r.lines.map(l => l.problem));
  const next = applyActions(empty, r.actions);
  check('küçük harfle yazılan ad düzeltildi', next.teachers[0]?.name === 'Abdullah', next.teachers.map(t => t.name));
  check('branş Felsefe', next.teachers[0]?.branches[0] === 'Felsefe', next.teachers[0]?.branches);
  check('lise seviyesi seçildi', next.classrooms.every(c => c.level === SchoolLevel.High), next.classrooms.map(c => c.level));
  check('ders üç şubeye bağlandı', next.subjects[0]?.assignedClassIds.length === 3, next.subjects[0]?.assignedClassIds);
  const pinned = next.subjects[0]?.pinnedTeacherByClassroom || {};
  check('9/A için öğretmen çakıldı', Object.keys(pinned).length === 1, pinned);
}

// 17 — Dört kelimeli ad kırpılmamalı, kayıtlı soyada takılmamalı
console.log('17. Uzun adlar ve soyadı çakışması');
{
  const empty: TimetableData = {
    teachers: [], classrooms: [], subjects: [],
    locations: [], fixedAssignments: [], lessonGroups: [], duties: [],
  };
  const first = parseCommands('hatice nur demir kaya coğrafya öğretmeni ekle', empty);
  const withTeacher = applyActions(empty, first.actions);
  check('dört kelimeli ad tam alındı', withTeacher.teachers[0]?.name === 'Hatice Nur Demir Kaya', withTeacher.teachers[0]?.name);

  const second = parseCommands('ayşe demir müzik öğretmeni ekle', withTeacher);
  const added = find(second.actions, 'addTeacher');
  check('kayıtlı soyada takılmadı, yeni öğretmen açıldı', added?.name === 'Ayşe Demir', { added, lines: second.lines });
}

// 18 — Sorunlu satır arkada iz bırakmamalı
console.log('18. Sorunlu satır iz bırakmıyor');
{
  const r = parseCommands('müzik dersine Ali Yılmaz girsin', baseData());
  check('hiç eylem üretilmedi', r.actions.length === 0, kinds(r.actions));
  check('sebep yazıldı', !!r.lines[0].problem, r.lines[0]);
}

// 19 — Aynı satırdaki ikinci komut sessizce yutulmuyor
console.log('19. Yarım kalan satır uyarısı');
{
  const r = parseCommands('5/A matematik 5 saat, türkçe 6 saat', baseData());
  check('ilk komut uygulandı', r.actions.length > 0, kinds(r.actions));
  check('kalan kısım için uyarı var', !!r.lines[0].warning, r.lines[0]);
}

console.log('');
if (failures) {
  console.log(`${failures} kontrol BAŞARISIZ`);
  process.exit(1);
}
console.log('Tüm kontroller geçti.');
