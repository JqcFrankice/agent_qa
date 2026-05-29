export async function verifyTurnstile(secret: string, token: string, remoteIp?: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal
    });
    if (!res.ok) return false;
    const json = await res.json() as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
