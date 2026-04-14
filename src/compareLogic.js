const ACCOUNTS_URL = 'https://websites.accounts.api.test-godaddy.com/v1/accounts';
const ACCOUNTS_ENTITLEMENTS_BASE = 'https://websites.accounts.api.test-godaddy.com/v1/accounts';
// Replace with local base URL when running locally: https://local.capabilities-graph.api.test-godaddy.com:8428/api/v1/capabilities-entitlements
const CAPABILITIES_ENTITLEMENTS_BASE = 'https://local.capabilities-graph.api.test-godaddy.com:8428/api/v1/capabilities-entitlements';

function extractAccountIds(fetchResult) {
  const data =
    fetchResult && typeof fetchResult === 'object' && 'data' in fetchResult && !fetchResult.__error
      ? fetchResult.data
      : typeof fetchResult === 'string'
        ? JSON.parse(fetchResult)
        : fetchResult;
  const list = Array.isArray(data) ? data : data?.accounts ?? data?.data ?? [];
  if (!Array.isArray(list)) return [];
  return list.map((item) => item?.accountId ?? item?.id).filter(Boolean);
}

function normalizeForCompare(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    const normalized = value.map(normalizeForCompare);
    normalized.sort((a, b) => {
      const sa = JSON.stringify(a);
      const sb = JSON.stringify(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    return normalized;
  }
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeForCompare(value[key]);
    }
    return out;
  }
  return value;
}

function diffRecursive(a, b, path, out) {
  const p = path || '(root)';

  if (typeof a !== typeof b) {
    out.valueDiffs.push({ path: p, a, b });
    return;
  }

  if (a === null || b === null || typeof a !== 'object') {
    const aStr = JSON.stringify(a);
    const bStr = JSON.stringify(b);
    if (aStr !== bStr) out.valueDiffs.push({ path: p, a, b });
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.valueDiffs.push({ path: p, a: `length ${a.length}`, b: `length ${b.length}` });
    }
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      const sub = path ? `${path}[${i}]` : `[${i}]`;
      if (i >= a.length) out.onlyInB.push(sub);
      else if (i >= b.length) out.onlyInA.push(sub);
      else diffRecursive(a[i], b[i], sub, out);
    }
    return;
  }

  const keysA = new Set(Object.keys(a));
  const keysB = new Set(Object.keys(b));
  for (const k of keysA) {
    if (!keysB.has(k)) out.onlyInA.push(path ? `${path}.${k}` : k);
    else diffRecursive(a[k], b[k], path ? `${path}.${k}` : k, out);
  }
  for (const k of keysB) {
    if (!keysA.has(k)) out.onlyInB.push(path ? `${path}.${k}` : k);
  }
}

function runDiff(a, b) {
  const out = { onlyInA: [], onlyInB: [], valueDiffs: [] };
  diffRecursive(a, b, '', out);
  return out;
}

function diff(a, b) {
  const normA = normalizeForCompare(a);
  const normB = normalizeForCompare(b);
  return runDiff(normA, normB);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` over `items` with at most `concurrency` in-flight at once,
 * pausing `delayMs` between each batch to avoid overwhelming the API.
 */
async function runWithConcurrency(items, fn, { concurrency = 3, delayMs = 1000 } = {}) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + concurrency < items.length && delayMs > 0) {
      await sleep(delayMs);
    }
  }
  return results;
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  const raw = await res.text();
  if (!res.ok) {
    return { __error: true, status: res.status, statusText: res.statusText, body: raw };
  }
  try {
    const data = JSON.parse(raw);
    return { data, raw };
  } catch {
    return { __error: true, parseError: true, body: raw };
  }
}

/**
 * Run the entitlements comparison.
 * @param {{ xAppKey: string, cookies?: string, accountId?: string }} options
 * When `accountId` is a non-empty string, only that account is compared (skips listing all accounts).
 * @returns {Promise<{ success: boolean, error?: string, accountIds?: string[], withDifferences?: object[] }}}
 */
export async function runCompare({ xAppKey, cookies = '', accountId: singleAccountId } = {}) {
  const headers = {
    'x-app-key': xAppKey,
    Accept: 'application/json',
  };
  if (cookies) headers.Cookie = cookies;

  const trimmedId = typeof singleAccountId === 'string' ? singleAccountId.trim() : '';
  let accountIds;

  if (trimmedId) {
    accountIds = [trimmedId];
  } else {
    const accountsBody = await fetchJson(ACCOUNTS_URL, headers);
    if (accountsBody.__error) {
      const { status, statusText, body } = accountsBody;
      return {
        success: false,
        error: `Accounts request failed: ${status} ${statusText}`,
        errorDetail: body,
        status,
      };
    }

    accountIds = extractAccountIds(accountsBody);
    if (accountIds.length === 0) {
      return { success: true, accountIds: [], withDifferences: [] };
    }
  }

  const results = await runWithConcurrency(
    accountIds,
    async (accountId) => {
      const [accountsEntitlements, capabilitiesEntitlements] = await Promise.all([
        fetchJson(
          `${ACCOUNTS_ENTITLEMENTS_BASE}/${accountId}/entitlements?transitionable=true&used=false&cache=false`,
          headers
        ),
        fetchJson(
          `${CAPABILITIES_ENTITLEMENTS_BASE}/${accountId}?used=false&transitionable=true`,
          headers
        ),
      ]);

      const hasErrorA = accountsEntitlements?.__error;
      const hasErrorB = capabilitiesEntitlements?.__error;
      const rawAccounts = hasErrorA
        ? String(accountsEntitlements.body ?? '')
        : String(accountsEntitlements.raw ?? '');
      const rawCapabilities = hasErrorB
        ? String(capabilitiesEntitlements.body ?? '')
        : String(capabilitiesEntitlements.raw ?? '');

      if (hasErrorA || hasErrorB) {
        return {
          accountId,
          diff: null,
          error: true,
          accountsError: hasErrorA ? accountsEntitlements : null,
          capabilitiesError: hasErrorB ? capabilitiesEntitlements : null,
          rawAccounts,
          rawCapabilities,
        };
      }

      const diffResult = diff(accountsEntitlements.data, capabilitiesEntitlements.data);
      const hasDiff =
        diffResult.onlyInA.length > 0 ||
        diffResult.onlyInB.length > 0 ||
        diffResult.valueDiffs.length > 0;

      return {
        accountId,
        diff: hasDiff ? diffResult : null,
        error: false,
        rawAccounts,
        rawCapabilities,
      };
    }
  );

  const withDifferences = results.filter((r) => r.diff || r.error);
  const matching = results
    .filter((r) => !r.diff && !r.error)
    .map((r) => r.accountId);
  return {
    success: true,
    accountIds,
    withDifferences,
    matching,
    totalAccounts: accountIds.length,
  };
}

/** Deep-sort object keys (and array elements) for stable alphabetical JSON. */
export { diff, normalizeForCompare as sortKeysAlphabetically };
