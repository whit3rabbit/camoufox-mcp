# Privacy & Security

Camoufox MCP Server uses the Camoufox browser, which includes:
- Fingerprint spoofing to prevent tracking
- Built-in uBlock Origin for ad blocking
- WebGL and WebRTC spoofing
- Canvas fingerprint protection
- Timezone and locale spoofing

Server-side URL policy is intended to keep the browser tool from being used as a local-network probe. It validates initial URLs, redirects, final URLs, subresource requests, and WebSocket targets against private, local, link-local, multicast, and reserved address space.

This protection is still best-effort unless the deployment also enforces network egress controls. For locked-down deployments, pair the MCP server with a container, VM, or host firewall that denies egress to RFC1918 ranges, loopback, link-local addresses, cloud metadata IPs such as `169.254.169.254`, multicast, and reserved networks.

For Docker deployments, do not rely on application checks alone. Run the container on a network whose egress policy denies at least `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `224.0.0.0/4`, `::1/128`, `fc00::/7`, `fe80::/10`, and `ff00::/8`.
