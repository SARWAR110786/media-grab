# Publishing MediaGrab on the Chrome Web Store

Everything the store asks for, ready to copy. Publishing needs your own Google account; nobody else can submit on your behalf.

## 1. One-time setup

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and sign in with the Google account that should own the listing.
2. Pay the one-time US$5 registration fee and verify your email address.
3. Under **Account**, fill in the publisher name (shown on the listing) and a contact email.

## 2. Build the upload package

```bash
MEDIAGRAB_WEB_APP_URL=https://media-grab-eight.vercel.app npm run build:extension
```

This writes `apps/extension/mediagrab-chrome-webstore.zip` (manifest at the zip root, as the store requires). It also sets the extension's homepage and its default web-app URL to the live site. Before each update, raise `"version"` in `apps/extension/static/manifest.json` (for example `1.0.1`), because the store rejects a version it has already seen.

## 3. Create the item

**Add new item** → upload the zip, then fill in the tabs below.

### Store listing

| Field | Value |
| --- | --- |
| Name | MediaGrab — Smart Media Downloader (from the manifest) |
| Summary (from the manifest, max 132 chars) | Detect HTML5 video, audio and downloadable files on the current page and download them with Chrome's download manager. |
| Category | Tools |
| Language | English |
| Store icon | `store-icon-128.png` (128×128) |
| Screenshots | `screenshot-1-detect.png`, `screenshot-2-settings.png` (1280×800) |
| Small promo tile | `promo-tile-440x280.png` |
| Homepage URL | https://media-grab-eight.vercel.app |
| Support URL | https://github.com/SARWAR110786/media-grab/issues |

**Description** (paste as is):

```
MediaGrab finds the videos, music and files on the page you're looking at, so you can download them in one click.

• Detects HTML5 video and audio, <source> tags and links to files (MP4, WebM, MP3, WAV, OGG, FLAC, PDF, ZIP, RAR, 7Z and more)
• Shows the file type, length and size when available
• Download one file or everything on the page, straight into your browser's normal download folder
• Optional subfolder and "ask where to save" settings
• Pause, resume, cancel and retry from the Downloads tab
• Open any file in the MediaGrab web app for a multi-connection download with pause and resume

Private by design: no account, no ads, no tracking. MediaGrab never reads or sends your cookies or passwords, and the list of media it finds stays on your computer.

MediaGrab downloads publicly accessible files only. It does not bypass logins, paywalls, DRM or encryption, and it does not download from streaming services such as YouTube or Netflix. Streams that can't be downloaded are clearly labelled.
```

### Privacy practices

**Single purpose:**

> Find downloadable media and file links on the current web page and download them with the browser's download manager.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `downloads` | Saves the files the user chooses through Chrome's download manager, and shows their progress with pause, resume, cancel and retry in the popup. |
| `storage` | Stores the user's settings and the list of downloads started from the extension. Per-tab detection results are kept in session storage. |
| `activeTab` | Lets the Refresh button re-scan the current tab when the user clicks it, including tabs opened before the extension was installed. |
| `scripting` | Used together with activeTab to inject the detection script into the current tab when the user presses Refresh. |
| Host permissions (content script on `http://*/*`, `https://*/*`) | The content script reads `<video>`, `<audio>`, `<source>` and link elements on the page to list downloadable media and show a count on the toolbar icon. Nothing is sent off the device. |
| Optional host permission `<all_urls>` | Requested only if the user turns on "Look up file sizes"; used for HEAD requests (without cookies) to read file sizes. Can be revoked in settings. |

**Remote code:** No, I am not using remote code. (All JavaScript is bundled in the package.)

**Data usage:** tick **none** of the data types. MediaGrab doesn't collect or transmit user data. Then tick all three certifications (no selling, no unrelated use, no creditworthiness use).

**Privacy policy URL:** https://media-grab-eight.vercel.app/privacy

### Distribution

Public, all regions (or choose regions). Free.

## 4. Submit

Click **Submit for review**. Reviews usually take from a few days to a couple of weeks; broad host permissions can add time. You'll get an email when it's approved or if changes are needed.

## 5. After approval

Copy the listing address (`https://chromewebstore.google.com/detail/…`) and add it in Vercel → Project → Settings → Environment Variables:

```
NEXT_PUBLIC_CHROME_WEB_STORE_URL=https://chromewebstore.google.com/detail/<your-item-id>
```

Redeploy. The website then shows **Add to Chrome** buttons on the home page and the Extension page, instead of manual install steps. (`NEXT_PUBLIC_FIREFOX_ADDONS_URL` does the same for Firefox after you publish on addons.mozilla.org.)

## Common rejection reasons to avoid

- **Downloading from YouTube** isn't allowed by Chrome Web Store policy. MediaGrab already refuses YouTube and other protected streaming sites; keep it that way.
- **Permissions not explained:** use the justifications above word for word or close to it.
- **Description mismatch:** the listing must describe what the extension actually does; the text above does.
