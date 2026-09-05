# Installing Super Duper Samples

Super Duper Samples is not code-signed by Apple or Microsoft yet, so the first
launch takes one extra click on each platform. This page is that click, spelled
out — plus a tour of what you'll see once the window opens.

> **Why the warning?** A signing certificate costs money and ties the app to one
> vendor identity. We'd rather ship now and add signing later. The app is exactly
> as safe as its source (which is public); the operating system just can't verify
> that for you automatically, so it asks you to confirm once.

---

## Screenshots needed

Drop these into `./images/` with these exact names. Each has an art-direction
note next to where it appears below.

- [ ] `download-page.png` — the GitHub Releases page with the asset list
- [ ] `macos-gatekeeper.png` — the "Apple could not verify" dialog
- [ ] `macos-open-anyway.png` — System Settings → Privacy & Security, "Open Anyway" button
- [ ] `macos-second-prompt.png` — the final "Are you sure you want to open it?" dialog with **Open** enabled
- [ ] `macos-keychain-prompt.png` — the "wants to use your confidential information … Safe Storage" keychain dialog, **Always Allow** visible
- [ ] `windows-smartscreen.png` — the blue "Windows protected your PC" dialog
- [ ] `windows-smartscreen-runanyway.png` — same dialog after **More info**, showing **Run anyway**
- [ ] `first-window.png` — the app on first launch, dark, sign-in gate visible
- [ ] `sign-in-browser.png` — the Freesound authorize page in the system browser
- [ ] `sign-in-callback.png` — the "you can close this tab" page
- [ ] `consent-banner.png` — the one-time "auditioning downloads sounds" notice
- [ ] `first-search.png` — a search with results, one row auditioning
- [ ] `drag-out.png` — a row mid-drag into a DAW timeline
- [ ] `credits-panel.png` — the Credits (Attribution Manifest) panel for a collection

---

## 1. Download

Get the latest build from the releases page:

**{{DOWNLOAD_URL}}**

<!-- SHOT: download-page.png — GitHub Releases, the four assets + SHA256SUMS.txt visible -->
![The releases page](./images/download-page.png)

Pick the right file for your machine:

| Your machine | File |
|---|---|
| Mac with Apple Silicon (M1 / M2 / M3 / M4) | `SDS-<version>-arm64.dmg` |
| Mac with an Intel processor | `SDS-<version>-x64.dmg` |
| Windows 10 or 11 (64-bit) | `SDS-Setup-<version>.exe` |

> Not sure which Mac you have?  → menu → **About This Mac**. "Chip" means Apple
> Silicon; "Processor" means Intel.

**Optional integrity check.** Each release includes `SHA256SUMS.txt`. To confirm
your download arrived intact:

- macOS: `shasum -a 256 ~/Downloads/SDS-<version>-arm64.dmg`
- Windows (PowerShell): `Get-FileHash $HOME\Downloads\SDS-Setup-<version>.exe`

The value should match the line for that file in `SHA256SUMS.txt`.

---

## 2. First launch on macOS

Open the `.dmg` and drag **Super Duper Samples** onto the **Applications**
folder, as usual. The difference comes when you first open it.

### What you'll see

Double-clicking the app shows this instead of opening it:

<!-- SHOT: macos-gatekeeper.png — "macOS cannot verify that this app is free from malware" / "Apple could not verify..."; buttons: Move to Trash / Cancel -->
![macOS blocks the first launch](./images/macos-gatekeeper.png)

There is **no Open button** in this dialog on purpose. Click **Cancel** (not
"Move to Trash") and do the following once.

### Get past it (any recent macOS)

1. Open  → **System Settings** → **Privacy & Security**.
2. Scroll down. You'll see a line like *"Super Duper Samples" was blocked to
   protect your Mac.* Click **Open Anyway**.

   <!-- SHOT: macos-open-anyway.png — Privacy & Security pane scrolled to the "was blocked" row with the Open Anyway button -->
   ![The Open Anyway button in System Settings](./images/macos-open-anyway.png)

3. Authenticate with Touch ID or your password when asked.
4. One more dialog appears — this time it **has** an Open button. Click **Open**.

   <!-- SHOT: macos-second-prompt.png — "Are you sure you want to open it?" with Open / Cancel, Open enabled -->
   ![The final confirmation](./images/macos-second-prompt.png)

That's it. macOS remembers your choice — every launch after this is normal.

### Faster route on macOS 14 and earlier

On Sonoma and older you can skip System Settings: **right-click** (or
Control-click) the app in Applications → **Open** → **Open** in the dialog. macOS
Sequoia (15) removed this shortcut, which is why the steps above are the main
path.

### If you're comfortable in Terminal

One command clears the quarantine flag and suppresses the prompt entirely:

```sh
xattr -dr com.apple.quarantine "/Applications/Super Duper Samples.app"
```

---

## 3. First launch on Windows

Run `SDS-Setup-<version>.exe`. Because the installer isn't signed, Windows
SmartScreen stops it:

<!-- SHOT: windows-smartscreen.png — blue dialog, "Windows protected your PC", only a "Don't run" button visible -->
![SmartScreen blocks the installer](./images/windows-smartscreen.png)

1. Click the small **More info** link in that dialog.
2. A **Run anyway** button appears. Click it.

   <!-- SHOT: windows-smartscreen-runanyway.png — same dialog expanded, app name + publisher "Unknown publisher", Run anyway button -->
   ![Run anyway](./images/windows-smartscreen-runanyway.png)

3. The installer runs. It installs **just for you** — no administrator prompt —
   and creates a Start-menu entry.

Your browser (Edge, Chrome) may also warn that the file "isn't commonly
downloaded." Choose **Keep** / **Keep anyway**. Every launch after the install is
normal.

---

