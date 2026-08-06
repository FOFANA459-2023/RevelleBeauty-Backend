# Hosting the API on Oracle Cloud (Always Free)

Genuinely free, never sleeps. Roughly 30 minutes end to end.

## 1. Create the VM (Oracle console)

**Compute → Instances → Create instance**

| Setting | Value |
|---|---|
| Image | Canonical **Ubuntu 24.04** (change from the Oracle Linux default) |
| Shape | **VM.Standard.A1.Flex** (Ampere ARM), 2 OCPU / 12 GB |
| SSH keys | Upload your public key, or let Oracle generate one — **save it** |

**Shape.** Both A1.Flex and E2.1.Micro are Always Free, but E2.1.Micro has
only **1 GB RAM** — not enough to build the image (two `npm ci` passes plus
`tsc` get OOM-killed). `setup-vm.sh` adds a 2 GB swap file automatically on
small instances, which makes the build succeed, but A1.Flex is far more
comfortable.

If you are stuck on E2.1.Micro, there is a shortcut: it is **x86_64**, so it
can pull the prebuilt image CI already publishes instead of building at all:

```bash
docker pull ghcr.io/fofana459-2023/revellebeauty-backend:latest
# then in docker-compose.yml, replace the api service's `build:` block with
#   image: ghcr.io/fofana459-2023/revellebeauty-backend:latest
```

A1.Flex is ARM, so it must build locally — CI publishes x86 images only.

**Image.** Oracle Linux is the console default, but Docker's install script
does not officially support it. `setup-vm.sh` handles both (it falls back to
the CentOS repo on OL/RHEL), though Ubuntu is the smoother path.

> *"Out of host capacity"* on A1.Flex is Oracle rationing free ARM capacity,
> not a configuration mistake. Retry later, try another availability domain,
> or fall back to E2.1.Micro with the swap file.

**Region note:** your Supabase project is in `ap-south-1` (Mumbai). A VM in
Tokyo adds roughly 100 ms per database round trip. The caching layer absorbs
most of this — repeat catalog requests serve from memory in ~5 ms — so it is
acceptable, just not optimal.

## 2. Provision it

SSH in, then:

```bash
curl -fsSL https://raw.githubusercontent.com/FOFANA459-2023/RevelleBeauty-Backend/main/deploy/setup-vm.sh | bash
```

That installs Docker, clones the repo, and writes `deploy/.env` from the
template. Fill in the secrets:

```bash
cd ~/revelle-api/deploy
nano .env          # DATABASE_URL, SUPABASE_*, ADMIN_* — see comments in the file
docker compose up -d --build
docker compose logs -f api
```

The image builds natively on ARM, so `sharp` gets the right binaries.
Migrations run automatically at boot.

## 3. Expose it — two options

### A. Cloudflare Tunnel (recommended)

No open inbound ports, no TLS certificates to manage, and the VM's IP stays
private. **Requires a domain on your Cloudflare account** (you currently have
none — Cloudflare Registrar sells `.com` at cost, ~$10/yr, and you need one
for the storefront anyway).

1. Add the domain to Cloudflare (**Add a site**, follow the nameserver steps).
2. **Zero Trust → Networks → Tunnels → Create a tunnel** → Cloudflared →
   name it `revelle-api`.
3. Copy the **tunnel token** into `deploy/.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
4. Add a **public hostname**: `api.yourdomain.com` → type `HTTP` →
   URL `api:4000` (the compose service name).
5. `docker compose up -d` — the `cloudflared` container connects outbound.

Then point the storefront at it, from the **frontend** repo:

```bash
npx wrangler deploy --var API_ORIGIN:https://api.yourdomain.com
```

### B. Direct IP (no domain — testing only)

Two firewalls must both allow the port, which is the classic Oracle trap:

1. **Oracle console**: Networking → VCN → Security Lists → add an ingress
   rule for TCP **4000** from `0.0.0.0/0`.
2. **On the VM** — Oracle images ship with iptables blocking everything but
   SSH, so the console rule alone is not enough:

```bash
sudo iptables -I INPUT 6 -p tcp --dport 4000 -j ACCEPT
sudo netfilter-persistent save    # survives reboot
```

3. In `deploy/docker-compose.yml`, uncomment the `ports:` block on `api` and
   comment out the whole `cloudflared` service, then `docker compose up -d`.
4. Point the storefront at `http://<vm-public-ip>:4000`.

> ⚠️ The Cloudflare→VM hop is **unencrypted** in this mode. Session cookies
> and the admin password cross the public internet in plaintext. Fine for
> kicking the tyres; switch to Option A before taking real orders.

## 4. Updating

```bash
cd ~/revelle-api && git pull && cd deploy && docker compose up -d --build
```

## Operations

```bash
docker compose ps                 # health
docker compose logs -f api        # follow logs
docker compose restart api        # after editing .env
docker stats                      # memory / CPU
```

Containers use `restart: unless-stopped`, so the API comes back automatically
after a reboot or crash. The healthcheck marks it unhealthy if `/api/health`
stops responding.
