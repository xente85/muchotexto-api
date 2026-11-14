import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';

const privateRanges = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) privateRanges.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) privateRanges.addSubnet(net, prefix, 'ipv6');

export function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function isPrivateAddress(address) {
  const family = isIP(address);
  if (!family) return false;
  // IPv4 mapeada en IPv6 (::ffff:127.0.0.1)
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateRanges.check(mapped[1], 'ipv4');
  return privateRanges.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** true si el host de la URL resuelve a una dirección de red local o reservada. */
export async function pointsToPrivateNetwork(url, resolve = lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (isIP(host)) return isPrivateAddress(host);
  const addresses = await resolve(host, { all: true });
  return addresses.some(({ address }) => isPrivateAddress(address));
}
