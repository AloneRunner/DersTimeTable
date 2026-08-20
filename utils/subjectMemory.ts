const SUBJECT_MEMORY_KEY = 'ozarik.subject-names.v1';

export const loadRememberedSubjectNames = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SUBJECT_MEMORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string' && item.trim()) : [];
  } catch {
    return [];
  }
};

export const rememberSubjectName = (name: string): void => {
  if (typeof window === 'undefined') return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const names = loadRememberedSubjectNames();
  if (!names.some(item => item.localeCompare(trimmed, 'tr', { sensitivity: 'base' }) === 0)) {
    names.push(trimmed);
  }
  try {
    window.localStorage.setItem(SUBJECT_MEMORY_KEY, JSON.stringify(names.sort((a, b) => a.localeCompare(b, 'tr'))));
  } catch {
    // Öneri hafızası dolsa bile ana çalışma kaydı ve form çalışmaya devam eder.
  }
};
