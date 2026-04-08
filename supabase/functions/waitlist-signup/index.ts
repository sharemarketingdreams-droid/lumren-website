/**
 * Lumren — waitlist-signup edge function v2
 * Simpler: uses direct fetch to PostgREST + Resend API
 * Better error logging so we can see exactly what's failing
 */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY')            ?? '';

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin':  origin ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  };
}

function json(body: object, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });

  // Parse email
  let email: string;
  try {
    const body = await req.json();
    email = (body.email ?? '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Valid email required' }, 400, origin);
    }
  } catch {
    return json({ error: 'Invalid JSON' }, 400, origin);
  }

  // Log env availability (not values)
  console.log('[waitlist] SUPABASE_URL set:', !!SUPABASE_URL);
  console.log('[waitlist] SERVICE_ROLE set:', !!SUPABASE_SERVICE);
  console.log('[waitlist] RESEND_KEY set:', !!RESEND_API_KEY);
  console.log('[waitlist] email:', email);

  // Insert directly via PostgREST REST API
  const insertUrl = `${SUPABASE_URL}/rest/v1/waitlist`;
  const insertRes = await fetch(insertUrl, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_SERVICE,
      'Authorization': `Bearer ${SUPABASE_SERVICE}`,
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify({
      email,
      source:     'website',
      created_at: new Date().toISOString(),
    }),
  });

  console.log('[waitlist] insert status:', insertRes.status);

  if (!insertRes.ok) {
    const errText = await insertRes.text().catch(() => '');
    console.error('[waitlist] insert error:', errText);
    // 409 = conflict (duplicate email) — still send thanks
    if (insertRes.status !== 409) {
      return json({ error: 'Failed to join waitlist', detail: errText }, 500, origin);
    }
    console.log('[waitlist] duplicate email — already on list');
  }

  // Send confirmation email via Resend
  if (RESEND_API_KEY) {
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:     'Lumren <onboarding@resend.dev>',
          to:       [email],
          reply_to: 'lumrenapp@gmail.com',
          subject:  "You're on the Lumren waitlist.",
          html: `<div style="background:#07050E;padding:40px 20px;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#100E1C;border:1px solid rgba(201,169,110,.15);border-radius:16px;padding:40px 32px;text-align:center">
    <p style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#C9A96E;margin:0 0 24px">LUMREN</p>
    <p style="font-size:36px;color:#C9A96E;margin:0 0 20px;line-height:1">◎</p>
    <h1 style="font-family:Georgia,serif;font-size:30px;font-weight:300;color:#EDE8DF;margin:0 0 18px;line-height:1.1">You're on the list.</h1>
    <p style="font-size:15px;line-height:1.8;color:rgba(237,232,223,.65);margin:0 0 28px">We'll reach out personally when Lumren is ready for you.</p>
    <div style="border-top:1px solid rgba(255,255,255,.06);padding-top:24px;text-align:left">
      <p style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:rgba(201,169,110,.6);margin:0 0 12px">What Lumren will find</p>
      <p style="font-size:14px;line-height:1.75;color:rgba(237,232,223,.55);margin:0 0 7px">· The pattern you've been living out for years that you never named</p>
      <p style="font-size:14px;line-height:1.75;color:rgba(237,232,223,.55);margin:0 0 7px">· The loop you're in right now — named while you're still in it</p>
      <p style="font-size:14px;line-height:1.75;color:rgba(237,232,223,.55);margin:0">· The thing you keep almost saying — surfaced as one sentence</p>
    </div>
    <p style="font-size:12px;color:rgba(107,101,96,.7);margin:28px 0 0;line-height:1.7">Lumren · <a href="https://lumren.app" style="color:rgba(201,169,110,.55);text-decoration:none">lumren.app</a></p>
  </div>
</div>`,
          text: "You're on the Lumren waitlist.\n\nWe'll reach out personally when Lumren is ready for you.\n\nLumren · lumren.app",
        }),
      });
      console.log('[waitlist] Resend status:', emailRes.status);
      if (!emailRes.ok) {
        const t = await emailRes.text().catch(() => '');
        console.error('[waitlist] Resend error:', t);
      }
    } catch (e) {
      console.error('[waitlist] Resend exception:', e);
    }
  }

  return json({ ok: true, email }, 200, origin);
});
