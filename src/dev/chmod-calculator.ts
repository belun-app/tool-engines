export type ChmodLang = "en" | "ru";

export interface PermissionTriad {
  read: boolean;
  write: boolean;
  execute: boolean;
}

export interface Permissions {
  owner: PermissionTriad;
  group: PermissionTriad;
  others: PermissionTriad;
  setuid: boolean;
  setgid: boolean;
  sticky: boolean;
}

export interface ChmodResult {
  /** Shortest numeric form, e.g. "755" or "4755" when special bits are set */
  numeric: string;
  /** Always four octal digits, e.g. "0755" */
  numericFull: string;
  /** Nine-character symbolic form, e.g. "rwxr-xr-x" */
  symbolic: string;
  /** ls -l style string with a leading file-type placeholder, e.g. "-rwxr-xr-x" */
  ls: string;
  /** chmod command you would run, e.g. "chmod 755 file" */
  command: string;
  /** Plain-English lines, one per audience plus any special bits */
  explanation: string[];
  permissions: Permissions;
  isValid: boolean;
}

const EMPTY_TRIAD: PermissionTriad = { read: false, write: false, execute: false };

function emptyPermissions(): Permissions {
  return {
    owner: { ...EMPTY_TRIAD },
    group: { ...EMPTY_TRIAD },
    others: { ...EMPTY_TRIAD },
    setuid: false,
    setgid: false,
    sticky: false,
  };
}

function triadFromDigit(digit: number): PermissionTriad {
  return {
    read: (digit & 4) !== 0,
    write: (digit & 2) !== 0,
    execute: (digit & 1) !== 0,
  };
}

function triadToDigit(triad: PermissionTriad): number {
  return (triad.read ? 4 : 0) + (triad.write ? 2 : 0) + (triad.execute ? 1 : 0);
}

/** Parse a numeric mode such as "755", "0644", or "4755". Returns null on invalid input. */
export function parseNumeric(input: string): Permissions | null {
  const trimmed = input.trim();
  if (!/^[0-7]{3,4}$/.test(trimmed)) return null;

  const digits = trimmed.length === 4 ? trimmed : `0${trimmed}`;
  const special = Number.parseInt(digits[0], 8);
  const perms = emptyPermissions();

  perms.setuid = (special & 4) !== 0;
  perms.setgid = (special & 2) !== 0;
  perms.sticky = (special & 1) !== 0;
  perms.owner = triadFromDigit(Number.parseInt(digits[1], 8));
  perms.group = triadFromDigit(Number.parseInt(digits[2], 8));
  perms.others = triadFromDigit(Number.parseInt(digits[3], 8));

  return perms;
}

function parseTriad(
  chars: string,
  execChar: string,
  execUpper: string,
): { triad: PermissionTriad; special: boolean } | null {
  const [r, w, x] = chars;
  if (r !== "r" && r !== "-") return null;
  if (w !== "w" && w !== "-") return null;

  let execute: boolean;
  let special = false;
  if (x === "x" || x === "-") {
    execute = x === "x";
  } else if (x === execChar) {
    execute = true;
    special = true;
  } else if (x === execUpper) {
    execute = false;
    special = true;
  } else {
    return null;
  }

  return { triad: { read: r === "r", write: w === "w", execute }, special };
}

/**
 * Parse a symbolic mode such as "rwxr-xr-x" or "-rwsr-xr-t". A leading
 * file-type character (- d l etc.) is tolerated. Returns null on invalid input.
 */
export function parseSymbolic(input: string): Permissions | null {
  let body = input.trim();
  if (body.length === 10) body = body.slice(1);
  if (body.length !== 9) return null;

  const owner = parseTriad(body.slice(0, 3), "s", "S");
  const group = parseTriad(body.slice(3, 6), "s", "S");
  const others = parseTriad(body.slice(6, 9), "t", "T");
  if (!owner || !group || !others) return null;

  const perms = emptyPermissions();
  perms.owner = owner.triad;
  perms.group = group.triad;
  perms.others = others.triad;
  perms.setuid = owner.special;
  perms.setgid = group.special;
  perms.sticky = others.special;

  return perms;
}

