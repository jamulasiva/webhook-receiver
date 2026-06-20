import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readRawBody, verifySignature } from '../lib/github.js';

// Vercel auto-parses JSON bodies, which would consume the stream we need
// for byte-exact HMAC verification. Disable the parser and read raw bytes.
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[webhook] missing required env vars');
    res.status(500).json({ error: 'server misconfigured' });
    return;
  }

  const deliveryId = pickHeader(req.headers['x-github-delivery']);
  const eventType = pickHeader(req.headers['x-github-event']);
  const signature = pickHeader(req.headers['x-hub-signature-256']);

  if (!deliveryId || !eventType || !signature) {
    res.status(400).json({ error: 'missing required GitHub headers' });
    return;
  }

  const rawBody = await readRawBody(req);

  const signatureValid = verifySignature(rawBody, signature, WEBHOOK_SECRET);
  if (!signatureValid) {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'invalid json body' });
    return;
  }

  const capturedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.startsWith('x-github-') || key.startsWith('x-hub-')) {
      capturedHeaders[key] = Array.isArray(value) ? value.join(',') : String(value ?? '');
    }
  }

  const insertUrl =
    `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/raw_events?on_conflict=delivery_id`;

  const response = await fetch(insertUrl, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify({
      delivery_id: deliveryId,
      event_type: eventType,
      payload,
      headers: capturedHeaders,
      signature_valid: signatureValid,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('[webhook] supabase insert failed', {
      deliveryId,
      eventType,
      status: response.status,
      body: text,
    });
    res.status(500).json({ error: 'storage failure' });
    return;
  }

  console.log(`[webhook] stored ${eventType} (${deliveryId})`);
  res.status(202).json({ stored: true });
}

function pickHeader(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}
