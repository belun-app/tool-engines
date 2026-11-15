/**
 * IPv4 subnet calculator.
 *
 * Takes an address plus a prefix length (or a dotted mask) and derives the network,
 * broadcast, usable host range, wildcard mask, and the address's registered scope.
 * Addresses are held as unsigned integers built with multiplication rather than shifts,
 * so values above 2^31 never go negative.
 */

export type SubnetLang = "en" | "ru";

export interface SubnetResult {
  ok: boolean;
  /** Human-readable problem, or "" when there is none. */
  error: string;
  /** The address as parsed, in dotted-quad form. */
  address: string;
  cidr: number;
  /** "192.168.1.0/24" — the network this address belongs to. */
  cidrNotation: string;
  netmask: string;
  wildcardMask: string;
  network: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  totalAddresses: number;
  usableHosts: number;
  networkBits: number;
  hostBits: number;
  /** Classful letter (A–E), kept because certifications and exams still ask for it. */
  ipClass: string;
  /** Registered use of the address block: private, loopback, multicast, public… */
  scope: string;
  binaryAddress: string;
  binaryNetmask: string;
  /** The address as a single unsigned integer, e.g. 3232235786. */
  decimalAddress: number;
  /** The address in hex, e.g. "C0.A8.01.0A". */
  hexAddress: string;
  /** Extra wording for edge prefixes (/31, /32) and special-purpose blocks. */
  note: string;
}

const EMPTY: SubnetResult = {
  ok: false,
  error: "",
  address: "",
  cidr: 0,
  cidrNotation: "",
  netmask: "",
  wildcardMask: "",
  network: "",
  broadcast: "",
  firstHost: "",
  lastHost: "",
  totalAddresses: 0,
  usableHosts: 0,
  networkBits: 0,
  hostBits: 0,
  ipClass: "",
  scope: "",
  binaryAddress: "",
  binaryNetmask: "",
  decimalAddress: 0,
  hexAddress: "",
  note: "",
};

type MessageKey =
  | "badAddress"
  | "badOctet"
  | "badPrefix"
  | "badMask"
  | "nonContiguous"
  | "note31"
  | "note32"
  | "note0";

const MESSAGES: Record<SubnetLang, Record<MessageKey, string>> = {
  en: {
    badAddress: "Enter an IPv4 address as four numbers separated by dots, e.g. 192.168.1.10.",
    badOctet: "Each part of the address has to be between 0 and 255.",
    badPrefix: "The prefix length has to be between 0 and 32.",
    badMask: "Enter the mask as a prefix (24) or dotted quad (255.255.255.0).",
    nonContiguous: "That mask isn't valid — the 1 bits have to be contiguous, e.g. 255.255.254.0.",
    note31:
      "A /31 is a point-to-point link (RFC 3021): there is no broadcast address and both addresses are usable.",
    note32: "A /32 is a single host route — one address, no network or broadcast address.",
    note0:
      "A /0 covers the entire IPv4 address space and is normally only seen in a default route.",
  },
  ru: {
    badAddress: "Введите IPv4-адрес из четырёх чисел, разделённых точками, например 192.168.1.10.",
    badOctet: "Каждая часть адреса должна быть от 0 до 255.",
    badPrefix: "Длина префикса должна быть от 0 до 32.",
    badMask: "Укажите маску как префикс (24) или в виде 255.255.255.0.",
    nonContiguous:
      "Такая маска недопустима: единичные биты должны идти подряд, например 255.255.254.0.",
    note31:
      "Префикс /31 — это соединение точка-точка (RFC 3021): широковещательного адреса нет, оба адреса используются как хостовые.",
    note32: "Префикс /32 — маршрут до одного хоста: один адрес, без адресов сети и широковещания.",
    note0:
      "Префикс /0 покрывает всё адресное пространство IPv4 и встречается только в маршруте по умолчанию.",
  },
};

interface SpecialBlock {
  /** Network address as an integer. */
  base: number;
  prefix: number;
  en: string;
  ru: string;
}

/** Checked in order — the first match wins, so narrower blocks come first. */
const SPECIAL_BLOCKS: SpecialBlock[] = [
  {
    base: 4294967295,
    prefix: 32,
    en: "Limited broadcast (255.255.255.255)",
    ru: "Ограниченное широковещание (255.255.255.255)",
  },
  { base: 0, prefix: 8, en: "This network (RFC 1122)", ru: "Текущая сеть (RFC 1122)" },
  { base: 167772160, prefix: 8, en: "Private (RFC 1918)", ru: "Частная сеть (RFC 1918)" },
  { base: 2886729728, prefix: 12, en: "Private (RFC 1918)", ru: "Частная сеть (RFC 1918)" },
  { base: 3232235520, prefix: 16, en: "Private (RFC 1918)", ru: "Частная сеть (RFC 1918)" },
  {
    base: 1681915904,
    prefix: 10,
    en: "Carrier-grade NAT (RFC 6598)",
    ru: "Carrier-grade NAT (RFC 6598)",
  },
  { base: 2130706432, prefix: 8, en: "Loopback (RFC 1122)", ru: "Локальная петля (RFC 1122)" },
  {
    base: 2851995648,
    prefix: 16,
    en: "Link-local / APIPA (RFC 3927)",
    ru: "Link-local / APIPA (RFC 3927)",
  },
  { base: 3221225984, prefix: 24, en: "Documentation (RFC 5737)", ru: "Документация (RFC 5737)" },
  { base: 3325256704, prefix: 24, en: "Documentation (RFC 5737)", ru: "Документация (RFC 5737)" },
  { base: 3405803776, prefix: 24, en: "Documentation (RFC 5737)", ru: "Документация (RFC 5737)" },
  {
    base: 3323068416,
    prefix: 15,
    en: "Benchmark testing (RFC 2544)",
    ru: "Тестирование производительности (RFC 2544)",
  },
  {
    base: 3758096384,
    prefix: 4,
    en: "Multicast (RFC 5771)",
    ru: "Многоадресная рассылка (RFC 5771)",
  },
  { base: 4026531840, prefix: 4, en: "Reserved, class E", ru: "Зарезервировано, класс E" },
];

