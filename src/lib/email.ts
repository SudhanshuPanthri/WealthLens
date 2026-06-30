/**
 * Transactional email. Uses Resend's HTTP API when RESEND_API_KEY is set; with
 * no key (local dev) it logs the message to the console so flows are testable
 * without an email provider. Swap the transport here to use SMTP/SES/etc.
 */

interface EmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const FROM = process.env.EMAIL_FROM || "WealthLens <onboarding@resend.dev>";

export async function sendEmail({ to, subject, html, text }: EmailArgs): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Dev fallback — no provider configured. Surface the content in the server log.
    console.log(`\n[email] (no RESEND_API_KEY set — not actually sending)\n  to: ${to}\n  subject: ${subject}\n  ${text}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html, text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Email send failed (${res.status}): ${detail}`);
  }
}

/** Sends the year-end tax-loss-harvesting reminder. */
export async function sendHarvestReminder(
  to: string,
  opts: { taxSaved: number; daysLeft: number; fyEnd: string; appUrl: string },
): Promise<void> {
  const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
  const subject = `Save ~${inr(opts.taxSaved)} in tax before ${opts.fyEnd} (${opts.daysLeft} days left)`;
  const text =
    `Your WealthLens portfolio has loss-making positions you can harvest before the ${opts.fyEnd} ` +
    `deadline to cut this year's capital-gains tax by about ${inr(opts.taxSaved)}. ` +
    `See your plan: ${opts.appUrl}/tax`;
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1812">
    <div style="font-size:18px;font-weight:700;margin-bottom:16px">WealthLens</div>
    <p style="font-size:15px;line-height:1.5;margin:0 0 12px">The financial year ends <strong>${opts.fyEnd}</strong> — just <strong>${opts.daysLeft} days</strong> away.</p>
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px">You have loss-making positions you can sell to offset this year's realized gains. Acting before the deadline could save you about:</p>
    <div style="font-size:30px;font-weight:800;color:#15803d;background:#f1efe9;border-radius:12px;padding:18px;text-align:center;margin:0 0 16px">${inr(opts.taxSaved)}</div>
    <a href="${opts.appUrl}/tax" style="display:inline-block;background:#d97706;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">See your harvest plan</a>
    <p style="font-size:12px;color:#6b6657;line-height:1.5;margin:16px 0 0">Estimate for listed equity / equity funds. Not tax advice. You can turn off these reminders on the tax page.</p>
  </div>`;
  await sendEmail({ to, subject, html, text });
}

/** Sends the 6-digit password-reset code. */
export async function sendPasswordResetCode(to: string, code: string): Promise<void> {
  const subject = `${code} is your WealthLens reset code`;
  const text = `Your WealthLens password reset code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`;
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:440px;margin:0 auto;padding:32px 24px;color:#1a1812">
    <div style="font-size:18px;font-weight:700;margin-bottom:24px">WealthLens</div>
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px">Use this code to reset your password:</p>
    <div style="font-size:34px;font-weight:800;letter-spacing:8px;background:#f1efe9;border-radius:12px;padding:18px;text-align:center;margin:0 0 16px">${code}</div>
    <p style="font-size:13px;color:#6b6657;line-height:1.5;margin:0">This code expires in 10 minutes. If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
  </div>`;
  await sendEmail({ to, subject, html, text });
}
