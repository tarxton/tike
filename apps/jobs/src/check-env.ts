/**
 * Report whether the database URLs are usable, without ever printing them.
 *
 * A bad connection string fails deep inside the driver as `TypeError: Invalid URL` with
 * the value masked, which says nothing about *why*. GitHub masks the secret itself, but
 * not substrings derived from it, so this deliberately reports only shape — present,
 * parses, has each part — and never a host, user or password.
 *
 * Run with `pnpm --filter @tike/jobs check-env` (local) or `check-env:ci` (runner).
 */

interface Report {
  name: string;
  set: boolean;
  looksLikePostgres: boolean;
  parses: boolean;
  hasUser: boolean;
  hasPassword: boolean;
  hasHost: boolean;
  hasDatabase: boolean;
  hint: string | null;
}

function inspect(name: string): Report {
  const raw = process.env[name];
  const base: Report = {
    name,
    set: Boolean(raw),
    looksLikePostgres: false,
    parses: false,
    hasUser: false,
    hasPassword: false,
    hasHost: false,
    hasDatabase: false,
    hint: null,
  };

  if (!raw) return { ...base, hint: 'not set at all' };

  // The two mistakes that actually happen when copying out of a .env file.
  if (/^\s*[A-Z_]+=/.test(raw)) {
    return { ...base, hint: `includes the "${name}=" prefix; store only the value after it` };
  }
  if (/^["']|["']$/.test(raw)) {
    return { ...base, hint: 'wrapped in quotes; store the bare value' };
  }

  const looksLikePostgres = /^postgres(ql)?:\/\//.test(raw);
  try {
    const url = new URL(raw);
    return {
      ...base,
      looksLikePostgres,
      parses: true,
      hasUser: url.username !== '',
      hasPassword: url.password !== '',
      hasHost: url.hostname !== '',
      hasDatabase: url.pathname.replace(/^\//, '') !== '',
      hint: looksLikePostgres ? null : 'parses, but the scheme is not postgres://',
    };
  } catch {
    return {
      ...base,
      looksLikePostgres,
      hint: looksLikePostgres
        ? 'starts with postgres:// but will not parse; check for stray whitespace or a line break'
        : 'does not parse as a URL and does not start with postgres://',
    };
  }
}

const reports = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'].map(inspect);
for (const r of reports) {
  const ok = r.set && r.parses && r.looksLikePostgres && r.hasUser && r.hasPassword && r.hasHost;
  console.log(
    `${ok ? 'ok  ' : 'BAD '} ${r.name}: set=${r.set} parses=${r.parses} ` +
      `postgres=${r.looksLikePostgres} user=${r.hasUser} password=${r.hasPassword} ` +
      `host=${r.hasHost} database=${r.hasDatabase}` +
      (r.hint ? `\n       ${r.hint}` : ''),
  );
}

// The unpooled URL must be the direct endpoint: transactions do not work through the
// pooler, and the ingest pipeline writes an offer and its sizes together or not at all.
const unpooled = process.env.DATABASE_URL_UNPOOLED ?? '';
if (unpooled.includes('-pooler.')) {
  console.log('BAD  DATABASE_URL_UNPOOLED points at the pooled endpoint; use the direct one');
}

if (reports.some((r) => !(r.set && r.parses && r.looksLikePostgres))) process.exitCode = 1;
