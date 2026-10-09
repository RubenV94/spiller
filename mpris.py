"""
spiller_backend.mpris
----------------------
Finds every MPRIS-compatible media player currently running (Spotify,
browser tabs playing YouTube/Twitch, VLC, etc.) and gives a small,
uniform interface to read their state and send them commands.

Requires: dbus-python (sudo apt install python3-dbus)

Note: this intentionally uses dbus-python instead of pydbus. pydbus builds
its proxies by first introspecting the object and parsing the returned
interface list; some Chromium-based browsers (observed with Brave) return
an incomplete introspection response that pydbus can't parse, even though
the object's actual methods and properties work fine when called directly
by interface name. dbus-python lets us call Properties.Get / Player.* by
name without depending on introspection succeeding first -- the same
approach tools like `playerctl` use.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import dbus

MPRIS_PREFIX = "org.mpris.MediaPlayer2."
OBJECT_PATH = "/org/mpris/MediaPlayer2"
PROPERTIES_IFACE = "org.freedesktop.DBus.Properties"
PLAYER_IFACE = "org.mpris.MediaPlayer2.Player"
ROOT_IFACE = "org.mpris.MediaPlayer2"


@dataclass
class PlayerState:
    bus_name: str          # e.g. "org.mpris.MediaPlayer2.spotify"
    identity: str          # human-readable app name, e.g. "Spotify"
    title: str
    artist: str
    status: str            # "Playing" | "Paused" | "Stopped"
    can_go_next: bool
    can_go_previous: bool
    desktop_entry: str = ""  # e.g. "spotify" -- used to look up the app's
                              # real installed icon (see DesktopEntry in
                              # the MPRIS spec). Empty if the player doesn't
                              # provide one.

    @property
    def short_name(self) -> str:
        """org.mpris.MediaPlayer2.spotify -> spotify"""
        return self.bus_name[len(MPRIS_PREFIX):]


class Player:
    """Thin wrapper around one MPRIS player, talking to it directly by
    interface name rather than relying on D-Bus introspection."""

    def __init__(self, bus: dbus.SessionBus, bus_name: str):
        self._bus = bus
        self.bus_name = bus_name
        self._object = bus.get_object(bus_name, OBJECT_PATH, introspect=False)
        self._props = dbus.Interface(self._object, PROPERTIES_IFACE)
        self._player = dbus.Interface(self._object, PLAYER_IFACE)

    def read_state(self) -> Optional[PlayerState]:
        try:
            metadata = self._props.Get(PLAYER_IFACE, "Metadata")
            status = self._props.Get(PLAYER_IFACE, "PlaybackStatus")
            try:
                identity = self._props.Get(ROOT_IFACE, "Identity")
            except dbus.DBusException:
                identity = self.bus_name

            try:
                desktop_entry = str(self._props.Get(ROOT_IFACE, "DesktopEntry"))
            except dbus.DBusException:
                desktop_entry = ""

            title = str(metadata.get("xesam:title", "") or "")
            artists = metadata.get("xesam:artist", []) or []
            artist = ", ".join(str(a) for a in artists) if artists else ""

            can_next = bool(self._props.Get(PLAYER_IFACE, "CanGoNext"))
            can_prev = bool(self._props.Get(PLAYER_IFACE, "CanGoPrevious"))

            return PlayerState(
                bus_name=self.bus_name,
                identity=str(identity),
                title=title,
                artist=artist,
                status=str(status),
                can_go_next=can_next,
                can_go_previous=can_prev,
                desktop_entry=desktop_entry,
            )
        except dbus.DBusException as e:
            # Player likely quit between enumeration and read, or genuinely
            # isn't exporting a working interface. Skip it rather than
            # crashing the scan.
            print(f"[spiller] skipping {self.bus_name}: {e}")
            return None

    def play_pause(self):
        self._player.PlayPause()

    def next(self):
        self._player.Next()

    def previous(self):
        self._player.Previous()


class PlayerRegistry:
    """Enumerates all running MPRIS players on the session bus."""

    def __init__(self):
        self._bus = dbus.SessionBus()

    def list_players(self) -> list[Player]:
        dbus_proxy = self._bus.get_object(
            "org.freedesktop.DBus", "/org/freedesktop/DBus"
        )
        names = dbus_proxy.ListNames(dbus_interface="org.freedesktop.DBus")
        mpris_names = [str(n) for n in names if str(n).startswith(MPRIS_PREFIX)]
        return [Player(self._bus, name) for name in mpris_names]

    def list_states(self) -> list[PlayerState]:
        states = []
        for player in self.list_players():
            state = player.read_state()
            if state is not None:
                states.append(state)
        return states

    def get_player(self, bus_name: str) -> Player:
        return Player(self._bus, bus_name)


if __name__ == "__main__":
    # Quick manual test: run this file directly to see what's detected.
    registry = PlayerRegistry()
    states = registry.list_states()
    if not states:
        print("No MPRIS players found. Open Spotify, a YouTube tab, or VLC and try again.")
    for s in states:
        print(f"[{s.identity}] {s.status} - {s.artist} - {s.title}")