## 4. What you'll see once it opens

From here the app behaves the same on both platforms.

### The window

<!-- SHOT: first-window.png — dark window, header with Search / Library / Collections, main pane showing the sign-in gate -->
![First launch](./images/first-window.png)

It opens dark (it's built to sit next to a DAW). You can dock it to the side of
your screen — the layout holds together down to a narrow rail.

### You need a Freesound account to search

Super Duper Samples plays, downloads, and drags out real sounds from
[Freesound](https://freesound.org) **as you** — so search is gated behind
signing in with your Freesound account. The **Library** and **Collections** tabs
work without signing in; only **Search** needs it.

Click **Sign in with Freesound**. Your normal web browser opens on Freesound's
authorization page:

<!-- SHOT: sign-in-browser.png — freesound.org OAuth "authorize Super Duper Samples" page in Safari/Chrome -->
![Authorizing on Freesound](./images/sign-in-browser.png)

Approve it. The browser bounces to a tiny local page telling you it worked:

<!-- SHOT: sign-in-callback.png — plain page: "Signed in. You can close this tab." -->
![Sign-in complete](./images/sign-in-callback.png)

Close that tab and return to the app. The header now shows **Signed in as
&lt;your username&gt;**. This survives quitting and reopening — you sign in once.

### The keychain prompt (macOS)

Right after you sign in, macOS pops up a dialog:

> *"Super Duper Samples" wants to use your confidential information stored in
> "Super Duper Samples Safe Storage" in your keychain.*

<!-- SHOT: macos-keychain-prompt.png — the keychain access dialog, "Always Allow" / "Allow" / "Deny" buttons -->
![The keychain prompt](./images/macos-keychain-prompt.png)

This is the app encrypting your Freesound login so it isn't sitting in plain text
on disk. The encryption key lives in your login keychain, and macOS asks before
letting the app touch it.

Click **Always Allow**. If you click plain **Allow**, macOS asks again every time
you launch the app. (It re-asks because the app isn't signed with a paid
certificate yet — the same reason section 2 exists. Once it's signed, this
becomes a genuine one-time prompt.)

> No account? Create a free one at
> [freesound.org](https://freesound.org), then
> [register an API application](https://freesound.org/apiv2/apply/) if you're
> running your own build. The public build already has that part configured.

### The one-time audition notice

The first time you run a search, a short banner explains that **auditioning a
sound downloads the full-quality Original against your Freesound account's
download record** — that's how the sound becomes draggable the instant you want
it. Click **OK, got it**. You won't see it again.

<!-- SHOT: consent-banner.png — the amber notice bar above the results with an "OK, got it" button -->
![The audition notice](./images/consent-banner.png)

### Searching, auditioning, keeping

<!-- SHOT: first-search.png — results list, waveforms, licence chips, one row with a "downloading" / "ready" chip -->
![A search in progress](./images/first-search.png)

- **Type in the search box.** Results stream in as a list with waveforms and a
  licence chip on each row.
- **Press ▶ on a row** (or select it and press <kbd>J</kbd>/<kbd>K</kbd> to move)
  to audition. Behind the scenes the Original downloads; a small chip goes
  `downloading → ready`.
- A sound you only auditioned is **staged** — on disk and draggable, but not
  "yours". Staged sounds are cleared automatically over time.
- **Press <kbd>s</kbd>** (or use the row menu) to **save** the selected sound to
  your **Library**. Saved sounds stay until you remove them.

### Dragging a sound into your DAW

Once a row shows the **ready** chip, drag it straight out of the window and drop
it onto your DAW's timeline, a Finder/Explorer window, or a sample folder.

<!-- SHOT: drag-out.png — a row being dragged, ghost image over a DAW arrange view -->
![Dragging a sound out](./images/drag-out.png)

The file that lands is the real Original the author uploaded — full format, bit
depth and sample rate. Previews are never what gets dragged.

### Collections and credits

- Group Library sounds into **Collections** (a sound can be in several).
- Open a collection and click **Credits** to generate an **Attribution
  Manifest** — a plain-text list of every sound, its author, its licence and its
  Freesound URL, with anything that restricts your intended use flagged. Paste it
  into your release notes.

<!-- SHOT: credits-panel.png — the Credits panel listing sounds with author / licence / URL, one row flagged non-commercial -->
![The Credits panel](./images/credits-panel.png)

---

## Troubleshooting

**The app still won't open on macOS ("damaged and can't be opened").**
Run the Terminal command in section 2, then try again. If it persists, the
download may be corrupt — re-download and check the SHA-256.

**Sign-in opens the browser but nothing happens back in the app.**
The app listens on `localhost:8910` for Freesound to hand the login back. If
something else is using that port, quit it and try again. Corporate proxies that
intercept `localhost` will also break this.

**macOS asks about the keychain ("Safe Storage") every launch.**
You clicked "Allow" instead of "Always Allow" the first time. Open **Keychain
Access**, find the **Super Duper Samples Safe Storage** item, delete it, then
launch the app and sign in again — this time click **Always Allow**. Until the
app is signed with a paid certificate, a fresh re-prompt after installing a new
version is expected.

**Search says I'm not signed in even though the header shows my name.**
Your Freesound session expired. Click **Sign in again** in the header or on the
search pane.

**Where are the logs?** Attach `app.log` when you report a bug:

- macOS: `~/Library/Application Support/Super Duper Samples/logs/app.log`
- Windows: `%APPDATA%\Super Duper Samples\logs\app.log`

**Updating.** There's no auto-update. When a new version is announced, download it
from the same releases page and install it over the old one — your Library,
downloaded files and sign-in are kept.

**Support.** [ko-fi.com/sparlos](https://ko-fi.com/sparlos) ·
info@superdupersoftware.net
