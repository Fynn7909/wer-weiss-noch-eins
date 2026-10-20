// Text-Helfer: alles, was "gleich geschrieben" zählt, landet auf demselben Schlüssel.

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Vergleichsschlüssel: Groß/klein, Leerzeichen, Bindestriche, ä/ae/a, ß/ss egal. */
export function normalize(text) {
  return stripAccents(
    String(text)
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .replace(/ä/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/ü/g, 'u'),
  )
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/[^a-z0-9]/g, '');
}

/** Erster Buchstabe so, wie getippt wurde (Ä→A, É→E). Leer, wenn keiner da ist. */
export function initialLetter(text) {
  const match = stripAccents(String(text).trim()).match(/[A-Za-z]/);
  return match ? match[0].toUpperCase() : '';
}

/** true, wenn a und b höchstens eine Einfügung, Löschung oder Ersetzung auseinander liegen. */
export function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (la - i) + (lb - j) <= 1;
}
