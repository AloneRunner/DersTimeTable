/**
 * Doğal dil komut çözümleyici.
 *
 * Amaç: veri girişini form doldurmadan yapabilmek. Kullanıcı "5/A fen dersine
 * Kaan Özarık girsin" yazar (ya da mikrofonla söyler), uygulama bunu somut
 * işlemlere çevirir ve ONAY EKRANINDA gösterir. Onaylanmadan hiçbir şey değişmez.
 *
 * Yapay zekâ servisi kullanılmaz: komut kümesi dar ve kelimelerin çoğu zaten
 * veride (öğretmen adları, ders adları, sınıf adları). Türkçe ekler kırpılarak
 * yakın eşleşme yapılır: "matematiğe" -> "Matematik", "Kaan'ı" -> "Kaan".
 */

import type { TimetableData, Teacher, Classroom, Subject } from '../types';
import { SchoolLevel, ClassGroup } from '../types';
import { subjectSuggestions } from '../data/suggestions';

export const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];

/** Sabah sayılan saat adedi. "öğleden sonra gelmiyor" bu sınırdan sonrasını kapatır. */
export const MORNING_HOURS = 4;

const HOUR_SLOTS = 16;

export type CommandAction =
  | { kind: 'addTeacher'; id: string; name: string; branches: string[] }
  | { kind: 'addBranch'; teacherId: string; branch: string }
  | { kind: 'addClassroom'; id: string; name: string; level: SchoolLevel }
  | { kind: 'addSubject'; id: string; name: string; weeklyHours: number; classroomIds: string[] }
  | { kind: 'setHours'; subjectId: string; weeklyHours: number }
  | { kind: 'assignClasses'; subjectId: string; classroomIds: string[] }
  | { kind: 'pinTeacher'; subjectId: string; classroomIds: string[]; teacherId: string }
  | { kind: 'setAvailability'; teacherId: string; days: number[]; part: 'all' | 'am' | 'pm'; available: boolean }
  | { kind: 'removeTeacher'; teacherId: string }
  | { kind: 'removeClassroom'; classroomId: string }
  | { kind: 'removeSubject'; subjectId: string };

export interface ParsedLine {
  text: string;
  actions: CommandAction[];
  /** Onay ekranında gösterilecek, kullanıcının okuyup doğrulayacağı Türkçe cümleler. */
  summaries: string[];
  /** Satır anlaşılmadıysa sebebi. */
  problem?: string;
  /** Satır çözüldü ama içinde işlenmemiş bir kısım kaldıysa. */
  warning?: string;
}

/**
 * Bir onceki satirdan tasinan baglam: "7/A'ya 4 saat fen dersi ekle" dedikten
 * sonra "Kaan hoca derse girecek" denince hangi dersten bahsedildigi bilinsin.
 */
export interface CommandContext {
  subjectId?: string;
  classIds?: string[];
}

export interface ParseResult {
  lines: ParsedLine[];
  actions: CommandAction[];
  hasActions: boolean;
}

// --- Türkçe küçük harf ve ek kırpma -------------------------------------------------

const trLower = (s: string) => s.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();

