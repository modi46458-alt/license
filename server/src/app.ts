import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AdminSessions, IDLE_MS, SESSION_COOKIE, readCookie } from './admin-session.js';
import { safeEqual, sha256 } from './crypto.js';
import { LicenseError, type AdminAction, type LicenseService } from './license-service.js';
import { RateLimiter } from './rate-limit.js';

/**
 * HTTP API.
 *   Extension:  POST /api/license/activate, POST /api/license/validate
 *   Admin:      /admin/api/* (Bearer admin API key; key hash from env)
 * JSON only, small bodies, strict validation in the service, rate limits,
 * no CORS (the extension reaches this host through host_permissions).
 */

export interface AppOptions {
  readonly service: LicenseService;
  readonly adminKeySha256: string;
  readonly requireHttps: boolean;
  readonly trustProxy: number;
  readonly now?: () => number;
  /** Mark the session cookie Secure (default: same as requireHttps). */
  readonly cookieSecure?: boolean;
  /** Built admin panel (index.html + assets); served when present. */
  readonly adminUiDir?: string;
}

const ADMIN_UI_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; " +
  "form-action 'self'; object-src 'none'";

const ADMIN_ACTIONS: ReadonlySet<string> = new Set<AdminAction>([
  'disable',
  'suspend',
  'reactivate',
  'revoke',
  'reset-device',
]);

