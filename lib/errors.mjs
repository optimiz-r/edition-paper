/** A mistake in how the CLI was called; the message is shown as is. */
export class UsageError extends Error {}

/** Keep the host and path useful for diagnostics without logging HTTP request credentials. */
export function httpUrlForLog(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return value;
  if (!url.username && !url.password && !url.search && !url.hash) return value;
  return `${url.origin}${url.pathname}`;
}
