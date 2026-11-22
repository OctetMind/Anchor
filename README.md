# Anchor — a one-shot AI assistant built for AuDHD brains

A private web app + installable phone app. You bring your own LLM key; everything else
stays on your device.

Built around one idea: **ask once, get the complete answer.** No follow-up questions,
no vague half-answers, no back-and-forth you didn't ask for.

---

## Start here (3 steps)

1. **Run it** — from this folder:
   ```
   python3 -m http.server 8000
   ```
   Then open **http://localhost:8000** in your browser.
   (Any static file server works. Don't double-click the file — browsers block some
   features when opened directly from disk.)

2. **Add a key** — click **Settings → AI**, pick a provider, paste your API key.
   Free options: Google Gemini (aistudio.google.com) and Groq (groq.com) both have
   free tiers. OpenRouter (openrouter.ai) gives you many models with one key.

3. **Ask something.** That's it. Everything saves automatically.

## Put it on your phone

Your phone and computer must be on the same Wi-Fi.

1. Find your computer's local address: run `hostname -I` (Linux) or `ipconfig` (Mac/Windows).
2. On your phone, open `http://THAT-ADDRESS:8000`
3. Install it as an app:
   - **Android** (Chrome): menu → *Install app* (or the Install button in Anchor's sidebar)
   - **iPhone** (Safari): Share → *Add to Home Screen*

## Put it on the internet (free, ~2 minutes)

Anchor is pure static files — no server code, no backend to pay for. Two good options:

**Cloudflare Workers** (recommended: unlimited bandwidth, aggressive caching built in):
```
node build.mjs          # fingerprints assets + cache headers → ./dist
npx wrangler login
npx wrangler deploy
```
(The `wrangler.jsonc` config is already in this folder.)

**Vercel** (zero config — skips the fingerprint step, caching is still fine):
```
npx vercel
```

Either way you get an HTTPS URL — which also unlocks voice input and API-key encryption
(browsers only allow those on secure connections). Point your phone's browser at the URL,
install to home screen, and it's a real app everywhere you go.

## How the caching works (Cloudflare deploy)

Built in layers, so it's maximum-fast but never stale:

| Layer | Behavior |
| --- | --- |
| Cloudflare edge | Assets cached in 330+ locations worldwide automatically — there is no origin server to wait for |
| Browser — app files | `app.<hash>.js` / `styles.<hash>.css`: cached **1 year, immutable**. Downloaded once, never re-checked — the filename changes whenever the content does |
| Browser — index.html | Revalidated every visit (a tiny check, no re-download) — so you always pick up new versions on the next visit |
| Browser — sw.js | Never cached — the update trigger is always fresh |
| Browser — icons | 30 days (manifest: 1 hour) |
| Service worker | App opens instantly and works offline after first load |
| Privacy | `X-Robots-Tag: noindex` — your workers.dev URL stays out of Google |

Updating = edit files → `node build.mjs` → `npx wrangler deploy`. New hashes → new URLs →
everyone gets the update on their next visit, with old assets still working for anyone mid-session.

(`node build.mjs` is only for deploys — local dev serves the source folder directly.)

## Version control + push-to-deploy (Git → GitHub → Cloudflare)

The folder is already a git repo with everything committed. To put it on GitHub:

```
# once: put your name on commits (use the email linked to your GitHub)
git config user.name "Your Name"
git config user.email "you@example.com"

# create an empty repo named "anchor" at github.com (Private recommended), then:
git remote add origin https://github.com/<your-username>/anchor.git
git push -u origin main
```

Then connect it to Cloudflare for **automatic deploys on every push**:

1. Cloudflare dashboard → Workers & Pages → your **anchor** Worker
2. Settings → Builds → **Connect** → authorize the Cloudflare GitHub app (give it access to the `anchor` repo)
3. Pick the repo, branch `main`, and set:
   - Build command: `node build.mjs`
   - Deploy command: `npx wrangler deploy`
4. Save

From then on: edit → `git add -A` → `git commit -m "what changed"` → `git push` — live about a minute later.
Pushes to other branches create preview URLs instead of touching the live app.

No secrets ever sit in the repo — API keys live only in your browser's storage.

## What's inside

**One-shot answers** — the default mode instructs the AI to:
- never ask you clarifying questions (it states its assumptions instead)
- give complete answers: full steps, exact wording, whole code, full lists
- put the direct answer first, structure the rest
- self-check before answering

**You control the AI** (Settings → AI):
- Provider: OpenAI, Anthropic, Google, OpenRouter, Groq, local Ollama, or any OpenAI-compatible endpoint
- Model (with a "Load model list" button that fetches your account's available models)
- Temperature ("predictable ↔ imaginative"), top-p, max answer length, streaming on/off
- Answer modes: One shot · Step by step · Simple words · Direct & minimal · Calm & steady · Custom
- "About you" — saved context the AI always gets (e.g. "I take things literally. Give me word-for-word scripts.")

**Quick tools** (19 of them — sidebar menu; home screen shows your favorites once you star some). Not sure which one you need? Type it into the **"What do you need?"** finder — e.g. *"need to call the dentist about a bill"* suggests Call walker (plus Just start, often used together). Matching runs instantly on-device.

- *Tasks:* Break it down · Just start · How to start a task · How long will it take? · What fits in X min? · Today's 3 · Routine builder
- *Communication:* Write it for me · Tone check · Message decoder · Hard conversation prep · Call walker
- *Thinking:* Decide for me · Explain simply · Summarize this · Sort brain dump · Note to future me
- *Hard moments:* Transition helper · Shutdown rescue

Star your favorite(s) — they move to the top and pin to the home screen.

**AuDHD-friendly display settings** (Settings → Display):
- dark / light / match-device theme
- text size 85–150%
- relaxed line spacing
- reduce all motion

**Other things that just work:**
- honest about what it is: a large language model — helpful, sometimes wrong, **never professional advice**. Every screen says so, and there's a built-in **professional help finder** (one tap from the top bar or the side menu — map + listings for therapists, psychologists, psychiatrists, ADHD/autism assessment, GPs, and crisis support, searched by suburb or ZIP)
- voice input — tap the mic, talk, tap again; words appear in the box (works best in Chrome/Edge/Safari; language adjustable in Settings → Display)
- read answers aloud — **Listen** button on any answer; optional auto-play when a answer finishes, plus speed and voice pickers (Settings → Display)
- search across all chats — sidebar search box, or `Ctrl/⌘ + F` (matches are highlighted, and you jump straight to the message)
- chats saved on-device, exported as `.md` or `.json`
- every message: copy / edit / retry
- stop a generation mid-answer (keeps what was written)
- keyboard: `Ctrl/⌘ + K` new chat, `Ctrl/⌘ + F` search, `Esc` close menus
- works offline once loaded (chat itself needs internet, obviously)

## Locking your API key (optional)

Settings → AI → **Lock my API key with a passphrase**:

- Your key is encrypted on this device (AES-256-GCM, key derived from your passphrase with PBKDF2, 310,000 iterations). Only ciphertext is written to storage.
- A strength meter helps you pick a good passphrase — 4+ random words is the sweet spot.
- You type the passphrase **once per session** — reload or reopen the app and it asks again.
- **Auto-lock**: after you go idle (default 5 minutes, adjustable 1–30 min or off), the key re-locks itself. Comes back with your passphrase. An in-progress answer or open settings screen never gets locked out from under you.
- **Forgot the passphrase?** No disaster: paste your API key again. Chats are never encrypted.
- Changing the passphrase = turn the lock off, then on again with the new one.
- Note: needs HTTPS or localhost. Over plain `http://` on your Wi-Fi (e.g. phone testing), the checkbox disables itself.

## Privacy & storage

| What | Where |
| --- | --- |
| Chats | IndexedDB (browser's large local database — hundreds of MB of headroom) |
| Settings, encrypted key blob, last chat | localStorage (browser, per device) |
| Unlocked API key | Memory only — never written to disk |
| Network | Only your messages, sent directly to the AI provider you chose |

- No server, no accounts, no analytics.
- Voice input goes through your browser's speech recognition service (Chrome/Edge = Google's speech servers). The mic button hides itself on browsers that can't do it.
- Your old localStorage chats migrate to IndexedDB automatically on first load (nothing is lost — it verifies the copy before deleting the old one).
- If IndexedDB is unavailable (rare), Anchor falls back to localStorage automatically.
- "Delete ALL chats and settings" (Settings → Data) wipes both stores.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "API key was rejected" | Re-copy the key. Check it's for the right provider. |
| "Model or address not found" | Tap "Load model list" and pick from the real list. |
| "Could not reach the server" | Check Base URL. For local Ollama: stop it, then start with `OLLAMA_ORIGINS="*" ollama serve`. |
| Empty Gemini answers | Raise "Max answer length" in Settings → AI → Advanced. |
| App won't install on iPhone | Use Safari → Share → Add to Home Screen (not Chrome). |
| "Lock my API key" checkbox is disabled | Encryption needs a secure context — open the app on `localhost` or over HTTPS. |

## Files

```
index.html        the whole app
app.js            logic (providers, streaming, markdown, settings)
styles.css        calm, responsive, low-sensory theme
sw.js             service worker (offline shell)
manifest.webmanifest + icons    PWA install
```