function maskInt(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 4294967295;
  return 4294967296 - 2 ** (32 - prefix);
}

function toOctets(value: number): number[] {
  return [
    Math.floor(value / 16777216) % 256,
    Math.floor(value / 65536) % 256,
    Math.floor(value / 256) % 256,
    value % 256,
  ];
}

function intToDotted(value: number): string {
  return toOctets(value).join(".");
}

function toBinary(value: number): string {
  return toOctets(value)
    .map((octet) => octet.toString(2).padStart(8, "0"))
    .join(".");
}

function toHex(value: number): string {
  return toOctets(value)
    .map((octet) => octet.toString(16).toUpperCase().padStart(2, "0"))
    .join(".");
}

/** Parses a dotted quad into an unsigned integer, or null if it isn't one. */
function parseDotted(text: string): number | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Prefix length of a dotted mask, or null when the 1 bits aren't contiguous. */
function maskToPrefix(value: number): number | null {
  for (let prefix = 0; prefix <= 32; prefix++) {
    if (maskInt(prefix) === value) return prefix;
  }
  return null;
}

function classOf(firstOctet: number): string {
  if (firstOctet < 128) return "A";
  if (firstOctet < 192) return "B";
  if (firstOctet < 224) return "C";
  if (firstOctet < 240) return "D";
  return "E";
}

function scopeOf(value: number, lang: SubnetLang): string {
  for (const block of SPECIAL_BLOCKS) {
    const blockSize = 2 ** (32 - block.prefix);
    if (value - (value % blockSize) === block.base) {
      return lang === "ru" ? block.ru : block.en;
    }
  }
  return lang === "ru" ? "Публичный адрес" : "Public address";
}

/**
 * Calculates the subnet an address belongs to.
 *
 * `mask` accepts a prefix length (24, "24", "/24") or a dotted mask ("255.255.255.0").
 * A prefix written into the address itself ("10.0.0.0/8") always wins.
 */
export function calculateSubnet(
  addressInput: string,
  mask: string | number = 24,
  lang: SubnetLang = "en",
): SubnetResult {
  const t = MESSAGES[lang];
  const raw = addressInput.trim();
  if (!raw) return { ...EMPTY };

  let addressPart = raw;
  let maskPart: string | number = mask;
  const slash = raw.indexOf("/");
  if (slash >= 0) {
    addressPart = raw.slice(0, slash).trim();
    const inlineMask = raw.slice(slash + 1).trim();
    if (inlineMask) maskPart = inlineMask;
  }

  const addressValue = parseDotted(addressPart);
  if (addressValue === null) {
    const parts = addressPart.split(".");
    const looksLikeQuad = parts.length === 4 && parts.every((p) => /^\d+$/.test(p));
    return { ...EMPTY, error: looksLikeQuad ? t.badOctet : t.badAddress };
  }

  let cidr: number;
  if (typeof maskPart === "number") {
    cidr = maskPart;
  } else {
    const cleaned = maskPart.replace(/^\//, "").trim();
    if (/^\d{1,2}$/.test(cleaned)) {
      cidr = Number(cleaned);
    } else if (cleaned.includes(".")) {
      const maskValue = parseDotted(cleaned);
      if (maskValue === null) return { ...EMPTY, error: t.badMask };
      const prefix = maskToPrefix(maskValue);
      if (prefix === null) return { ...EMPTY, error: t.nonContiguous };
      cidr = prefix;
    } else {
      return { ...EMPTY, error: t.badMask };
    }
  }
  if (!Number.isInteger(cidr) || cidr < 0 || cidr > 32) {
    return { ...EMPTY, error: t.badPrefix };
  }

  const netmask = maskInt(cidr);
  const blockSize = 2 ** (32 - cidr);
  const network = addressValue - (addressValue % blockSize);
  const broadcast = network + blockSize - 1;
  const wildcard = 4294967295 - netmask;

  let firstHost = network;
  let lastHost = broadcast;
  let usableHosts = blockSize;
  if (cidr <= 30) {
    firstHost = network + 1;
    lastHost = broadcast - 1;
    usableHosts = blockSize - 2;
  }

  const notes: string[] = [];
  if (cidr === 32) notes.push(t.note32);
  if (cidr === 31) notes.push(t.note31);
  if (cidr === 0) notes.push(t.note0);

  return {
    ok: true,
    error: "",
    address: intToDotted(addressValue),
    cidr,
    cidrNotation: `${intToDotted(network)}/${cidr}`,
    netmask: intToDotted(netmask),
    wildcardMask: intToDotted(wildcard),
    network: intToDotted(network),
    broadcast: intToDotted(broadcast),
    firstHost: intToDotted(firstHost),
    lastHost: intToDotted(lastHost),
    totalAddresses: blockSize,
    usableHosts,
    networkBits: cidr,
    hostBits: 32 - cidr,
    ipClass: classOf(toOctets(addressValue)[0]),
    scope: scopeOf(addressValue, lang),
    binaryAddress: toBinary(addressValue),
    binaryNetmask: toBinary(netmask),
    decimalAddress: addressValue,
    hexAddress: toHex(addressValue),
    note: notes.join(" "),
  };
}