export function createApp(options: AppOptions) {
  const { service } = options;
  const now = options.now ?? Date.now;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxy);

  const activateLimit = new RateLimiter(10, 60_000, now);
  const validateLimit = new RateLimiter(120, 60_000, now);
  const adminLimit = new RateLimiter(120, 60_000, now);
  const adminFailLimit = new RateLimiter(10, 15 * 60_000, now);
  const sessions = new AdminSessions(now);
  const cookieSecure = options.cookieSecure ?? options.requireHttps;
  const setSessionCookie = (res: Response, value: string, maxAgeMs: number) => {
    res.append(
      'Set-Cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/admin; HttpOnly; SameSite=Strict; ` +
        `Max-Age=${Math.floor(maxAgeMs / 1000)}${cookieSecure ? '; Secure' : ''}`,
    );
  };

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    if (options.requireHttps && !req.secure) {
      res.status(403).json({ message: 'HTTPS required.' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '8kb' }));

  const ip = (req: Request) => req.ip ?? 'unknown';
  const wrap =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };
  const body = (req: Request): Record<string, unknown> =>
    typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, serverTime: now() });
  });

  /* ------------------------------ extension ---------------------------- */

  app.post(
    '/api/license/activate',
    wrap(async (req, res) => {
      if (!activateLimit.take(ip(req))) {
        res.status(429).json({ message: 'Too many attempts. Try again later.' });
        return;
      }
      const b = body(req);
      const result = await service.activate({
        licenseCode: b.licenseCode,
        deviceId: b.deviceId,
        extensionVersion: b.extensionVersion,
      });
      res.status(result.httpStatus).json(result.body);
    }),
  );

  app.post(
    '/api/license/validate',
    wrap(async (req, res) => {
      if (!validateLimit.take(ip(req))) {
        res.status(429).json({ message: 'Too many requests.' });
        return;
      }
      const b = body(req);
      const result = await service.validate({
        token: b.token,
        deviceId: b.deviceId,
        extensionVersion: b.extensionVersion,
      });
      res.status(result.httpStatus).json(result.body);
    }),
  );

  /* -------------------------------- admin ------------------------------ */

  const admin = express.Router();
  const sessionId = (req: Request) => readCookie(req.get('cookie'), SESSION_COOKIE);
  const actor = (req: Request) => ({ name: 'admin', ip: ip(req) });

  /* Web panel login: the key is checked here and never stored or returned. */
  admin.post(
    '/session',
    wrap(async (req, res) => {
      if (!adminLimit.take(ip(req))) {
        res.status(429).json({ message: 'Too many requests.' });
        return;
      }
      const raw = body(req).key;
      const key = typeof raw === 'string' ? raw : '';
      if (!key || !safeEqual(sha256(key), options.adminKeySha256)) {
        await service.recordAdminAuth('ADMIN_LOGIN_FAILED', ip(req));
        if (!adminFailLimit.take(ip(req))) {
          res.status(429).json({ message: 'Too many failed attempts. Try again later.' });
          return;
        }
        res.status(401).json({ message: 'Invalid admin key.' });
        return;
      }
      const session = sessions.create(ip(req));
      setSessionCookie(res, session.id, IDLE_MS);
      await service.recordAdminAuth('ADMIN_LOGIN', ip(req));
      res.json({ csrfToken: session.csrf, expiresAt: session.expiresAt });
    }),
  );
  admin.get('/session', (req, res) => {
    const session = sessions.get(sessionId(req));
    if (!session) {
      res.status(401).json({ message: 'Not signed in.' });
      return;
    }
    res.json({ csrfToken: session.csrf, expiresAt: session.expiresAt });
  });
  admin.delete(
    '/session',
    wrap(async (req, res) => {
      const id = sessionId(req);
      if (sessions.get(id) && sessions.checkCsrf(id, req.get('x-csrf-token'))) {
        sessions.destroy(id);
        await service.recordAdminAuth('ADMIN_LOGOUT', ip(req));
      }
      setSessionCookie(res, '', 0);
      res.status(204).end();
    }),
  );

  // Everything below needs a Bearer admin key (scripts) or a web session.
  admin.use((req, res, next) => {
    if (!adminLimit.take(ip(req))) {
      res.status(429).json({ message: 'Too many requests.' });
      return;
    }
    const header = req.get('authorization') ?? '';
    if (header.startsWith('Bearer ')) {
      const key = header.slice(7);
      if (key && safeEqual(sha256(key), options.adminKeySha256)) {
        next();
        return;
      }
      if (!adminFailLimit.take(ip(req))) {
        res.status(429).json({ message: 'Too many failed attempts.' });
        return;
      }
      res.status(401).json({ message: 'Admin authentication required.' });
      return;
    }
    const id = sessionId(req);
    if (!sessions.get(id)) {
      res.status(401).json({ message: 'Admin authentication required. Please sign in.' });
      return;
    }
    if (req.method !== 'GET' && !sessions.checkCsrf(id, req.get('x-csrf-token'))) {
      res.status(403).json({ message: 'Missing or invalid CSRF token.' });
      return;
    }
    setSessionCookie(res, id ?? '', IDLE_MS); // sliding idle timeout
    next();
  });

  const listQuery = (req: Request) => ({
    query: req.query.query,
    status: req.query.status,
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 25),
  });
  admin.get(
    '/dashboard',
    wrap(async (_req, res) => {
      res.json(await service.dashboard());
    }),
  );
  admin.get(
    '/customers',
    wrap(async (req, res) => {
      res.json(await service.searchCustomers(listQuery(req)));
    }),
  );
  admin.put(
    '/customers/:id',
    wrap(async (req, res) => {
      const b = body(req);
      const input = { name: b.name, email: b.email, company: b.company, phone: b.phone };
      res.json(await service.updateCustomer(String(req.params.id), input, actor(req)));
    }),
  );
  admin.get(
    '/licenses/search',
    wrap(async (req, res) => {
      res.json(await service.searchLicenses(listQuery(req)));
    }),
  );
  admin.get(
    '/devices',
    wrap(async (req, res) => {
      res.json(await service.searchDevices(listQuery(req)));
    }),
  );
  admin.post(
    '/devices/:id/reset',
    wrap(async (req, res) => {
      await service.resetDevice(String(req.params.id), actor(req));
      res.status(204).end();
    }),
  );
  admin.get(
    '/audit/search',
    wrap(async (req, res) => {
      res.json(
        await service.searchAudit({
          licenseId: req.query.licenseId,
          customerId: req.query.customerId,
          action: req.query.action,
          page: Number(req.query.page ?? 1),
          pageSize: Number(req.query.pageSize ?? 25),
        }),
      );
    }),
  );

  admin.get(
    '/stats',
    wrap(async (_req, res) => {
      res.json(await service.stats());
    }),
  );
  admin.get(
    '/licenses',
    wrap(async (_req, res) => {
      res.json(await service.listLicenses());
    }),
  );
  admin.get(
    '/licenses/:id',
    wrap(async (req, res) => {
      res.json(await service.details(String(req.params.id)));
    }),
  );
  admin.post(
    '/customers',
    wrap(async (req, res) => {
      const b = body(req);
      res
        .status(201)
        .json(
          await service.createCustomer(
            { name: b.name, email: b.email, company: b.company, phone: b.phone },
            actor(req),
          ),
        );
    }),
  );
  admin.post(
    '/licenses',
    wrap(async (req, res) => {
      const b = body(req);
      const { license, code } = await service.createLicense(
        {
          customerId: b.customerId,
          plan: b.plan,
          days: b.days,
          expiresAt: b.expiresAt,
          maxDevices: b.maxDevices,
          startsAt: b.startsAt,
        },
        actor(req),
      );
      // The code is returned once and never again (only its hash is stored).
      res.status(201).json({ license: { ...license, codeHash: undefined }, code });
    }),
  );
  admin.post(
    '/licenses/:id/extend',
    wrap(async (req, res) => {
      const b = body(req);
      const license = await service.extend(
        String(req.params.id),
        { days: b.days, expiresAt: b.expiresAt },
        actor(req),
      );
      res.json({ ...license, codeHash: undefined });
    }),
  );
  admin.post(
    '/licenses/:id/:action',
    wrap(async (req, res) => {
      const action = String(req.params.action);
      if (!ADMIN_ACTIONS.has(action)) {
        res.status(404).json({ message: 'Unknown action.' });
        return;
      }
      const license = await service.act(String(req.params.id), action as AdminAction, actor(req));
      res.json({ ...license, codeHash: undefined });
    }),
  );
  admin.get(
    '/audit',
    wrap(async (req, res) => {
      const licenseId = typeof req.query.licenseId === 'string' ? req.query.licenseId : undefined;
      res.json(await service.auditLog({ ...(licenseId ? { licenseId } : {}), limit: 200 }));
    }),
  );
  app.use('/admin/api', admin);

  /* ------------------------------ admin panel --------------------------- */

  const uiDir = options.adminUiDir;
  if (uiDir && existsSync(resolve(uiDir, 'index.html'))) {
    const index = resolve(uiDir, 'index.html');
    app.use(
      '/admin/assets',
      express.static(resolve(uiDir, 'assets'), {
        index: false,
        setHeaders: (res) => {
          res.set('Content-Security-Policy', ADMIN_UI_CSP);
          res.set('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    // Client-side routes (/admin, /admin/customers, …) all load the same page.
    app.get(/^\/admin(?:\/(?!api\/|assets\/).*)?$/, (_req, res) => {
      res.set('Content-Security-Policy', ADMIN_UI_CSP);
      res.sendFile(index);
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ message: 'Not found.' });
  });
  // Errors: known service errors keep their status; anything else is a 500 without details.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof LicenseError) {
      res.status(error.httpStatus).json({ message: error.message });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ message: 'Invalid JSON.' });
      return;
    }
    console.error('[license-server]', error);
    res.status(500).json({ message: 'Internal error.' });
  });

  return app;
}