/** Kelimeyi karşılaştırmaya hazırlar; kesme işaretinden sonrası (Türkçe eki) atılır. */
const normWord = (raw: string): string => {
  let s = trLower(raw).replace(/[’`´]/g, "'");
  const ap = s.indexOf("'");
  if (ap > 0) s = s.slice(0, ap);
  return s.replace(/[^a-zçğıöşü0-9/-]/g, '');
};

export interface Tok { raw: string; norm: string }

export const tokenize = (text: string): Tok[] =>
  text.split(/\s+/)
    .filter(Boolean)
    .map(raw => ({ raw, norm: normWord(raw) }))
    .filter(t => t.norm.length > 0);

/** Ünsüz yumuşaması: matematik -> matematiğe, kitap -> kitaba. */
const SOFTEN: Record<string, string> = { k: 'ğ', p: 'b', t: 'd', ç: 'c' };

/**
 * Sözlükteki kelime metindeki kelimeyle uyuyor mu? Uyuyorsa puan döner (yüksek = güvenli).
 * Ek almış hâlleri kabul eder, eksik duyulmuş hâllere biraz tolerans tanır.
 */
const wordScore = (db: string, tok: string): number => {
  if (!db || !tok) return 0;
  if (tok === db) return db.length + 2;
  if (tok.startsWith(db)) return db.length + 1;
  const soft = SOFTEN[db[db.length - 1]];
  if (soft) {
    const mutated = db.slice(0, -1) + soft;
    if (tok.startsWith(mutated)) return db.length;
  }
  if (db.length >= 5) {
    const need = Math.max(4, db.length - 2);
    if (tok.length >= need && tok.startsWith(db.slice(0, need))) return need;
  }
  return 0;
};

const nameWords = (name: string) => trLower(name).split(/\s+/).map(normWord).filter(Boolean);

interface Match<T> { item: T; score: number; start: number; end: number }

/**
 * Metinde geçen en iyi adayı bulur. Aynı puanlı iki farklı aday çıkarsa
 * (örn. "Türkçe" ile "Türk Dili ve Edebiyatı") kararsız sayıp soru olarak döner.
 */
const bestMatch = <T extends { name: string }>(
  items: T[],
  toks: Tok[],
  used: boolean[],
): { match: Match<T> | null; ambiguous: T[] } => {
  let best: Match<T> | null = null;
  let rivals: T[] = [];
  for (const item of items) {
    const words = nameWords(item.name);
    if (!words.length) continue;
    for (let i = 0; i + words.length <= toks.length; i++) {
      let total = 0;
      let ok = true;
      for (let j = 0; j < words.length; j++) {
        if (used[i + j]) { ok = false; break; }
        const s = wordScore(words[j], toks[i + j].norm);
        if (!s) { ok = false; break; }
        total += s;
      }
      if (!ok || total < 5) continue;
      if (!best || total > best.score) {
        best = { item, score: total, start: i, end: i + words.length };
        rivals = [];
      } else if (total === best.score && best.item !== item) {
        rivals.push(item);
      }
    }
  }
  if (best && rivals.length) {
    const chosen = best;
    const distinct = rivals.filter(r => trLower(r.name) !== trLower(chosen.item.name));
    if (distinct.length) return { match: null, ambiguous: [chosen.item, ...distinct] };
  }
  return { match: best, ambiguous: [] };
};

const markUsed = (used: boolean[], start: number, end: number) => {
  for (let i = start; i < end; i++) used[i] = true;
};

/**
 * Öğretmene çoğu zaman sadece adıyla seslenilir ("Kaan girsin"). Tam ad tutmazsa
 * ad ya da soyadın tek başına geçtiği yere bakılır. İki öğretmen aynı kelimeye
 * uyuyorsa karar verilmez; kullanıcıdan tam ad istenir.
 */
const matchTeacherByPart = (
  teachers: Teacher[],
  toks: Tok[],
  used: boolean[],
): { match: Match<Teacher> | null; ambiguous: Teacher[] } => {
  const hits: Array<Match<Teacher>> = [];
  // Komşusunda başka bir ad varsa ("Ayşe Demir"), bu tek kelime kayıtlı bir
  // öğretmenin soyadına benzese bile onu kastetmiyordur; eşleştirme yapılmaz.
  // Gün ve ders adları "isim" sayılmaz; yoksa "Ali perşembe gelmiyor" cümlesinde
  // Ali, yanındaki gün yüzünden tanınmaz olur.
  const looksLikeName = (tok: Tok) =>
    /^[a-zçğıöşü]+$/.test(tok.norm)
    && !isKeywordToken(tok)
    && !DAY_KEYS.some(keys => keys.some(k => wordScore(k, tok.norm) > 0))
    && !CATALOG.some(entry => {
      const words = nameWords(entry.name);
      return words.length === 1 && wordScore(words[0], tok.norm) >= 5;
    });
  const neighbouredByName = (i: number) => [i - 1, i + 1].some(j =>
    j >= 0 && j < toks.length && !used[j] && looksLikeName(toks[j]));
  for (const item of teachers) {
    const words = nameWords(item.name).filter(w => w.length >= 3);
    let best: Match<Teacher> | null = null;
    for (let i = 0; i < toks.length; i++) {
      if (used[i] || neighbouredByName(i)) continue;
      for (const w of words) {
        const exact = toks[i].norm === w;
        const score = wordScore(w, toks[i].norm);
        // Kısa adlar yalnız birebir kabul edilir; uzun adlarda eke tolerans var.
        if (!exact && score < 6) continue;
        if (!best || score > best.score) best = { item, score, start: i, end: i + 1 };
      }
    }
    if (best) hits.push(best);
  }
  if (!hits.length) return { match: null, ambiguous: [] };
  const top = Math.max(...hits.map(h => h.score));
  const leaders = hits.filter(h => h.score === top);
  if (leaders.length === 1) return { match: leaders[0], ambiguous: [] };
  return { match: null, ambiguous: leaders.map(h => h.item) };
};

// --- Sözlükler ----------------------------------------------------------------------

/** Konuşma dilindeki kısaltmalar. Solda söylenen, sağda resmî ders adı. */
const ALIASES: Array<[string, string]> = [
  ['fen', 'Fen Bilimleri'],
  ['sosyal', 'Sosyal Bilgiler'],
  ['beden', 'Beden Eğitimi ve Spor'],
  ['din', 'Din Kültürü ve Ahlak Bilgisi'],
  ['din kültürü', 'Din Kültürü ve Ahlak Bilgisi'],
  ['inkılap', 'T.C. İnkılap Tarihi ve Atatürkçülük'],
  ['inkılap tarihi', 'T.C. İnkılap Tarihi ve Atatürkçülük'],
  ['görsel', 'Görsel Sanatlar'],
  ['resim', 'Görsel Sanatlar'],
  ['bilişim', 'Bilişim Teknolojileri ve Yazılım'],
  ['edebiyat', 'Türk Dili ve Edebiyatı'],
  ['rehberlik', 'Rehberlik ve Kariyer Planlama'],
  ['kuran', "Kur'an-ı Kerim"],
  ['siyer', 'Peygamberimizin Hayatı'],
];

const CATALOG: Array<{ name: string; canonical: string }> = [
  ...subjectSuggestions.map(name => ({ name, canonical: name })),
  ...ALIASES.map(([alias, canonical]) => ({ name: alias, canonical })),
];

const KEYWORDS = {
  add: ['ekle', 'eklesin', 'ekleyelim', 'ekleyin', 'oluştur', 'oluşturalım', 'tanımla', 'yeni'],
  remove: ['sil', 'silelim', 'silin', 'kaldır', 'kaldıralım', 'çıkar', 'çıkart', 'çıkaralım'],
  assign: ['ata', 'atansın', 'atayalım', 'versin', 'verelim', 'girsin', 'girecek', 'okut', 'okutsun', 'okutacak', 'okusun', 'sorumlu', 'baksın'],
  absent: ['gelmiyor', 'gelmez', 'gelemiyor', 'gelmeyecek', 'yok', 'izinli', 'izin', 'boş', 'olmayacak', 'kapalı', 'gelmesin', 'olmasın', 'olmaz', 'koyma', 'koymayın', 'koymayalım', 'meşgul'],
  present: ['gelsin', 'gelir', 'geliyor', 'müsait', 'gelebilir', 'çalışıyor'],
  teacher: ['öğretmen', 'öğretmeni', 'hoca', 'hocası', 'branş'],
  lesson: ['ders', 'dersi', 'dersine', 'dersini', 'saat', 'saati'],
  classWord: ['sınıf', 'şube'],
  all: ['tüm', 'bütün', 'her', 'hepsi', 'hepsine'],
};

/**
 * Cümlenin bağlayıcıları. Ad soyad toplanırken araya karışmasınlar:
 * "Kaan Özarık diye bir fen öğretmeni var" -> ad "Kaan Özarık" olmalı.
 */
const FILLERS = [
  'bir', 'bu', 'şu', 'var', 'diye', 'adında', 'adlı', 'isimli', 'olarak', 'lütfen',
  'bey', 'hanım', 'sayın', 'öğretmenimiz',
  'tane', 'ile', 've', 'ya', 'veya', 'ki', 'için', 'artık', 'ayrıca', 'sonra', 'önce',
  'gün', 'günü', 'günleri', 'haftada', 'haftalık', 'olsun', 'olacak', 'lazım', 'gerek',
];

const ALL_KEYWORDS = [...Object.values(KEYWORDS).flat(), ...FILLERS].map(normWord).filter(Boolean);

/**
 * Kısa kelimeler yalnız birebir kabul edilir; yoksa "ata" komutu "Atakan" adına,
 * "ve" bağlacı "Veli" adına yapışır. Uzun kelimelerde eke tolerans var.
 */
const matchesKeyword = (kn: string, tok: string): boolean =>
  (kn.length <= 3 ? tok === kn : wordScore(kn, tok) >= kn.length);

const hasKeyword = (toks: Tok[], used: boolean[], list: string[]): boolean => {
  for (let i = 0; i < toks.length; i++) {
    if (used[i]) continue;
    for (const k of list) {
      const kn = normWord(k);
      if (kn && matchesKeyword(kn, toks[i].norm)) return true;
    }
  }
  return false;
};

// --- Sınıf adı çözümleme -------------------------------------------------------------

const classKey = (name: string) => trLower(name).replace(/[^a-zçğıöşü0-9]/g, '');

/** Okul "5-A" mı "5/A" mı yazıyor? Yeni sınıflar aynı biçimde eklensin. */
const separatorOf = (data: TimetableData): string => {
  const sample = data.classrooms.find(c => /\d\s*[-/]\s*[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(c.name));
  if (!sample) return '/';
  return sample.name.includes('-') ? '-' : '/';
};

const levelForGrade = (grade: number): SchoolLevel =>
  (grade >= 9 ? SchoolLevel.High : SchoolLevel.Middle);

interface ClassRef { grade: number; branch: string | null; all?: boolean }

const extractClassRefs = (toks: Tok[], used: boolean[]): ClassRef[] => {
  const refs: ClassRef[] = [];
  const isClassWord = (n: string) => wordScore('sınıf', n) > 0 || wordScore('sinif', n) > 0;
  for (let i = 0; i < toks.length; i++) {
    if (used[i]) continue;
    const n = toks[i].norm;
    const single = n.match(/^(\d{1,2})[/-]?([a-zçğıöşü])$/);
    if (single) {
      refs.push({ grade: Number(single[1]), branch: single[2] });
      markUsed(used, i, i + 1);
      continue;
    }
    if (/^\d{1,2}$/.test(n) && i + 1 < toks.length && !used[i + 1]) {
      const next = toks[i + 1].norm;
      if (/^[a-zçğıöşü]$/.test(next)) {
        refs.push({ grade: Number(n), branch: next });
        markUsed(used, i, i + 2);
        continue;
      }
      if (isClassWord(next)) {
        refs.push({ grade: Number(n), branch: null });
        markUsed(used, i, i + 2);
        continue;
      }
    }
    if (ALL_KEYWORDS.length && KEYWORDS.all.some(k => n === normWord(k)) && i + 1 < toks.length && isClassWord(toks[i + 1].norm)) {
      refs.push({ grade: 0, branch: null, all: true });
      markUsed(used, i, i + 2);
    }
  }
  return refs;
};

// --- Gün ve saat ---------------------------------------------------------------------

const DAY_KEYS: string[][] = [
  ['pazartesi', 'pzt'],
  ['salı', 'sali'],
  ['çarşamba', 'carsamba'],
  ['perşembe', 'persembe'],
  ['cuma'],
];

const extractDays = (toks: Tok[], used: boolean[]): number[] => {
  const days = new Set<number>();
  for (let i = 0; i < toks.length; i++) {
    if (used[i]) continue;
    DAY_KEYS.forEach((keys, index) => {
      if (keys.some(k => wordScore(k, toks[i].norm) > 0)) {
        days.add(index);
        markUsed(used, i, i + 1);
      }
    });
  }
  return [...days].sort((a, b) => a - b);
};

const extractHours = (toks: Tok[], used: boolean[]): number | null => {
  for (let i = 0; i < toks.length - 1; i++) {
    if (used[i] || used[i + 1]) continue;
    if (/^\d{1,2}$/.test(toks[i].norm) && wordScore('saat', toks[i + 1].norm) > 0) {
      markUsed(used, i, i + 2);
      return Number(toks[i].norm);
    }
  }
  return null;
};

const extractPart = (text: string): 'all' | 'am' | 'pm' => {
  const t = trLower(text);
  if (/öğleden sonra|ogleden sonra|öğleden sonrası/.test(t)) return 'pm';
  if (/öğleden önce|ogleden once|sabah/.test(t)) return 'am';
  return 'all';
};

// --- Yardımcılar ---------------------------------------------------------------------

let idCounter = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/** Mikrofonla gelen metin tamamen küçük harf olabilir; ad soyadı düzeltir. */
const titleCase = (s: string) =>
  s.split(/\s+/)
    .map(w => (w ? trLower(w).charAt(0).toLocaleUpperCase('tr') + trLower(w).slice(1) : w))
    .join(' ');

const cleanName = (raw: string) => raw.replace(/[’`´]/g, "'").split("'")[0].replace(/[.,;:!?]+$/, '');

const emptyAvailability = () =>
  Array.from({ length: 5 }, () => Array.from({ length: HOUR_SLOTS }, () => true));

const isKeywordToken = (tok: Tok): boolean =>
  ALL_KEYWORDS.some(kn => matchesKeyword(kn, tok.norm));

/** Artakalan, harften oluşan ardışık kelimeler: yeni bir özel ad olabilir. */
const leftoverName = (toks: Tok[], used: boolean[]): { name: string; start: number; end: number } | null => {
  let best: { name: string; start: number; end: number } | null = null;
  let i = 0;
  while (i < toks.length) {
    if (used[i] || !/^[a-zçğıöşü]+$/.test(toks[i].norm) || isKeywordToken(toks[i])) { i++; continue; }
    const start = i;
    const parts: string[] = [];
    // Dört kelimeye kadar: "Hatice Nur Demir Kaya" gibi adlar kırpılmasın.
    while (i < toks.length && !used[i] && /^[a-zçğıöşü]+$/.test(toks[i].norm) && !isKeywordToken(toks[i]) && parts.length < 4) {
      parts.push(cleanName(toks[i].raw));
      i++;
    }
    const candidate = { name: parts.join(' '), start, end: i };
    if (!best || candidate.name.length > best.name.length) best = candidate;
  }
  if (!best || best.name.replace(/\s/g, '').length < 2) return null;
  const allLower = best.name === trLower(best.name);
  return { ...best, name: allLower ? titleCase(best.name) : best.name };
};

// --- Tek satır çözümleme -------------------------------------------------------------

/**
 * `draft` o ana kadarki (önceki satırlar uygulanmış) veridir; böylece
 * "Kaan Özarık fen öğretmeni ekle" satırından sonraki "5/A fene Kaan girsin"
 * satırı yeni öğretmeni görebilir.
 */
const parseLineInner = (
  text: string,
  draft: TimetableData,
  ctx: { toks?: Tok[]; used?: boolean[] },
  context: CommandContext,
): ParsedLine => {
  const toks = tokenize(text);
  const line: ParsedLine = { text, actions: [], summaries: [] };
  if (!toks.length) { line.problem = 'Boş satır.'; return line; }

  const used: boolean[] = new Array(toks.length).fill(false);
  ctx.toks = toks;
  ctx.used = used;
  const classRefs = extractClassRefs(toks, used);

  // Cümlede birden çok öğretmen anılmış olabilir ("Nihal ve Ali perşembe gelmiyor").
  const found: Array<Match<Teacher>> = [];
  while (found.length < 8) {
    const pool = draft.teachers.filter(t => !found.some(f => f.item.id === t.id));
    if (!pool.length) break;
    let hit = bestMatch(pool, toks, used);
    if (!hit.match && !hit.ambiguous.length) hit = matchTeacherByPart(pool, toks, used);
    if (hit.ambiguous.length) {
      line.problem = `Birden fazla öğretmene uyuyor: ${hit.ambiguous.map(t => t.name).join(', ')}. Tam adı yazın.`;
      return line;
    }
    if (!hit.match) break;
    markUsed(used, hit.match.start, hit.match.end);
    found.push(hit.match);
  }
  const teacher = found[0] || null;

  const subjectHit = bestMatch(draft.subjects, toks, used);
  let subject: Subject | null = subjectHit.match ? subjectHit.match.item : null;
  let subjectName = subject ? subject.name : '';
  if (subjectHit.match) markUsed(used, subjectHit.match.start, subjectHit.match.end);
  if (!subject) {
    const catalogHit = bestMatch(CATALOG, toks, used);
    if (catalogHit.ambiguous.length) {
      line.problem = `Birden fazla derse uyuyor: ${catalogHit.ambiguous.map(s => s.canonical).join(', ')}. Ders adını tam yazın.`;
      return line;
    }
    if (catalogHit.match) {
      subjectName = catalogHit.match.item.canonical;
      markUsed(used, catalogHit.match.start, catalogHit.match.end);
      subject = draft.subjects.find(s => trLower(s.name) === trLower(subjectName)) || null;
    }
  }

  const days = extractDays(toks, used);
  const hours = extractHours(toks, used);
  const part = extractPart(text);

  const wantsRemove = hasKeyword(toks, used, KEYWORDS.remove);
  const wantsAdd = hasKeyword(toks, used, KEYWORDS.add);
  const wantsAssign = hasKeyword(toks, used, KEYWORDS.assign);
  const saysAbsent = hasKeyword(toks, used, KEYWORDS.absent) || /müsait değil/.test(trLower(text));
  const saysPresent = hasKeyword(toks, used, KEYWORDS.present) && !/müsait değil/.test(trLower(text));

  // Ders adı söylenmediyse bir önceki satırın dersi devralınır: "derse girecek".
  // Silme cümlelerinde devralınmaz; yanlışlıkla başka bir dersi silmek istemeyiz.
  let carried = false;
  if (!subjectName && !wantsRemove && context.subjectId) {
    const previous = draft.subjects.find(s => s.id === context.subjectId);
    if (previous && (hasKeyword(toks, used, KEYWORDS.lesson) || wantsAssign)) {
      subject = previous;
      subjectName = previous.name;
      carried = true;
    }
  }

  // Sınıf referanslarını gerçek sınıflara çevir; olmayanlar "eklenecek" sayılır.
  const sep = separatorOf(draft);
  const resolved: string[] = [];
  const toCreate: Array<{ id: string; name: string; level: SchoolLevel }> = [];
  for (const ref of classRefs) {
    if (ref.all) { resolved.push(...draft.classrooms.map(c => c.id)); continue; }
    if (ref.branch === null) {
      resolved.push(...draft.classrooms.filter(c => classKey(c.name).startsWith(String(ref.grade))).map(c => c.id));
      continue;
    }
    const key = `${ref.grade}${ref.branch}`;
    const existing = draft.classrooms.find(c => classKey(c.name) === key);
    if (existing) { resolved.push(existing.id); continue; }
    const created = {
      id: newId('c'),
      name: `${ref.grade}${sep}${ref.branch.toLocaleUpperCase('tr')}`,
      level: levelForGrade(ref.grade),
    };
    toCreate.push(created);
    resolved.push(created.id);
  }
  if (carried && !resolved.length && context.classIds?.length) {
    const stillThere = context.classIds.filter(id => draft.classrooms.some(c => c.id === id));
    resolved.push(...stillThere);
  }
  const classIds = [...new Set(resolved)];
  const nameOf = (ids: string[]) => ids
    .map(id => draft.classrooms.find(c => c.id === id)?.name || toCreate.find(c => c.id === id)?.name || id)
    .join(', ');

  // 1) Silme
  if (wantsRemove) {
    for (const hit of found) {
      line.actions.push({ kind: 'removeTeacher', teacherId: hit.item.id });
      line.summaries.push(`${hit.item.name} öğretmen listesinden silinecek`);
    }
    if (subject) {
      line.actions.push({ kind: 'removeSubject', subjectId: subject.id });
      line.summaries.push(`${subject.name} dersi silinecek`);
    }
    for (const id of classIds) {
      const room = draft.classrooms.find(c => c.id === id);
      if (room) {
        line.actions.push({ kind: 'removeClassroom', classroomId: id });
        line.summaries.push(`${room.name} sınıfı silinecek`);
      }
    }
    if (!line.actions.length) {
      line.problem = subjectName
        ? `Listede "${subjectName}" adında bir ders yok.`
        : 'Neyin silineceği anlaşılmadı. Silinecek öğretmenin, dersin ya da sınıfın adını yazın.';
    }
    return line;
  }

  // 2) Müsaitlik: "Nihal salı günü gelmiyor" (cümledeki her öğretmene uygulanır)
  if (teacher && days.length && (saysAbsent || saysPresent)) {
    const available = saysPresent && !saysAbsent;
    const partText = part === 'am'
      ? ` öğleden önce (ilk ${MORNING_HOURS} saat)`
      : part === 'pm' ? ` öğleden sonra (${MORNING_HOURS + 1}. saatten itibaren)` : '';
    for (const hit of found) {
      line.actions.push({ kind: 'setAvailability', teacherId: hit.item.id, days, part, available });
      line.summaries.push(`${hit.item.name}: ${days.map(d => DAY_NAMES[d]).join(', ')}${partText} ${available ? 'müsait olacak' : 'müsait değil'}`);
    }
    return line;
  }

  const pushNewClassrooms = () => {
    for (const c of toCreate) {
      line.actions.push({ kind: 'addClassroom', id: c.id, name: c.name, level: c.level });
      line.summaries.push(`Sınıf eklenecek: ${c.name} (${c.level})`);
    }
  };

  // 3) Öğretmeni derse bağlama: "5/A fen dersine Kaan girsin"
  if (subjectName && (teacher || wantsAssign)) {
    if (found.length > 1) {
      // Sessizce yalnız birini bağlamak yanlış anlaşılır; ayrı satır istenir.
      line.problem = `Tek derse birden fazla öğretmen bağlanamıyor (${found.map(f => f.item.name).join(', ')}). Her biri için ayrı satır yazın.`;
      return line;
    }
    let teacherId = teacher ? teacher.item.id : '';
    let teacherName = teacher ? teacher.item.name : '';
    if (!teacher) {
      const leftover = leftoverName(toks, used);
      if (!leftover) {
        line.problem = 'Dersi kimin okutacağı anlaşılmadı.';
        return line;
      }
      teacherId = newId('t');
      teacherName = leftover.name;
      markUsed(used, leftover.start, leftover.end);
      line.actions.push({ kind: 'addTeacher', id: teacherId, name: teacherName, branches: [subjectName] });
      line.summaries.push(`Öğretmen eklenecek: ${teacherName} (${subjectName})`);
    }

    pushNewClassrooms();

    let subjectId = subject ? subject.id : '';
    if (!subject) {
      subjectId = newId('s');
      line.actions.push({ kind: 'addSubject', id: subjectId, name: subjectName, weeklyHours: hours || 0, classroomIds: classIds });
      line.summaries.push(`Ders eklenecek: ${subjectName}${hours ? ` — haftada ${hours} saat` : ' — haftalık saati sonra girilmeli'}`);
    } else {
      if (hours !== null && hours !== subject.weeklyHours) {
        line.actions.push({ kind: 'setHours', subjectId, weeklyHours: hours });
        line.summaries.push(`${subjectName} dersinin haftalık saati ${hours} yapılacak`);
      }
      const missing = classIds.filter(id => !subject!.assignedClassIds.includes(id));
      if (missing.length) {
        line.actions.push({ kind: 'assignClasses', subjectId, classroomIds: missing });
        line.summaries.push(`${subjectName} dersi şu sınıflara eklenecek: ${nameOf(missing)}`);
      }
    }

    const pinClasses = classIds.length ? classIds : (subject ? subject.assignedClassIds : []);
    if (!pinClasses.length) {
      line.problem = 'Hangi sınıfın dersi olduğu anlaşılmadı.';
      return line;
    }
    line.actions.push({ kind: 'pinTeacher', subjectId, classroomIds: pinClasses, teacherId });
    line.summaries.push(`${nameOf(pinClasses)} ${subjectName} dersini ${teacherName} okutacak`);

    // Çözücü, branşı ders adıyla eşleşmeyen öğretmeni o derse sokmaz.
    if (teacher && teacher.item.branches.length && !teacher.item.branches.includes(subjectName)) {
      line.actions.push({ kind: 'addBranch', teacherId, branch: subjectName });
      line.summaries.push(`${teacherName} öğretmenin branşlarına "${subjectName}" eklenecek (yoksa çözücü bu derse sokmaz)`);
    }
    return line;
  }

  // 4) Ders saati / sınıfa ders: "5/A matematik 5 saat"
  if (subjectName && (hours !== null || classIds.length)) {
    pushNewClassrooms();
    if (!subject) {
      const subjectId = newId('s');
      line.actions.push({ kind: 'addSubject', id: subjectId, name: subjectName, weeklyHours: hours || 0, classroomIds: classIds });
      line.summaries.push(`Ders eklenecek: ${subjectName}${hours ? ` — haftada ${hours} saat` : ''}${classIds.length ? ` (${nameOf(classIds)})` : ''}`);
    } else {
      if (hours !== null && hours !== subject.weeklyHours) {
        line.actions.push({ kind: 'setHours', subjectId: subject.id, weeklyHours: hours });
        line.summaries.push(`${subject.name} dersi haftada ${subject.weeklyHours} saat yerine ${hours} saat olacak`);
      }
      const missing = classIds.filter(id => !subject!.assignedClassIds.includes(id));
      if (missing.length) {
        line.actions.push({ kind: 'assignClasses', subjectId: subject.id, classroomIds: missing });
        line.summaries.push(`${subject.name} dersi şu sınıflara eklenecek: ${nameOf(missing)}`);
      }
      if (!line.actions.length) line.problem = `${subject.name} dersi bu sınıflarda zaten böyle tanımlı.`;
    }
    return line;
  }

  // 5) Listede olmayan ders adı: "10/A kuyumculuk atölyesi dersi 4 saat".
  // Meslek liselerinin ders adları hazır listede yok; cümlede ders/saat geçiyorsa
  // artakalan kelimeler öğretmen adı değil, yeni bir ders adıdır.
  if (!subjectName && !hasKeyword(toks, used, KEYWORDS.teacher)) {
    const mentionsLesson = hasKeyword(toks, used, KEYWORDS.lesson) || hours !== null;
    const custom = mentionsLesson ? leftoverName(toks, used) : null;
    if (custom) {
      markUsed(used, custom.start, custom.end);
      pushNewClassrooms();
      const subjectId = newId('s');
      line.actions.push({ kind: 'addSubject', id: subjectId, name: custom.name, weeklyHours: hours || 0, classroomIds: classIds });
      line.summaries.push(`Ders eklenecek: ${custom.name}${hours !== null ? ` — haftada ${hours} saat` : ' — haftalık saati sonra girilmeli'}${classIds.length ? ` (${nameOf(classIds)})` : ''}`);
      return line;
    }
  }

  // 6) Sınıf ekleme: "6. sınıf 4 şube" ya da "5/A 5/B 5/C ekle"
  const shubeMatch = trLower(text).match(/(\d{1,2})\s*\.?\s*sınıf\w*\s+(\d{1,2})\s*şube/);
  if (shubeMatch) {
    const grade = Number(shubeMatch[1]);
    const count = Math.min(Number(shubeMatch[2]), 12);
    const letters = 'ABCDEFGHIJKL';
    for (let i = 0; i < count; i++) {
      const name = `${grade}${sep}${letters[i]}`;
      if (draft.classrooms.some(c => classKey(c.name) === classKey(name))) continue;
      line.actions.push({ kind: 'addClassroom', id: newId('c'), name, level: levelForGrade(grade) });
      line.summaries.push(`Sınıf eklenecek: ${name} (${levelForGrade(grade)})`);
    }
    if (!line.actions.length) line.problem = 'Bu şubeler zaten var.';
    return line;
  }
  if (toCreate.length) {
    pushNewClassrooms();
    return line;
  }

  // 7) Öğretmen ekleme: "Kaan Özarık fen bilimleri öğretmeni ekle"
  const leftover = leftoverName(toks, used);
  if (leftover && (subjectName || wantsAdd || hasKeyword(toks, used, KEYWORDS.teacher))) {
    const branches = subjectName ? [subjectName] : [];
    const existing = draft.teachers.find(t => trLower(t.name) === trLower(leftover.name));
    if (existing) {
      if (branches.length && !existing.branches.includes(branches[0])) {
        line.actions.push({ kind: 'addBranch', teacherId: existing.id, branch: branches[0] });
        line.summaries.push(`${existing.name} öğretmenin branşlarına "${branches[0]}" eklenecek`);
        return line;
      }
      line.problem = `${existing.name} zaten kayıtlı.`;
      return line;
    }
    line.actions.push({ kind: 'addTeacher', id: newId('t'), name: leftover.name, branches });
    line.summaries.push(`Öğretmen eklenecek: ${leftover.name}${branches.length ? ` (${branches[0]})` : ' — branş girilmedi'}`);
    return line;
  }

  line.problem = 'Anlaşılmadı. Örnek: "5/A fen dersine Kaan Özarık girsin" ya da "6. sınıflara matematik 5 saat".';
  return line;
};

/**
 * Satırda ikinci bir komut kalmış mı? ("9. sınıflara felsefe 2 saat, tarih 2 saat")
 * Artan kelimelerde hâlâ ders, gün ya da saat varsa kullanıcı uyarılır; sessizce
 * yarım iş yapılmaz.
 */
const leftoverClause = (toks: Tok[], used: boolean[], draft: TimetableData): string | null => {
  const rest = [...used];
  const days = extractDays(toks, rest);
  const hours = extractHours(toks, rest);
  const subject = bestMatch(draft.subjects, toks, rest).match || bestMatch(CATALOG, toks, rest).match;
  if (!days.length && hours === null && !subject) return null;
  const text = toks.filter((_, i) => !used[i]).map(t => t.raw).join(' ').trim();
  return text || null;
};

const parseLine = (text: string, draft: TimetableData, context: CommandContext): ParsedLine => {
  const ctx: { toks?: Tok[]; used?: boolean[] } = {};
  const line = parseLineInner(text, draft, ctx, context);
  // Sorunlu satır hiçbir iz bırakmamalı: uyarı verip arkada kayıt oluşturmak,
  // kullanıcının fark etmediği veri değişikliği demektir.
  if (line.problem) {
    line.actions = [];
    line.summaries = [];
    return line;
  }
  if (line.actions.length && ctx.toks && ctx.used) {
    const rest = leftoverClause(ctx.toks, ctx.used, draft);
    if (rest) line.warning = `Şu kısım işlenmedi: "${rest}". Ayrı satıra yazarsanız o da uygulanır.`;
  }
  return line;
};

// --- Uygulama ------------------------------------------------------------------------

const cloneData = (data: TimetableData): TimetableData => ({
  teachers: data.teachers.map(t => ({
    ...t,
    branches: [...(t.branches || [])],
    availability: (t.availability || []).map(d => [...d]),
  })),
  classrooms: data.classrooms.map(c => ({ ...c })),
  subjects: data.subjects.map(s => ({
    ...s,
    assignedClassIds: [...s.assignedClassIds],
    pinnedTeacherByClassroom: Object.fromEntries(
      Object.entries(s.pinnedTeacherByClassroom || {}).map(([k, v]) => [k, [...v]]),
    ),
    notSameDayWith: s.notSameDayWith ? [...s.notSameDayWith] : undefined,
  })),
  locations: data.locations.map(l => ({ ...l })),
  fixedAssignments: data.fixedAssignments.map(f => ({ ...f })),
  lessonGroups: data.lessonGroups.map(g => ({ ...g, classroomIds: [...g.classroomIds] })),
  duties: data.duties.map(d => ({ ...d })),
});

export const applyActions = (data: TimetableData, actions: CommandAction[]): TimetableData => {
  const next = cloneData(data);
  for (const action of actions) {
    switch (action.kind) {
      case 'addTeacher': {
        const teacher: Teacher = {
          id: action.id,
          name: action.name,
          branches: [...action.branches],
          availability: emptyAvailability(),
          canTeachMiddleSchool: true,
          canTeachHighSchool: true,
        };
        next.teachers.push(teacher);
        break;
      }
      case 'addBranch': {
        const t = next.teachers.find(x => x.id === action.teacherId);
        if (t && !t.branches.includes(action.branch)) t.branches.push(action.branch);
        break;
      }
      case 'addClassroom': {
        const room: Classroom = {
          id: action.id,
          name: action.name,
          level: action.level,
          group: ClassGroup.None,
          sessionType: 'full',
        };
        next.classrooms.push(room);
        break;
      }
      case 'addSubject': {
        const subject: Subject = {
          id: action.id,
          name: action.name,
          weeklyHours: action.weeklyHours,
          blockHours: 0,
          assignedClassIds: [...action.classroomIds],
        };
        next.subjects.push(subject);
        break;
      }
      case 'setHours': {
        const s = next.subjects.find(x => x.id === action.subjectId);
        if (s) s.weeklyHours = action.weeklyHours;
        break;
      }
      case 'assignClasses': {
        const s = next.subjects.find(x => x.id === action.subjectId);
        if (s) s.assignedClassIds = [...new Set([...s.assignedClassIds, ...action.classroomIds])];
        break;
      }
      case 'pinTeacher': {
        const s = next.subjects.find(x => x.id === action.subjectId);
        if (!s) break;
        s.assignedClassIds = [...new Set([...s.assignedClassIds, ...action.classroomIds])];
        const pins: Record<string, string[]> = { ...(s.pinnedTeacherByClassroom || {}) };
        for (const classroomId of action.classroomIds) pins[classroomId] = [action.teacherId];
        s.pinnedTeacherByClassroom = pins;
        break;
      }
      case 'setAvailability': {
        const t = next.teachers.find(x => x.id === action.teacherId);
        if (!t) break;
        if (!Array.isArray(t.availability) || t.availability.length < 5) t.availability = emptyAvailability();
        for (const day of action.days) {
          const row = t.availability[day] || Array.from({ length: HOUR_SLOTS }, () => true);
          const from = action.part === 'pm' ? MORNING_HOURS : 0;
          const to = action.part === 'am' ? MORNING_HOURS : row.length;
          for (let h = from; h < to; h++) row[h] = action.available;
          t.availability[day] = row;
        }
        break;
      }
      case 'removeTeacher': {
        next.teachers = next.teachers.filter(t => t.id !== action.teacherId);
        next.duties = next.duties.filter(d => d.teacherId !== action.teacherId);
        next.subjects = next.subjects.map(s => ({
          ...s,
          pinnedTeacherByClassroom: Object.fromEntries(
            Object.entries(s.pinnedTeacherByClassroom || {})
              .map(([room, ids]) => [room, ids.filter(id => id !== action.teacherId)])
              .filter(entry => (entry[1] as string[]).length > 0),
          ),
        }));
        break;
      }
      case 'removeClassroom': {
        next.classrooms = next.classrooms.filter(c => c.id !== action.classroomId);
        next.fixedAssignments = next.fixedAssignments.filter(f => f.classroomId !== action.classroomId);
        next.lessonGroups = next.lessonGroups.map(g => ({
          ...g,
          classroomIds: g.classroomIds.filter(id => id !== action.classroomId),
        }));
        next.subjects = next.subjects.map(s => {
          const pins = { ...(s.pinnedTeacherByClassroom || {}) };
          delete pins[action.classroomId];
          return {
            ...s,
            assignedClassIds: s.assignedClassIds.filter(id => id !== action.classroomId),
            pinnedTeacherByClassroom: pins,
          };
        });
        break;
      }
      case 'removeSubject': {
        next.subjects = next.subjects
          .filter(s => s.id !== action.subjectId)
          .map(s => (s.notSameDayWith && s.notSameDayWith.includes(action.subjectId)
            ? { ...s, notSameDayWith: s.notSameDayWith.filter(id => id !== action.subjectId) }
            : s));
        next.fixedAssignments = next.fixedAssignments.filter(f => f.subjectId !== action.subjectId);
        next.lessonGroups = next.lessonGroups.filter(g => g.subjectId !== action.subjectId);
        break;
      }
    }
  }
  return next;
};

/**
 * Çok satırlı komutu çözümler. Her satır, kendinden öncekiler uygulanmış gibi
 * değerlendirilir; böylece "önce öğretmeni ekle, sonra derse ata" aynı kutuya yazılabilir.
 */
export const parseCommands = (text: string, data: TimetableData): ParseResult => {
  const lines: ParsedLine[] = [];
  const actions: CommandAction[] = [];
  let draft = data;
  let context: CommandContext = {};
  for (const raw of text.split(/[\n;]+/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parsed = parseLine(trimmed, draft, context);
    lines.push(parsed);
    if (parsed.actions.length) {
      actions.push(...parsed.actions);
      draft = applyActions(draft, parsed.actions);
      for (const action of parsed.actions) {
        if (action.kind === 'addSubject') context = { subjectId: action.id, classIds: [...action.classroomIds] };
        else if (action.kind === 'assignClasses' || action.kind === 'pinTeacher') {
          context = { subjectId: action.subjectId, classIds: [...action.classroomIds] };
        } else if (action.kind === 'setHours') {
          context = { subjectId: action.subjectId, classIds: context.classIds };
        }
      }
    }
  }
  return { lines, actions, hasActions: actions.length > 0 };
};
