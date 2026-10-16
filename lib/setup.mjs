/**
 * The --setup parameter is made by edition.cafe/paper ("Copy 8am command"):
 * base64url (no padding) of a JSON array of channels. The page decodes and
 * validates it in full; this side only checks the shape so a mangled paste
 * fails here, in words, instead of as an empty paper. The limits match the
 * app's MAX_ENCODED_SETUP_LENGTH and decodeSetup in src/lib/edition.ts, so
 * every parameter the page accepts passes here unchanged.
 */
import { UsageError } from './errors.mjs';

export const DEFAULT_URL = 'https://edition.cafe';
export const MAX_SETUP_LENGTH = 256 * 1024;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

const notASetup = () =>
  new UsageError(
    'That --setup value is not one Edition made. Copy it again from edition.cafe/paper ("Copy 8am command").'
  );

export function readSetup(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_SETUP_LENGTH ||
    value.length % 4 === 1 ||
    !BASE64URL.test(value)
  ) {
    throw notASetup();
  }
  let channels;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'base64url'));
    channels = JSON.parse(text);
  } catch {
    throw notASetup();
  }
  if (!Array.isArray(channels) || channels.length === 0) throw notASetup();
  return { setup: value, sources: channels.length };
}

/** The page the CLI prints. The parameter goes in exactly as given. */
export function paperUrl(baseUrl, setup) {
  return `${baseUrl.replace(/\/+$/, '')}/paper?setup=${setup}`;
}
