# Seeding Solarman auth

Solarman login can't be done headlessly — the login page is behind Cloudflare
Turnstile. Instead you copy a **refresh token** from a logged-in browser once,
and the client renews itself from there.

**Token lifetimes** (from the actual tokens): access token **~24h** (the client
refreshes it automatically); refresh token **~6 months**. Every refresh mints a
new refresh token, so as long as the tick runs at least once every ~6 months it
perpetuates itself. Re-seed only if it lapses (you'll see an `invalid_token`
error).

## Steps

1. Log in at <https://globalhome.solarmanpv.com> in your browser.
2. DevTools → **Console**, and run this to copy your refresh token (the longer of
   the two 32-hex-named cookies) to the clipboard — it auto-picks by length, so
   it keeps working even if the cookie name changes:

   ```js
   copy(Object.entries(Object.fromEntries(document.cookie.split(';').map(s=>s.trim())
     .map(s=>{const i=s.indexOf('=');return [s.slice(0,i),decodeURIComponent(s.slice(i+1))];})))
     .filter(([k])=>/^[0-9a-f]{32}$/.test(k))
     .sort((a,b)=>b[1].length-a[1].length)[0][1])
   ```

   (`copy()` returning `undefined` is expected — the value is on your clipboard.)
3. Seed it:

   ```sh
   node --env-file=.env src/cli.ts seed <paste-refresh-token>
   ```

   This writes `~/.config/home-automation/solarman.token.json` (mode 0600,
   gitignored) and fetches one live snapshot to prove it works. On your always-on
   Mac the cache persists between ticks, so the token self-renews with no further
   action.
