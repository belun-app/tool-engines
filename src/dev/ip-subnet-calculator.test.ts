import { describe, expect, it } from "vitest";
import { calculateSubnet } from "./ip-subnet-calculator.js";

describe("calculateSubnet", () => {
  it("computes a /24 (192.168.1.10)", () => {
    expect(calculateSubnet("192.168.1.10", 24)).toEqual({
      ok: true,
      error: "",
      address: "192.168.1.10",
      cidr: 24,
      cidrNotation: "192.168.1.0/24",
      netmask: "255.255.255.0",
      wildcardMask: "0.0.0.255",
      network: "192.168.1.0",
      broadcast: "192.168.1.255",
      firstHost: "192.168.1.1",
      lastHost: "192.168.1.254",
      totalAddresses: 256,
      usableHosts: 254,
      networkBits: 24,
      hostBits: 8,
      ipClass: "C",
      scope: "Private (RFC 1918)",
      binaryAddress: "11000000.10101000.00000001.00001010",
      binaryNetmask: "11111111.11111111.11111111.00000000",
      // 192*2^24 + 168*2^16 + 1*2^8 + 10
      decimalAddress: 3232235786,
      hexAddress: "C0.A8.01.0A",
      note: "",
    });
  });

  it("computes a non-octet boundary (/27 and /20)", () => {
    // /27 = 32 addresses; 10.0.0.77 lies in 10.0.0.64–95
    const a = calculateSubnet("10.0.0.77/27");
    expect(a.network).toBe("10.0.0.64");
    expect(a.broadcast).toBe("10.0.0.95");
    expect(a.netmask).toBe("255.255.255.224");
    expect(a.usableHosts).toBe(30);
    // /20 = 4096 addresses; 172.16.37.5 lies in 172.16.32.0–172.16.47.255
    const b = calculateSubnet("172.16.37.5", "255.255.240.0");
    expect(b.cidr).toBe(20);
    expect(b.network).toBe("172.16.32.0");
    expect(b.broadcast).toBe("172.16.47.255");
    expect(b.wildcardMask).toBe("0.0.15.255");
    expect(b.usableHosts).toBe(4094);
    expect(b.ipClass).toBe("B");
  });

  it("handles /31, /32 and /0 edge prefixes", () => {
    const p31 = calculateSubnet("10.0.0.1", 31);
    expect(p31.firstHost).toBe("10.0.0.0");
    expect(p31.lastHost).toBe("10.0.0.1");
    expect(p31.usableHosts).toBe(2);
    expect(p31.note).toMatch(/RFC 3021/);
    const p32 = calculateSubnet("8.8.8.8", "/32");
    expect(p32.totalAddresses).toBe(1);
    expect(p32.usableHosts).toBe(1);
    expect(p32.firstHost).toBe("8.8.8.8");
    expect(p32.scope).toBe("Public address");
    const p0 = calculateSubnet("8.8.8.8", "0.0.0.0");
    expect(p0.cidr).toBe(0);
    expect(p0.network).toBe("0.0.0.0");
    expect(p0.broadcast).toBe("255.255.255.255");
    expect(p0.totalAddresses).toBe(4294967296);
    expect(p0.usableHosts).toBe(4294967294);
  });

  it("keeps addresses above 2^31 unsigned", () => {
    const r = calculateSubnet("255.255.255.255", 32);
    expect(r.decimalAddress).toBe(4294967295);
    expect(r.hexAddress).toBe("FF.FF.FF.FF");
    expect(r.scope).toBe("Limited broadcast (255.255.255.255)");
    expect(r.ipClass).toBe("E");
  });

  it("classifies special-purpose blocks", () => {
    const scope = (ip: string) => calculateSubnet(ip).scope;
    expect(scope("0.1.2.3")).toBe("This network (RFC 1122)");
    expect(scope("10.255.0.1")).toBe("Private (RFC 1918)");
    expect(scope("172.31.255.255")).toBe("Private (RFC 1918)");
    expect(scope("172.32.0.1")).toBe("Public address");
    expect(scope("100.64.0.1")).toBe("Carrier-grade NAT (RFC 6598)");
    expect(scope("127.0.0.1")).toBe("Loopback (RFC 1122)");
    expect(scope("169.254.1.1")).toBe("Link-local / APIPA (RFC 3927)");
    expect(scope("192.0.2.1")).toBe("Documentation (RFC 5737)");
    expect(scope("198.51.100.7")).toBe("Documentation (RFC 5737)");
    expect(scope("203.0.113.9")).toBe("Documentation (RFC 5737)");
    expect(scope("198.19.1.1")).toBe("Benchmark testing (RFC 2544)");
    expect(scope("224.0.0.1")).toBe("Multicast (RFC 5771)");
    expect(scope("240.0.0.1")).toBe("Reserved, class E");
    expect(calculateSubnet("224.0.0.1").ipClass).toBe("D");
    expect(calculateSubnet("10.0.0.1").ipClass).toBe("A");
  });

  it("lets an inline prefix override the mask argument", () => {
    expect(calculateSubnet("10.0.0.1/8", 30).cidr).toBe(8);
    // an empty inline prefix falls back to the argument
    expect(calculateSubnet("10.0.0.1/", 16).cidr).toBe(16);
  });

  it("returns empty for blank input and errors for bad input", () => {
    expect(calculateSubnet("  ").ok).toBe(false);
    expect(calculateSubnet("  ").error).toBe("");
    expect(calculateSubnet("192.168.1").error).toMatch(/four numbers/);
    expect(calculateSubnet("a.b.c.d").error).toMatch(/four numbers/);
    expect(calculateSubnet("192.168.1.256").error).toMatch(/between 0 and 255/);
    expect(calculateSubnet("10.0.0.1", 33).error).toMatch(/between 0 and 32/);
    expect(calculateSubnet("10.0.0.1", -1).error).toMatch(/between 0 and 32/);
    expect(calculateSubnet("10.0.0.1", 24.5).error).toMatch(/between 0 and 32/);
    expect(calculateSubnet("10.0.0.1", "abc").error).toMatch(/prefix \(24\)/);
    expect(calculateSubnet("10.0.0.1", "255.255.300.0").error).toMatch(/prefix \(24\)/);
    expect(calculateSubnet("10.0.0.1", "255.0.255.0").error).toMatch(/contiguous/);
  });

  it("localises messages and scope in Russian", () => {
    expect(calculateSubnet("8.8.8.8", 24, "ru").scope).toBe("Публичный адрес");
    expect(calculateSubnet("10.0.0.1", 99, "ru").error).toBe(
      "Длина префикса должна быть от 0 до 32.",
    );
    expect(calculateSubnet("10.0.0.1", 32, "ru").note).toMatch(/^Префикс \/32/);
  });
});
