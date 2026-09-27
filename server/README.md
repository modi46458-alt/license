# License server (IndiaMART Smart Lead Intelligence)

Node.js + Express + TypeScript, MongoDB via Mongoose. Authoritative for every license decision.

## Run

```bash
npm install
npm run admin:key              # prints an admin API key (keep it) and its SHA-256
export MONGODB_URI='mongodb+srv://…'
export LICENSE_PEPPER='…at least 32 random characters…'
export ADMIN_API_KEY_SHA256='…from admin:key…'
npm run build && npm start     # behind an HTTPS reverse proxy (REQUIRE_HTTPS=true by default in production)
```

The server refuses to start without these secrets. None of them go into the extension.

## Admin Panel

A browser panel served by this server at **`/admin`** (login at `/admin/login`).

| Page                  | What it does                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/admin`              | Dashboard: customers, licenses by status, expiring soon, active devices, recent activity, expiry warnings    |
| `/admin/customers`    | Search (name, email, company, license), create, view, edit; license actions on the customer's latest license |
| `/admin/licenses`     | Status filter (ALL/ACTIVE/EXPIRED/DISABLED/SUSPENDED/REVOKED), search, create (code shown once), actions     |
| `/admin/licenses/:id` | Status, customer, plan, dates, devices, last validation / seen, history                                      |
| `/admin/devices`      | Bindings with masked device ids; Reset Device                                                                |
| `/admin/audit-logs`   | Every admin action, login and activation, with previous → new status, IP and result                          |
| `/admin/settings`     | Session and server information                                                                               |

Start it:

```bash
npm install
npm run build          # server (dist/) + panel (public/admin/)
npm start              # then open https://<your-host>/admin
```

Try it locally without MongoDB (in-memory data, one-time key printed):

```bash
npm run dev:panel      # http://localhost:8787/admin
```

Security:

- The admin key is typed once at login and checked on the server (SHA-256 compare); it is never
  stored in the browser. The server sets an HttpOnly, SameSite=Strict, `Path=/admin` session
  cookie (Secure over HTTPS). Sessions end after 30 minutes idle, 8 hours total, or logout.
  Every write needs the session's CSRF token (kept in memory by the panel, never in storage).
- Scripts can keep using `Authorization: Bearer <admin key>`.
- The panel is static HTML/JS with no secrets, served with a strict CSP (`script-src 'self'`, no
  inline scripts, `frame-ancestors 'none'`). All rules are enforced by the server; the panel only
  offers actions that match the status.
- Logins (successful and failed), logouts and every change are in the audit log; the key, codes,
  device ids and tokens never are.

## API

Extension (JSON):

- `POST /api/license/activate` `{ licenseCode, deviceId, extensionVersion }` → answer + device token
- `POST /api/license/validate` `{ token, deviceId, extensionVersion }` → answer
- WebSocket `/api/license/events`: send `{ type: "AUTH", token, deviceId }`; receive
  `LICENSE_STATUS` on every admin change.

Answer: `{ status, expiresAt, serverTime, plan, customer, codeHint, message }`, status one of
ACTIVE, EXPIRED, DISABLED, SUSPENDED, REVOKED, UNREGISTERED.

Admin (`Authorization: Bearer <admin key>`), under `/admin/api`:

- `POST /session` `{ key }` (panel login) · `GET /session` · `DELETE /session` (logout)
- `GET /dashboard` (stats incl. customers and active devices, expiring soon, recent activity)
- `GET /customers?query=&page=&pageSize=` · `PUT /customers/:id`
- `GET /licenses/search?status=&query=&page=&pageSize=`
- `GET /devices?status=&query=&page=` · `POST /devices/:id/reset`
- `GET /audit/search?action=&licenseId=&customerId=&page=&pageSize=`
- `GET /stats` (total, active, expired, disabled, suspended, revoked, expiring within 7 days)
- `GET /licenses`, `GET /licenses/:id` (customer, device bindings, audit)
- `POST /customers` `{ name, email, company?, phone? }`
- `POST /licenses` `{ customerId, plan, days | expiresAt, maxDevices?, startsAt? }` → returns the
  `IMS-XXXX-XXXX-XXXX` code once
- `POST /licenses/:id/disable | suspend | reactivate | revoke | reset-device`
- `POST /licenses/:id/extend` `{ days: 30 | 90 | 365 }` or `{ expiresAt }`
- `GET /audit?licenseId=`

## Rules

- Server time only: EXPIRED when `expiresAt <= now`. Manual states (DISABLED, SUSPENDED,
  REVOKED) win over expiry and are never lifted automatically; extend changes only the expiry.
  Reactivate never applies to REVOKED.
- Codes are stored as HMAC-SHA256 (pepper) plus the last 4 characters; device ids as HMAC;
  device tokens as SHA-256. Activation binds up to `maxDevices` browsers; Reset Device releases
  them (their tokens stop working).
- Rate limits (per IP): activate 10/min, validate 120/min, admin 120/min, failed admin auth
  10/15 min. JSON bodies ≤ 8 KB. No CORS. Every admin action and activation is audited.
- Storage port: `LicenseRepository` with `MongoLicenseRepository` (production) and
  `MemoryLicenseRepository` (tests / local development).

## Tests

`npm test` (in-memory repository, HTTP API via supertest, WebSocket push).
The Mongoose repository is type-checked but not exercised against a real MongoDB here.
