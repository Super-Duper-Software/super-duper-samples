# Installing Super Duper Samples

The releases are not code-signed yet. Your OS will warn you once on first launch. Here is how to get past it.

## Download

From the releases page, grab:

| Machine | File |
|---|---|
| Mac, Apple Silicon (M1/M2/M3/M4) | `SDS-<version>-arm64.dmg` |
| Mac, Intel | `SDS-<version>-x64.dmg` |
| Windows 10/11 (64-bit) | `SDS-Setup-<version>.exe` |

Not sure which Mac?  menu > About This Mac. "Chip" = Apple Silicon, "Processor" = Intel.

## macOS

1. Open the `.dmg`, drag the app to Applications.
2. Double-click the app. macOS blocks it. Click **Cancel** (not "Move to Trash").
3. Open  menu > System Settings > Privacy & Security.
4. Scroll down to *"Super Duper Samples" was blocked...*. Click **Open Anyway**.
5. Authenticate with Touch ID or password.
6. A new dialog appears with an **Open** button. Click **Open**.

Every launch after this is normal.

macOS 14 and earlier: right-click the app in Applications > Open > Open. (Removed in macOS 15.)

Terminal alternative:

```sh
xattr -dr com.apple.quarantine "/Applications/Super Duper Samples.app"
```

### Keychain prompt

After you sign in, macOS asks about "Safe Storage" in your keychain. Click **Always Allow**. Plain "Allow" makes it ask every launch.

## Windows

1. Run `SDS-Setup-<version>.exe`.
2. SmartScreen stops it. Click **More info**.
3. Click **Run anyway**.
4. Installer runs, no admin prompt, installs for your user only.

If your browser flags the download, choose **Keep**.

Every launch after install is normal.
