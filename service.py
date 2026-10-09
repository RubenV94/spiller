"""
spiller_backend.service
------------------------
Exposes PlayerRegistry over a small custom D-Bus service so the GNOME Shell
extension (JavaScript) can call into it, without the extension needing to
know anything about MPRIS itself.

Run this as a background process (e.g. via a systemd --user service, or
autostart entry) alongside your session. The GNOME Shell extension talks to
it at bus name "org.spiller.Panel".

Requires: dbus-python (sudo apt install python3-dbus)
"""

from __future__ import annotations

import json

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

from mpris import PlayerRegistry

BUS_NAME = "org.spiller.Panel"
OBJECT_PATH = "/org/spiller/Panel"
IFACE = "org.spiller.Panel"


class SpillerService(dbus.service.Object):
    def __init__(self, bus: dbus.SessionBus):
        super().__init__(bus, OBJECT_PATH)
        self.registry = PlayerRegistry()

    @dbus.service.method(IFACE, in_signature="", out_signature="s")
    def ListPlayers(self) -> str:
        """Returns a JSON array of player states, e.g.:
        [{"bus_name": "...", "identity": "Spotify", "title": "...",
          "artist": "...", "status": "Playing",
          "can_go_next": true, "can_go_previous": true}, ...]
        """
        states = self.registry.list_states()
        payload = [
            {
                "bus_name": s.bus_name,
                "identity": s.identity,
                "title": s.title,
                "artist": s.artist,
                "status": s.status,
                "can_go_next": s.can_go_next,
                "can_go_previous": s.can_go_previous,
                "desktop_entry": s.desktop_entry,
            }
            for s in states
        ]
        return json.dumps(payload)

    @dbus.service.method(IFACE, in_signature="s", out_signature="")
    def PlayPause(self, bus_name: str):
        self.registry.get_player(str(bus_name)).play_pause()

    @dbus.service.method(IFACE, in_signature="s", out_signature="")
    def Next(self, bus_name: str):
        self.registry.get_player(str(bus_name)).next()

    @dbus.service.method(IFACE, in_signature="s", out_signature="")
    def Previous(self, bus_name: str):
        self.registry.get_player(str(bus_name)).previous()


def main():
    DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    bus_name = dbus.service.BusName(BUS_NAME, bus)
    SpillerService(bus)
    print(f"spiller service running on {BUS_NAME} ...")
    GLib.MainLoop().run()


if __name__ == "__main__":
    main()
