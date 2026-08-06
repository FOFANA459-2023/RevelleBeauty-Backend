# Hosting the API on Oracle Cloud (Always Free)

Genuinely free, never sleeps. Roughly 30 minutes end to end.

## 1. Create the VM (Oracle console)

**Compute → Instances → Create instance**

| Setting | Value |
|---|---|
| Image | Canonical **Ubuntu 24.04** |
| Shape | **VM.Standard.A1.Flex** (Ampere ARM) — 2 OCPU / 12 GB is plenty |
| SSH keys | Upload your public key, or let Oracle generate one — **save it** |

Stay on **A1.Flex** (ARM): that is the Always Free shape with real capacity.
The AMD micro shape only has 1 GB RAM, which is tight for Node + sharp.

> If you get *"Out of host capacity"*, that is Oracle rationing free ARM
> capacity in your region. Retry later or pick another availability domain —
> it is not something you configured wrong.

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
