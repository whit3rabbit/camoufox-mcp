# Privacy & Security

Camoufox MCP Server uses the Camoufox browser, which includes:
- Fingerprint spoofing to prevent tracking
- Built-in uBlock Origin for ad blocking
- WebGL and WebRTC spoofing
- Canvas fingerprint protection
- Timezone and locale spoofing

Server-side URL policy is intended to keep the browser tool from being used as a local-network probe. It validates initial URLs, redirects, final URLs, intercepted subresource requests, and intercepted page/iframe WebSocket targets against private, local, link-local, multicast, and reserved address space.

For trusted development sites, `CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS` grants exact hostnames access to loopback and private addresses. The setting also applies to proxy URLs. Each entry expands what browser tools can reach; see [local development sites](server-policy.md#local-development-sites) for setup and the address ranges that remain blocked.

Dedicated-worker WebSockets evade Playwright's frame-based routing. Local browser probes confirmed a worker connected to a local WebSocket server without invoking the routing callback on both the default beta.28 and compatibility beta.33 builds. See [browser compatibility evidence](browser-compatibility.md#remaining-network-and-output-limits).

This protection is best-effort. For untrusted URLs, enforce egress rules through a VM, host firewall, filtering proxy, or controlled container network. Deny RFC1918 ranges, loopback, link-local addresses, cloud metadata IPs such as `169.254.169.254`, multicast, and reserved networks.

For Docker deployments, do not rely on application checks alone. Run the container on a network whose egress policy denies at least `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `::1/128`, `fc00::/7`, `fe80::/10`, and `ff00::/8`.
