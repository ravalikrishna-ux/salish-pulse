# Free HTTPS Mobile & Web Hosting on Cloudflare Pages (\$0/mo)

**Why Cloudflare Pages instead of GitHub Pages?**
- **\$0/mo free forever** even for **private GitHub repositories** (GitHub Pages requires a public repo or paid GitHub Pro plan).
- **Unlimited bandwidth** & global CDN (handles viral Seattle J-Pod spikes without throttling).
- **3-click Git connection** — no API tokens or credit card required.
- Works natively as an **iPhone/Android installable web app** (*Safari → Share → Add to Home Screen*) while you prepare Apple TestFlight.

---

## Easiest Setup (3 Clicks, Zero API Tokens)

1. Sign in (or create a free account) at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Go to **Workers & Pages → Create → Pages → Connect to Git**.
3. Authorize GitHub, select **`ravalikrishna-ux/salish-pulse`**, and enter these exact build settings:
   - **Production branch:** `main`
   - **Root directory:** `app`
   - **Build command:** `npm ci && npx expo export --platform web`
   - **Build output directory:** `dist`
4. Click **Save and Deploy**.

In ~60 seconds, Cloudflare gives you a live HTTPS URL like:
`https://salish-pulse.pages.dev`

Open that link on your iPhone in **Safari** → tap **Share → Add to Home Screen** to launch SalishPulse full-screen like a native app!

---

## Optional: Connect Your Live Backend Later
Once you deploy the Cloudflare Worker (`cd cloudflare && npm run deploy`), add one environment variable in **Cloudflare Pages → Settings → Environment variables**:
- `EXPO_PUBLIC_API_URL` = `https://salishpulse-edge.<your-subdomain>.workers.dev`

*(Until that variable is set, the web app automatically runs in instant offline/demo mode on HTTPS with zero mixed-content errors.)*
