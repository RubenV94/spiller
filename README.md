# Spiller

A taskbar media control panel for Linux (built and tested on Zorin OS) that
finds every MPRIS-compatible player running on your machine Spotify,
browser tabs (YouTube and others), VLC, and anything else that speaks
MPRIS and lets you control all of them from one sleek popup called the
**Plane**, or directly from a small pill-shaped player on the taskbar
called the **Dock**.

## How it's structured

Because GNOME Shell (which powers Zorin OS's taskbar) only lets shell
**extensions** add things to the panel itself, this project has two halves,
both living together in this one folder:

- `mpris.py` / `service.py` / `requirements.txt` / `spiller.service` pure
  Python. Finds MPRIS players over D-Bus and exposes play/pause/next/
  previous plus track metadata. No GUI code lives here, and it can be
  tested completely on its own.
- `extension.js` / `metadata.json` / `stylesheet.css` — a small GNOME
  Shell extension (JavaScript, the only language the shell itself accepts)
  that renders the Dock and the Plane in the taskbar and talks to the
  Python backend.

## Try the backend right now

You don't need the shell extension yet to see this working. From wherever
you cloned this repo:

```bash
sudo apt install python3-gi python3-dbus
python3 mpris.py
```

With Spotify or a YouTube tab playing, you should see it printed to the
terminal. That confirms detection works before we build any UI on top of it.

Note: the backend uses `dbus-python` (`python3-dbus`), not `pydbus`. Some
Chromium-based browsers (Brave, confirmed) return an incomplete D-Bus
introspection response that `pydbus`'s proxy-building can't parse, even
though the underlying MPRIS methods work fine when called directly by
interface name — which is what `dbus-python` lets us do.

## Run the full thing (backend service + shell extension)

1. **Start the D-Bus service** (this is what the shell extension talks to):

   ```bash
   python3 service.py
   ```

   Leave this running, or skip straight to the Auto-start section below so
   it starts itself automatically instead.

2. **Install the shell extension** (in a new terminal):

   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions/spiller@rubenvatle.github
   cp extension.js metadata.json stylesheet.css ~/.local/share/gnome-shell/extensions/spiller@rubenvatle.github/
   gnome-extensions enable spiller@rubenvatle.github
   ```

   On X11 you can reload the shell with `Alt+F2`, type `r`, Enter. On
   Wayland (Zorin's default) there's no live reload log out and back in
   after installing, and after any future change to `extension.js` too.

3. Check it's running: `gnome-extensions list --enabled` should include
   `spiller@rubenvatle.github`. If it doesn't show up in the panel, check
   for errors with `journalctl -f -o cat /usr/bin/gnome-shell` while
   restarting the shell/session.

## Auto-start at login (no manual terminal needed)

Set `service.py` up as a `systemd --user` service so it starts
automatically every time you log in, instead of needing its own terminal
window each session:

```bash
mkdir -p ~/.config/systemd/user
cp spiller.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now spiller.service
```

Check it's running: `systemctl --user status spiller.service`. From now on
it starts automatically at login you only need to run
`gnome-extensions enable spiller@rubenvatle.github` again if you ever
disable it yourself; the shell remembers enabled extensions across reboots
on its own.

Note: `spiller.service` hardcodes a path to wherever the project was first
cloned. If you clone it somewhere else, edit the `ExecStart` and
`WorkingDirectory` lines in the file (or in your copy at
`~/.config/systemd/user/spiller.service`) to match before enabling it.

## Status

- [x] Wireframes for the Dock + Plane (collapsed/expanded/empty states)
- [x] Python backend: player detection + playback control (`mpris.py`)
- [x] D-Bus service bridging the backend to the shell extension
      (`service.py`)
- [x] GNOME Shell extension: hero player + list, pin-as-hero
- [x] Auto-start via `systemd --user` (`spiller.service`)
- [x] Taskbar position next to the workspace switcher (Zorin's taskbar
      maps this to GNOME's `'center'` panel box)
- [ ] Real frosted/blurred glass look (currently a flat translucent
      panel true blur needs a helper like Blur My Shell, left as a
      future upgrade)
- [ ] Packaging (so it doesn't have to live in a specific cloned folder
      with a hardcoded path)
