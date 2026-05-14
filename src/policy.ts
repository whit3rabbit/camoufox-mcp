import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface ParsedTargetUrl {
  parsed: URL;
  hostname: string;
  needsDnsCheck: boolean;
}

type Ipv6Cidr = {
  base: bigint;
  prefix: number;
};

export function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");
}

export function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "local"
    || hostname.endsWith(".local")
    || hostname === "ip6-localhost"
    || hostname === "ip6-loopback"
  );
}

export function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second, third] = parts;
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 192 && second === 168)
    || (first === 198 && second === 51 && third === 100)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 203 && second === 0 && third === 113);
}

export function ipv4FromMappedIpv6(address: string): string | undefined {
  const dotted = address.match(/^(?:::|0(?::0){4}:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    return dotted[1];
  }

  const separatorParts = address.split("::");
  if (separatorParts.length > 2) {
    return undefined;
  }

  const head = separatorParts[0] ? separatorParts[0].split(":") : [];
  const tail = separatorParts[1] ? separatorParts[1].split(":") : [];
  const fillCount = separatorParts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fillCount < 0 || (separatorParts.length === 1 && head.length !== 8)) {
    return undefined;
  }

  const hextets = [
    ...head,
    ...Array<string>(fillCount).fill("0"),
    ...tail,
  ].map((hextet) => hextet.padStart(4, "0"));

  if (hextets.length !== 8 || !hextets.slice(0, 5).every((hextet) => hextet === "0000") || hextets[5] !== "ffff") {
    return undefined;
  }

  const high = Number.parseInt(hextets[6], 16);
  const low = Number.parseInt(hextets[7], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return undefined;
  }

  return [
    high >> 8,
    high & 255,
    low >> 8,
    low & 255,
  ].join(".");
}

function expandEmbeddedIpv4(address: string): string | undefined {
  if (!address.includes(".")) {
    return address;
  }

  const lastColon = address.lastIndexOf(":");
  if (lastColon < 0) {
    return undefined;
  }

  const ipv4 = address.slice(lastColon + 1);
  if (isIP(ipv4) !== 4 || isBlockedIpv4(ipv4)) {
    return undefined;
  }

  const [first, second, third, fourth] = ipv4.split(".").map((part) => Number.parseInt(part, 10));
  const high = ((first << 8) | second).toString(16);
  const low = ((third << 8) | fourth).toString(16);
  return `${address.slice(0, lastColon)}:${high}:${low}`;
}

function parseIpv6ToBigInt(address: string): bigint | undefined {
  const expanded = expandEmbeddedIpv4(address.toLowerCase());
  if (!expanded) {
    return undefined;
  }

  const separatorParts = expanded.split("::");
  if (separatorParts.length > 2) {
    return undefined;
  }

  const head = separatorParts[0] ? separatorParts[0].split(":") : [];
  const tail = separatorParts[1] ? separatorParts[1].split(":") : [];
  const allExplicit = [...head, ...tail];
  if (allExplicit.some((hextet) => !/^[0-9a-f]{1,4}$/.test(hextet))) {
    return undefined;
  }

  const fillCount = separatorParts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fillCount < 0 || (separatorParts.length === 1 && head.length !== 8)) {
    return undefined;
  }

  const hextets = [
    ...head,
    ...Array<string>(fillCount).fill("0"),
    ...tail,
  ];
  if (hextets.length !== 8) {
    return undefined;
  }

  let value = 0n;
  for (const hextet of hextets) {
    value = (value << 16n) | BigInt(Number.parseInt(hextet, 16));
  }

  return value;
}

function buildIpv6Cidr(base: string, prefix: number): Ipv6Cidr {
  const value = parseIpv6ToBigInt(base);
  if (value === undefined) {
    throw new Error(`Invalid IPv6 CIDR base: ${base}`);
  }

  return { base: value, prefix };
}

const BLOCKED_IPV6_CIDRS: Ipv6Cidr[] = [
  buildIpv6Cidr("::", 128),
  buildIpv6Cidr("::1", 128),
  buildIpv6Cidr("64:ff9b::", 96),
  buildIpv6Cidr("64:ff9b:1::", 48),
  buildIpv6Cidr("100::", 64),
  buildIpv6Cidr("2001::", 23),
  buildIpv6Cidr("2001:db8::", 32),
  buildIpv6Cidr("2002::", 16),
  buildIpv6Cidr("fc00::", 7),
  buildIpv6Cidr("fe80::", 10),
  buildIpv6Cidr("ff00::", 8),
];

function isIpv6InCidr(address: bigint, cidr: Ipv6Cidr): boolean {
  const shift = 128n - BigInt(cidr.prefix);
  return (address >> shift) === (cidr.base >> shift);
}

export function isBlockedIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(lower);
  if (mappedIpv4) {
    return isBlockedIpv4(mappedIpv4);
  }

  const value = parseIpv6ToBigInt(lower);
  if (value === undefined) {
    return true;
  }

  return BLOCKED_IPV6_CIDRS.some((cidr) => isIpv6InCidr(value, cidr));
}

export function isBlockedIp(address: string): boolean {
  const normalized = normalizeHostname(address);
  const version = isIP(normalized);
  if (version === 4) {
    return isBlockedIpv4(normalized);
  }

  if (version === 6) {
    return isBlockedIpv6(normalized);
  }

  return true;
}

export function parseAndValidateTargetUrl(rawUrl: string): ParsedTargetUrl {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL must be fully qualified.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    throw new Error("URL host is required.");
  }

  if (isBlockedHostname(hostname)) {
    throw new Error("Local hostnames are not allowed.");
  }

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error("Private, local, or reserved IP addresses are not allowed.");
    }
    return {
      parsed,
      hostname,
      needsDnsCheck: false,
    };
  }

  return {
    parsed,
    hostname,
    needsDnsCheck: true,
  };
}

export async function validateTargetUrl(rawUrl: string): Promise<URL> {
  const { parsed, hostname, needsDnsCheck } = parseAndValidateTargetUrl(rawUrl);

  if (!needsDnsCheck) {
    return parsed;
  }

  let records: Array<{ address: string }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Could not resolve URL host.");
  }

  if (records.length === 0) {
    throw new Error("URL host did not resolve to an address.");
  }

  if (records.some((record) => isBlockedIp(record.address))) {
    throw new Error("URL host resolves to a private, local, or reserved address.");
  }

  return parsed;
}

export function browserRequestPolicyUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL must be fully qualified.");
  }

  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }

  return parsed.toString();
}

export function parseAndValidateBrowserRequestUrl(rawUrl: string): ParsedTargetUrl {
  return parseAndValidateTargetUrl(browserRequestPolicyUrl(rawUrl));
}

export async function validateBrowserRequestUrl(rawUrl: string): Promise<URL> {
  return validateTargetUrl(browserRequestPolicyUrl(rawUrl));
}
