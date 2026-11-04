# Reaching the app from outside your network

The app is built for a home network. Only put it on the internet behind a reverse proxy that adds HTTPS. Sign-in uses your Jellyfin administrator password, which must never travel over plain HTTP.

The safer choice is not to expose it at all and use a VPN instead, such as Tailscale or WireGuard.

## What the app does to protect itself

- **Administrators only.** Sign-in checks the username and password with Jellyfin, and only Jellyfin administrators get in.
- **Sign-in limit.** After 5 failed sign-ins from one address, or for one username, that address or username is locked for 15 minutes.
- **First-run setup code.** Until Jellyfin is connected, the setup page asks for a code printed in the app's log at start-up:

  ```bash
  docker logs maverick-jellyfin-complete
  ```

  Without it, anyone who reached a fresh install could connect it to their own Jellyfin first. Set `SETUP_CODE` to choose the code yourself for a scripted install.
- **Cookies.** Session cookies are `HttpOnly` and `SameSite=Strict`. Every change needs a CSRF token. Cookies are `Secure` when the request came over HTTPS.
- **Headers.** Every page sends a strict Content-Security-Policy (no inline scripts, no third-party sources), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`. Pages served over HTTPS also send HSTS.
- **Keys.** API keys are encrypted at rest with `/config/secret.key` and never shown or logged.

## Behind a reverse proxy

Set `TRUST_PROXY=1` so the app believes the proxy's `X-Forwarded-For` (the client's address, for the sign-in limit) and `X-Forwarded-Proto` (whether the browser used HTTPS, for `Secure` cookies and HSTS):

```yaml
    environment:
      TRUST_PROXY: "1"
```

Only set it when the app is reachable **only** through the proxy. Otherwise a client could claim any address and get around the sign-in limit. In the stack file, publish the port on localhost only, or not at all if the proxy shares a Docker network with the app:

```yaml
    ports:
      - "127.0.0.1:8097:8097"
```

Give the app its own host name, such as `collections.example.com`. It doesn't support running under a sub-path like `example.com/collections`.

### Caddy

```
collections.example.com {
    reverse_proxy 127.0.0.1:8097
}
```

Caddy gets and renews the certificate itself, and sends `X-Forwarded-For` and `X-Forwarded-Proto` by default.

### nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name collections.example.com;
    ssl_certificate     /etc/letsencrypt/live/collections.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/collections.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8097;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Use `$remote_addr`, not `$proxy_add_x_forwarded_for`. The app reads the first address in the header, so a client must not be able to supply it.

### Traefik (labels on the app's container)

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.collections.rule=Host(`collections.example.com`)
      - traefik.http.routers.collections.entrypoints=websecure
      - traefik.http.routers.collections.tls.certresolver=letsencrypt
      - traefik.http.services.collections.loadbalancer.server.port=8097
```

## Things the app can't protect

- **Jellyfin's own exposure.** The app talks to Jellyfin with an API key over whatever address you gave it. Keep that address on your network.
- **Brute force against Jellyfin itself.** Jellyfin has its own sign-in limits; check them in Jellyfin's settings.