function symbolicTriad(
  triad: PermissionTriad,
  special: boolean,
  specialChar: string,
  specialUpper: string,
): string {
  const r = triad.read ? "r" : "-";
  const w = triad.write ? "w" : "-";
  let x: string;
  if (special) {
    x = triad.execute ? specialChar : specialUpper;
  } else {
    x = triad.execute ? "x" : "-";
  }
  return `${r}${w}${x}`;
}

interface Labels {
  owner: string;
  group: string;
  others: string;
  read: string;
  write: string;
  execute: string;
  none: string;
  and: string;
  setuid: string;
  setgid: string;
  sticky: string;
}

const LABELS: Record<ChmodLang, Labels> = {
  en: {
    owner: "Owner (user)",
    group: "Group",
    others: "Others",
    read: "read",
    write: "write",
    execute: "execute",
    none: "no access",
    and: "and",
    setuid: "Setuid bit is set — the file runs with the owner's user ID.",
    setgid:
      "Setgid bit is set — the file runs with the group's ID, and new files in a directory inherit its group.",
    sticky: "Sticky bit is set — inside a directory, only a file's owner can delete or rename it.",
  },
  ru: {
    owner: "Владелец",
    group: "Группа",
    others: "Остальные",
    read: "чтение",
    write: "запись",
    execute: "выполнение",
    none: "нет доступа",
    and: "и",
    setuid: "Бит setuid установлен — файл запускается с идентификатором владельца.",
    setgid:
      "Бит setgid установлен — файл запускается с идентификатором группы, а новые файлы в каталоге наследуют эту группу.",
    sticky:
      "Бит sticky установлен — в каталоге удалять и переименовывать файл может только его владелец.",
  },
};

function joinList(parts: string[], and: string): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} ${and} ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} ${and} ${parts[parts.length - 1]}`;
}

function describeTriad(triad: PermissionTriad, labels: Labels): string {
  const parts: string[] = [];
  if (triad.read) parts.push(labels.read);
  if (triad.write) parts.push(labels.write);
  if (triad.execute) parts.push(labels.execute);
  if (parts.length === 0) return labels.none;
  return joinList(parts, labels.and);
}

/** Build the full result (numeric, symbolic, ls, explanation) from a permission set. */
export function describeChmod(perms: Permissions, lang: ChmodLang = "en"): ChmodResult {
  const labels = LABELS[lang];
  const specialDigit = (perms.setuid ? 4 : 0) + (perms.setgid ? 2 : 0) + (perms.sticky ? 1 : 0);
  const ownerDigit = triadToDigit(perms.owner);
  const groupDigit = triadToDigit(perms.group);
  const othersDigit = triadToDigit(perms.others);

  const numericFull = `${specialDigit}${ownerDigit}${groupDigit}${othersDigit}`;
  const numeric = specialDigit === 0 ? numericFull.slice(1) : numericFull;

  const symbolic =
    symbolicTriad(perms.owner, perms.setuid, "s", "S") +
    symbolicTriad(perms.group, perms.setgid, "s", "S") +
    symbolicTriad(perms.others, perms.sticky, "t", "T");

  const explanation = [
    `${labels.owner}: ${describeTriad(perms.owner, labels)}.`,
    `${labels.group}: ${describeTriad(perms.group, labels)}.`,
    `${labels.others}: ${describeTriad(perms.others, labels)}.`,
  ];
  if (perms.setuid) explanation.push(labels.setuid);
  if (perms.setgid) explanation.push(labels.setgid);
  if (perms.sticky) explanation.push(labels.sticky);

  return {
    numeric,
    numericFull,
    symbolic,
    ls: `-${symbolic}`,
    command: `chmod ${numeric} file`,
    explanation,
    permissions: perms,
    isValid: true,
  };
}

function invalidResult(): ChmodResult {
  return {
    numeric: "",
    numericFull: "",
    symbolic: "",
    ls: "",
    command: "",
    explanation: [],
    permissions: emptyPermissions(),
    isValid: false,
  };
}

/** Parse either a numeric (755) or symbolic (rwxr-xr-x) mode and describe it. */
export function calculateChmod(input: string, lang: ChmodLang = "en"): ChmodResult {
  const trimmed = input.trim();
  if (!trimmed) return describeChmod(emptyPermissions(), lang);

  const perms = parseNumeric(trimmed) ?? parseSymbolic(trimmed);
  if (!perms) return invalidResult();
  return describeChmod(perms, lang);
}
