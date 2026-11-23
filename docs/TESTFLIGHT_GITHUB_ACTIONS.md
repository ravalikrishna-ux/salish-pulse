# iOS TestFlight via GitHub Actions (Option B — Zero Mac Required)

This repository is pre-configured to build and upload signed iOS builds straight to **Apple TestFlight** using **GitHub Actions + Expo EAS Build** (`.github/workflows/testflight.yml`).

---

## Step 1: Create Your Expo Project & Token (2 minutes)

1. Sign in (or create a free account) at [expo.dev](https://expo.dev).
2. Click **Create a Project** (slug: `salish-pulse`) and copy the **Project ID** (UUID, e.g. `12345678-abcd-...`).
3. Go to **Account Settings → Access Tokens** ([expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens)) and create a new token → copy it as `EXPO_TOKEN`.

---

## Step 2: Create Your App & API Key in App Store Connect (3 minutes)

> Requires an active **Apple Developer Program** membership (\$99/year).

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps → + New App**:
   - **Platform:** iOS
   - **Name:** `SalishPulse` (or your preferred App Store display name)
   - **Bundle ID:** `org.salishpulse.orcatracker` *(if you choose a different Bundle ID, set repository variable `IOS_BUNDLE_ID` in GitHub)*
   - After creating the app, go to **App Information** and copy the numeric **Apple ID** (`ASC_APP_ID`).
2. Go to **Users and Access → Integrations → App Store Connect API → Generate API Key**:
   - **Role:** `App Manager` (or `Admin`)
   - Download the `.p8` file (you can only download it once!) and copy:
     - **Issuer ID** (`ASC_API_KEY_ISSUER_ID`)
     - **Key ID** (`ASC_API_KEY_ID`)
     - Contents of the `.p8` file (`ASC_API_KEY_P8` — raw PEM text or base64 both work).
3. Copy your 10-character **Team ID** from [developer.apple.com/account](https://developer.apple.com/account) → Membership Details (`APPLE_TEAM_ID`).
4. *(One-time signing link on Expo.dev)*: In your Expo project at `expo.dev` → **Credentials → iOS**, link your App Store Connect API Key so EAS can automatically generate and manage your iOS Distribution Certificate & Provisioning Profile without interactive 2FA!

---

## Step 3: Add Secrets to GitHub

Open **GitHub → `ravalikrishna-ux/salish-pulse` → Settings → Secrets and variables → Actions → New repository secret**:

| Secret Name | Required | Where to Get It |
| :--- | :---: | :--- |
| `EXPO_TOKEN` | Yes | `expo.dev` → Settings → Access Tokens |
| `EXPO_PROJECT_ID` | Yes | `expo.dev` → Your Project → Project ID (UUID) |
| `ASC_APP_ID` | For TestFlight auto-submit | App Store Connect → Your App → App Information → Apple ID |
| `APPLE_TEAM_ID` | For TestFlight auto-submit | `developer.apple.com/account` → Membership → Team ID |
| `ASC_API_KEY_ID` | For TestFlight auto-submit | App Store Connect → Users & Access → Integrations → Key ID |
| `ASC_API_KEY_ISSUER_ID` | For TestFlight auto-submit | App Store Connect → Users & Access → Integrations → Issuer ID |
| `ASC_API_KEY_P8` | For TestFlight auto-submit | Contents of your downloaded `AuthKey_XXXXXX.p8` file |

*(Optional repository variables under **Variables** tab: `IOS_BUNDLE_ID` if you customize the bundle ID, and `EXPO_PUBLIC_API_URL` once your Cloudflare Worker is deployed.)*

---

## Step 4: Trigger Your First TestFlight Build!

1. Go to **GitHub → Actions → `iOS TestFlight Release (EAS Build)` → Run workflow**.
2. Tip: You can first run with **`dry_run = true`** to verify TypeScript + native iOS Xcode prebuild in ~60 seconds.
3. Then run with **`dry_run = false`** and **`auto_submit = true`** (or push a release tag like `git tag v1.0.0 && git push origin v1.0.0`).
4. Track build progress at [expo.dev](https://expo.dev) — once finished (~10–15 min), the build automatically appears in **App Store Connect → TestFlight** ready to install via the Apple TestFlight app on your iPhone!
