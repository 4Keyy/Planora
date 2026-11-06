# Cloud.ru single-server deployment

This overlay reuses the root Compose stack and adds the Next.js image and Caddy
HTTPS edge. It is a temporary single-server setup, without high availability.
See [production requirements](../../docs/production.md) and the
[migration checkpoint](../../docs/audits/planora-deep-audit/results/CLOUDRU_20261106.md)
for actual verification status. Configuration files alone do not certify a release.

## Configuration and build

Use Docker Engine and Compose >= 2.24.4 on Linux. Copy `cloud.env.example` to
`/opt/planora/shared/cloud.env`, outside the checkout, owned by the deployment
operator and mode 0600. Generate independent random secrets for infrastructure,
each service database, JWT and gRPC. Set a real SMTP provider for Auth. The gateway
does not receive SMTP credentials. Never upload a working-tree `.env` in an image.

Set `PUBLIC_HOST` to a DNS hostname resolving to this VM. Set `PLANORA_SHARED_DIR`
to the private persistent directory. Generate the gateway configuration:

```sh
python3 deploy/cloudru/prepare-routes.py Planora.ApiGateway/ocelot.Docker.json \
  /opt/planora/shared/gateway-routes.json https://planora.example.com
sudo sh deploy/cloudru/compose.sh config --quiet
```

Build serially on a 4 GiB server; leave swap available and measure memory/disk
usage. Do not build on a live local Next.js output directory:

```sh
for service in frontend auth-api category-api todo-api collaboration-api messaging-api realtime-api api-gateway; do
  sudo sh deploy/cloudru/compose.sh build "$service" || exit 1
done
```

The frontend bakes `NEXT_PUBLIC_API_URL=https://PUBLIC_HOST`,
`NEXT_PUBLIC_API_SAME_ORIGIN=1`, and the server-only rewrite upstream
`API_GATEWAY_INTERNAL_URL=http://api-gateway:80` into its build. A change of origin
or upstream requires rebuilding it. The private upstream is excluded from the
client environment. All .NET services use `Production`, explicit container
listeners and internal gRPC addresses. The generated route file is mounted at
`/app/ocelot.json`, which the Production gateway actually reads.

## Data and first startup

Follow [backup and recovery](../../docs/backup-recovery.md). Quiesce all writers
and consumers before the final checkpoint. Preserve and verify every database,
roles, Redis including the Auth Data Protection ring, RabbitMQ durable storage
and node identity, uploads, source revision and configuration. Definitions alone
do not preserve queued messages. Restore infrastructure and compare control
counts/hashes and protected-value decryption before starting cloud API writers.

Create the six `planora_<service>` database roles as LOGIN, NOSUPERUSER,
NOCREATEDB, NOCREATEROLE; give each only its corresponding database. Restore with
that role owning its objects. Do not replay old administrative password hashes
over newly generated credentials. Preserve the original role dump for recovery.
The databases must exist before starting these restricted application accounts.

For restored RabbitMQ, `RABBITMQ_HOSTNAME` must match the source node identity;
use a compatible broker version, rotate the application credential after restore
and remove unused administrative access only after checking the restored users.
Redis uses `noeviction`, because losing its key ring would break existing 2FA.
Automatic retention remains disabled for this migration.

Set `/opt/planora/shared/uploads` ownership to the actual Auth image UID/GID
(`docker run --rm --entrypoint id planora-cloud-auth-api`); do not assume UID1000.
Auth stores avatars under this persistent web root. Validate file hashes and a
real avatar response after restoration. Preserve local volumes and recovery files.

## Public access and acceptance

Only the edge publishes host ports 80/443. PostgreSQL, Redis, RabbitMQ, all API
listeners and Next.js stay inside the Docker network. SSH uses the dedicated key;
disable password and root login, validate the SSH configuration and test a second
connection before ending the first. Provider security groups are the perimeter;
Docker port publishing can bypass ordinary UFW forwarding rules.

The **default edge configuration is maintenance-only**. Keep it while opening
80/443, obtaining a trusted TLS certificate and verifying HTTPS. Do not expose
application routes merely because the containers report healthy. First verify
the restoration and internal service startup, then authentication boundaries,
Secure/HttpOnly/SameSite cookies and CSRF, CRUD, realtime, avatar access, SMTP
connectivity, restart persistence and resource headroom. Keep source writers
stopped during final cloud acceptance to avoid divergent databases.

After acceptance, set in the private env file:

```dotenv
PLANORA_CADDYFILE=./deploy/cloudru/Caddyfile
```

Then recreate only the edge with `sudo sh deploy/cloudru/compose.sh up -d edge`.
The edge/gateway addresses are fixed solely for explicit forwarded-header trust.
Do not attach untrusted containers to this network. The gateway rebuilds trusted
request headers for Auth, and browser-supplied forwarding headers cannot grant
direct access to internal listeners. Recheck login and HTTPS after cutover.

Record the deployed commit/image IDs, data checkpoint and acceptance results.
Keep a recovery copy outside this VM. Review the provider grant and billing:
stopping containers does not remove VM, disk or public-IP charges. This setup
does not enforce a monetary cap or automatic resource deletion.
