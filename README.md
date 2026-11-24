# BrowserSerialTool

A browser-based serial terminal with logging and live plotting. Connect to microcontrollers, sensors, lab instruments, USB serial adapters, and other serial devices, send commands, capture traffic, and plot numeric telemetry. No application installation, account, backend, CDN, or runtime dependencies.

## Run it

Download **[BrowserSerialTool.html](BrowserSerialTool.html)** and open it in desktop Chrome or Edge. This single file includes everything and works offline. Click **Choose a port**, select your device in the browser's chooser, check the baud rate (115200 by default), and click **Connect**. Close other serial monitors first.

Local file access depends on browser and enterprise policies. If serial access is unavailable, use the HTTPS GitHub Pages site, or optionally serve the folder:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000`. Python is only needed for this optional file server, never to access serial hardware. **Start demo** generates simulated telemetry without hardware, including on browsers without Web Serial.

## Features

- Device chooser, refresh of authorized ports, and device arrival/removal detection.
- Configurable baud rate, 7/8 data bits, 1/2 stop bits, parity, and hardware flow control.
- UTF-8 terminal, timestamps, raw hexadecimal receive view, RX/TX counters, pause view, auto-scroll, and clear.
- Send text with LF, CRLF, CR, or no ending; send exact hex bytes; recall the last 100 commands with arrow keys.
- Named connection profiles saved locally, including serial settings, send mode, and line ending.
- Named text/hex command shortcuts, with Load, Send, and Delete controls.
- Case-insensitive terminal search, highlighted matches, matching-only view, and RX/TX filters.
- Continuous CSV recording directly to a chosen local file, independently of the display buffer.
- DTR/RTS controls and CTS/DSR/DCD/RI readout when supported by the adapter.
- Live plot of up to eight numeric channels, with a legend and automatic vertical scaling.
- Download text logs, CSV traffic logs (including raw RX hex), and numeric plot CSV.
- Responsive layout, no external requests during use, and a portable HTML download.

## Platform and port discovery limits

This is platform independent across **Windows, macOS, Linux, and ChromeOS with a desktop browser that implements Web Serial**, normally Chrome or Edge. It is not compatible with every browser or mobile device. Safari and Firefox should use demo mode unless they add Web Serial support. The page checks API availability rather than guessing from the browser name. Device drivers and OS serial permissions may still be required; this tool cannot replace a missing USB adapter driver.

Browser security requires a user gesture and explicit device permission. **Choose a port** opens the native chooser for new devices; **Refresh** lists connected ports already authorized for this page. A website cannot silently scan every COM port, and the API does not expose OS paths such as `COM3` or `/dev/ttyUSB0`. The dropdown uses USB vendor/product identifiers when available; identical adapters may have identical descriptions. Permissions belong to the origin, so a local file, localhost, and a hosted page may have separate grants.

Use a top-level page in a secure context: HTTPS, localhost, or a local file if your browser permits it. Embedded previews may block serial access. See the [official Web Serial documentation](https://developer.chrome.com/docs/capabilities/serial/).

## Profiles, shortcuts, and search

Expand **Saved connection profiles**, set the serial options and send mode/line ending, enter a **Profile name**, then **Save current settings**. Select a profile and click **Load** to apply it while disconnected. Loading does not connect or change device signals. Saving with the same name updates an existing profile. Delete removes it. Profiles store settings, not device permission or an OS port name.

Expand **Command shortcuts**, enter a command in the normal send field, and save it with a name. Each shortcut remembers its own text/hex mode and line ending. **Load** fills the editor; **Send [name]** transmits immediately using that shortcut's settings. Hex shortcuts send exact bytes without an appended ending. Sending is disabled while disconnected; demo mode records simulated transmissions locally. Saving the same name updates a shortcut. Up to 50 profiles and 50 shortcuts can be saved.

Profiles and shortcut commands use local browser storage for the current origin. They survive reloads when storage is available, but do not sync between browsers, files, or hosted origins. Browser storage restrictions produce a visible error. Deleting an item removes it from local storage. Logs and ad-hoc command history remain in memory.

**Search / filter** finds literal text without case sensitivity and highlights all matches in the visible rows. **Only matches** hides nonmatching rows; **RX only / TX only** filters direction. In Hex view, search applies to displayed hex bytes. Searches cover matching retained entries (up to 10,000 entries); only the latest 1,500 matching rows are rendered. Filters never change exports, recording, or plotting. Pause freezes view/search updates while capture continues.

## Continuous recording

Click **Record to CSV…**, choose a file in the browser's save dialog, then generate traffic. This uses the browser's File System Access API, when available (normally desktop Chrome/Edge in a secure context). If unavailable, the recording control is disabled with an explanation and buffer downloads still work. Selecting an existing file replaces its contents when finalized.

Recording starts after the file is opened and captures **new** RAW/RX/TX entries, including binary receive chunks and successfully written commands; the existing buffer is not copied. Recording continues through filtering, pause, Clear, disconnection, and subsequent sessions until **Stop & save**. Demo traffic is recorded too. Disconnecting flushes any final decoded line into an active recording. An unfinished line when you stop is still preserved in RAW hex rows.

The recording does not have the 10,000-entry buffer limit. Writes are serialized with at most 8 MiB of queued/in-flight encoded data. If the disk cannot keep up or writing fails, recording stops with a visible error, rather than silently skipping entries; the failed file is aborted and is not finalized. The terminal and buffer exports remain available.

**Always click Stop & save and wait for the saved confirmation before closing or reloading.** The browser writes through a temporary stream and commits the selected file on successful close; a crash or closing the tab before finalization can lose the recording. The page requests a leave warning while connected or recording, subject to browser behavior. Long sessions should be stopped and saved periodically. See the [official file access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access/).

## Logs and plot format

Each complete received text line becomes a terminal entry. CR, LF, and CRLF are supported, including endings split across reads. UTF-8 is decoded across chunks. A final unfinished line is shown on disconnect; long unterminated lines are split at 16,384 characters to bound memory. Binary and partial-line data is immediately available in **Hex** view. This is a line terminal, not a VT100/ANSI emulator.

For plotting, send one sample per line, with comma, semicolon, tab, or space separated numbers, for example:

```text
24.10, 18.25, 12.00
24.15, 18.30, 12.05
```

Columns become channels 1–8. Scientific notation is supported. Labels, JSON, invalid numbers, and lines with more than eight columns are ignored by the plot but remain in the terminal. The horizontal axis is sample order, not elapsed time. Plot CSV includes browser receipt timestamps; these are not hardware acquisition timestamps.

**Retention is bounded:** the traffic buffer retains the latest 10,000 entries, including raw receive chunks and decoded lines. The terminal renders the latest 1,500 matching entries, and the plot retains 500 samples. Old entries are discarded. Pause freezes display updates while capture continues within those limits; it is not device flow control. Buffer exports contain the retained entries; use continuous recording for longer captures. Clear resets counters, retained traffic, pending line text, and plot samples. Buffered logs are held in memory and lost on reload or closing the page; export them or stop and save the continuous recording before leaving. New sessions append to the buffer until Clear is used. Demo data is also retained until Clear.

CSV traffic includes `timestamp,direction,text,hex`; `RAW` rows preserve received bytes independently of decoded `RX` rows, and `TX` rows record writes accepted by the browser. A successful write does not prove the device processed the command. Text export excludes RAW rows. Spreadsheet formula prefixes in text CSV cells are escaped. Plot CSV contains numeric values and timestamps.

## Device notes

Use your device's configured baud rate. Opening a port or changing DTR/RTS may reset a board; this tool does not run firmware-specific boot or reset sequences. DTR/RTS are only changed when their checkboxes are used. Hardware flow control owns RTS. The app does not flash firmware or implement a device-specific protocol. Close Arduino Serial Monitor or any other program holding the port. On Linux, check your distribution's serial-device group permissions if opening fails.

## GitHub and GitHub Pages

The repository is ready to upload; no remote repository or publication is created automatically.

1. Create a GitHub repository named `BrowserSerialTool` and push this folder.
2. Under **Settings → Pages**, choose **Deploy from a branch**, `main`, and `/ (root)`.
3. Open the resulting HTTPS Pages URL. `index.html` is the complete app; no server configuration or build service is needed.

The included CI workflow checks JavaScript syntax, runs core regression tests and browser integration checks, and verifies that both committed HTML files match the sources. GitHub Actions must be enabled for CI to run.

## Development

The supplied `example/` is preserved as a reference. The app itself is in `src/`; edit those files and rebuild the two identical distribution files:

```sh
python3 scripts/build.py
node --test tests/core.test.cjs
python3 scripts/build.py --check
```

Python 3 and Node.js 20+ are development tools only. There are no runtime npm dependencies or bundler. Playwright is an optional development dependency for browser checks. `src/page.html` defines the interface; `style.css` styles it; `core.js` contains the transport and parsers; `app.js` connects the interface to them. Generated `index.html` and `BrowserSerialTool.html` are committed so downloads and Pages work immediately.

To run browser integration checks as well:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

To use an existing Chrome executable instead of downloading Chromium, set `BST_CHROME` to its path. The browser suite serves the built page on a temporary localhost port and mocks serial/file access to test saved settings, exact text and binary command bytes, safe filtering/highlighting, recording beyond buffer eviction, write/finalization failures, cancellation, and narrow layouts. These mocks are confined to the test harness; the shipped app uses native APIs.

Automated core tests use fake Web Streams; real hardware, native device selection, and OS/browser permission behavior require manual verification. Before a release, check connect/send/receive, hex input, signals, unplug/reconnect, and downloads against your adapter, and test the demo at desktop and narrow viewport sizes.

## Privacy and license

Serial traffic stays local: in tab memory, downloaded exports, or a recording file you choose. The app has no analytics, external assets, or network backend. Profiles and saved command shortcuts persist in local browser storage. Buffered logs and ad-hoc command history do not. Saved shortcut commands can contain sensitive information; delete shortcuts you no longer need. The browser manages serial device permissions. Opening documentation links navigates to external sites.

MIT licensed; see [LICENSE](LICENSE). Contributions welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
