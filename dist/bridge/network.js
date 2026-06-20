import * as os from "node:os";
//#region src/network.ts
/**
* Network utility functions for the bridge.
*
* Provides helpers for enumerating LAN IP addresses from
* the host's network interfaces.
*/
/**
* Get all LAN-facing IPv4 addresses on this host.
*
* Filters out:
* - Internal/loopback addresses (127.x.x.x)
* - Link-local addresses (169.254.x.x)
* - IPv6 addresses
*
* @returns Array of IPv4 address strings
*/
function getLanIps() {
	const interfaces = os.networkInterfaces();
	const ips = [];
	for (const entries of Object.values(interfaces)) {
		if (!entries) continue;
		for (const entry of entries) {
			if (entry.family !== "IPv4") continue;
			if (entry.internal) continue;
			const addr = entry.address;
			if (addr.startsWith("169.254.")) continue;
			ips.push(addr);
		}
	}
	return ips;
}
/**
* Check if an IPv4 address falls within the Tailscale CGNAT range.
*
* Tailscale assigns IPs from 100.64.0.0/10 (100.64.0.0 – 100.127.255.255).
*
* @param addr IPv4 address string
* @returns true if the address is in the Tailscale range
*/
function isTailscaleIp(addr) {
	const parts = addr.split(".").map(Number);
	if (parts.length !== 4) return false;
	if (parts.some(isNaN)) return false;
	return parts[0] === 100 && (parts[1] & 192) === 64;
}
//#endregion
export { getLanIps, isTailscaleIp };
