/* Spiller taskbar indicator.
 *
 * This file intentionally contains almost no MPRIS logic -- it just renders
 * the pill/popup and calls the Python D-Bus service (see
 * spiller_backend/service.py) for everything else. Run that service first
 * (or set it up as a systemd --user service) before enabling this extension.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BUS_NAME = 'org.spiller.Panel';
const OBJECT_PATH = '/org/spiller/Panel';
const IFACE_NAME = 'org.spiller.Panel';
const POLL_SECONDS = 2;

function callSpiller(methodName, paramsVariant, replyType, callback) {
    Gio.DBus.session.call(
        BUS_NAME, OBJECT_PATH, IFACE_NAME, methodName,
        paramsVariant, replyType, Gio.DBusCallFlags.NONE, -1, null,
        (conn, res) => {
            try {
                const result = conn.call_finish(res);
                if (callback)
                    callback(result);
            } catch (e) {
                // Service probably isn't running yet -- fail quietly, we'll
                // retry on the next poll tick.
                if (callback)
                    callback(null);
            }
        }
    );
}

const SpillerIndicator = GObject.registerClass(
class SpillerIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Spiller', false);

        this._players = [];
        this._pinnedBusName = null;

        // --- Pill (collapsed taskbar view) ---
        this._pillBox = new St.BoxLayout({
            style_class: 'spiller-pill',
            vertical: false,
        });

        this._pillIcon = new St.Label({text: '\u266B', style_class: 'spiller-pill-icon'});
        this._pillPrev = this._makeIconButton('media-skip-backward-symbolic', () => this._prev());
        this._pillPlay = this._makeIconButton('media-playback-pause-symbolic', () => this._playPause());
        this._pillNext = this._makeIconButton('media-skip-forward-symbolic', () => this._next());
        this._pillLabel = new St.Label({text: 'Nothing playing', style_class: 'spiller-pill-label', y_align: Clutter.ActorAlign.CENTER});
        this._pillLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        this._pillBox.add_child(this._pillIcon);
        this._pillBox.add_child(this._pillPrev);
        this._pillBox.add_child(this._pillPlay);
        this._pillBox.add_child(this._pillNext);
        this._pillBox.add_child(this._pillLabel);
        this.add_child(this._pillBox);

        // --- Popup (expanded view) ---
        this._popupContent = new St.BoxLayout({
            vertical: true,
            style_class: 'spiller-popup',
        });
        const section = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        section.add_child(this._popupContent);
        this.menu.addMenuItem(section);

        this._render();
        this._refresh();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _makeIconButton(iconName, onClick) {
        const btn = new St.Button({
            style_class: 'spiller-icon-btn',
            child: new St.Icon({icon_name: iconName, icon_size: 14}),
        });
        btn.connect('button-press-event', () => {
            onClick();
            return Clutter.EVENT_STOP; // don't let the click open/close the popup
        });
        return btn;
    }

    _makeGlyphButton(glyph, styleClass, onClick) {
        const btn = new St.Button({
            style_class: `spiller-icon-btn ${styleClass || ''}`,
            child: new St.Label({text: glyph}),
        });
        btn.connect('button-press-event', () => {
            onClick();
            return Clutter.EVENT_STOP;
        });
        return btn;
    }

    _refresh() {
        callSpiller('ListPlayers', null, new GLib.VariantType('(s)'), (result) => {
            if (!result)
                return;
            try {
                const [json] = result.deep_unpack();
                this._players = JSON.parse(json);
            } catch (e) {
                this._players = [];
            }
            this._render();
        });
    }

    _heroPlayer() {
        if (this._pinnedBusName) {
            const pinned = this._players.find(p => p.bus_name === this._pinnedBusName);
            if (pinned)
                return pinned;
            // Pinned player disappeared (app closed) -- fall back automatically.
            this._pinnedBusName = null;
        }
        return this._players.find(p => p.status === 'Playing') || this._players[0] || null;
    }

    _togglePin(busName) {
        this._pinnedBusName = (this._pinnedBusName === busName) ? null : busName;
        this._render();
    }

    _lookupRealIcon(p) {
        // 1) The player's own DesktopEntry, if it reports one.
        // 2) A guess from its display name (e.g. "Brave" -> brave-browser).
        // 3) A search of installed apps by that name.
        const ids = [];
        if (p.desktop_entry) {
            ids.push(`${p.desktop_entry}.desktop`);
            // Snap packages name their desktop files "<snap>_<app>.desktop",
            // e.g. spotify_spotify.desktop.
            ids.push(`${p.desktop_entry}_${p.desktop_entry}.desktop`);
        }

        const name = (p.identity || '').toLowerCase().replace(/\s+/g, '-');
        if (name) {
            ids.push(`${name}.desktop`);
            ids.push(`${name}-browser.desktop`);
        }

        for (const id of ids) {
            try {
                const appInfo = Gio.DesktopAppInfo.new(id);
                if (appInfo && appInfo.get_icon())
                    return appInfo.get_icon();
            } catch (e) {
                // Not installed under that id; try the next one.
            }
        }

        try {
            const hits = Gio.DesktopAppInfo.search(p.identity || '');
            for (const group of hits) {
                for (const id of group) {
                    const appInfo = Gio.DesktopAppInfo.new(id);
                    if (appInfo && appInfo.get_icon())
                        return appInfo.get_icon();
                }
            }
        } catch (e) {
            // Search unavailable; fall through to the badge.
        }
        return null;
    }

    _makeBadge(p, sizeClass) {
        const gicon = this._lookupRealIcon(p);
        if (gicon) {
            const iconSize = sizeClass === 'spiller-hero-badge' ? 40 : 18;
            return new St.Icon({
                gicon,
                icon_size: iconSize,
                style_class: `${sizeClass} spiller-badge-real`,
            });
        }
        // Fallback: no DesktopEntry (or no matching installed icon) --
        // use the colored glyph badge instead.
        return new St.Label({
            text: this._sourceGlyph(p.identity),
            style_class: `${sizeClass} ${this._sourceClass(p.identity)}`,
        });
    }

    _sourceClass(identity) {
        const id = (identity || '').toLowerCase();
        if (id.includes('spotify')) return 'spiller-src-spotify';
        if (id.includes('brave') || id.includes('chrom') || id.includes('firefox')) return 'spiller-src-browser';
        if (id.includes('vlc')) return 'spiller-src-vlc';
        return 'spiller-src-default';
    }

    _sourceGlyph(identity) {
        const id = (identity || '').toLowerCase();
        if (id.includes('spotify')) return '\u266B';
        if (id.includes('vlc')) return '\u25B6';
        return '\u25CF';
    }

    _render() {
        const hero = this._heroPlayer();

        if (!hero) {
            this._pillLabel.text = 'Nothing playing';
            this._pillPrev.hide();
            this._pillPlay.hide();
            this._pillNext.hide();
        } else {
            this._pillLabel.text = hero.title || hero.identity;
            this._pillPrev.show();
            this._pillPlay.show();
            this._pillNext.show();
            const icon = this._pillPlay.get_child();
            icon.icon_name = hero.status === 'Playing'
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic';
        }

        this._popupContent.destroy_all_children();

        if (this._players.length === 0) {
            const empty = new St.Label({
                text: 'Nothing playing. Open Spotify, a browser tab, or VLC.',
                style_class: 'spiller-empty-label',
            });
            this._popupContent.add_child(empty);
            return;
        }

        // --- Hero: the currently-playing (or most relevant) source, big ---
        const heroBox = new St.BoxLayout({vertical: true, style_class: 'spiller-hero'});

        const heroBadge = this._makeBadge(hero, 'spiller-hero-badge');
        heroBadge.x_align = Clutter.ActorAlign.CENTER;
        heroBox.add_child(heroBadge);

        const heroTitle = new St.Label({
            text: hero.title || hero.identity,
            style_class: 'spiller-hero-title',
            x_align: Clutter.ActorAlign.CENTER,
        });
        heroTitle.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        heroBox.add_child(heroTitle);

        const heroSubtitle = new St.Label({
            text: hero.artist ? `${hero.artist} \u00B7 ${hero.identity}` : hero.identity,
            style_class: 'spiller-hero-subtitle',
            x_align: Clutter.ActorAlign.CENTER,
        });
        heroSubtitle.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        heroBox.add_child(heroSubtitle);

        const heroControls = new St.BoxLayout({vertical: false, style_class: 'spiller-hero-controls', x_align: Clutter.ActorAlign.CENTER});
        heroControls.add_child(this._makeIconButton('media-skip-backward-symbolic', () => this._playPauseForPrev(hero.bus_name)));
        heroControls.add_child(this._makeIconButton(
            hero.status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
            () => this._playPauseFor(hero.bus_name)
        ));
        heroControls.add_child(this._makeIconButton('media-skip-forward-symbolic', () => this._nextFor(hero.bus_name)));
        heroBox.add_child(heroControls);

        const heroPinRow = new St.BoxLayout({vertical: false, style_class: 'spiller-hero-pin-row', x_align: Clutter.ActorAlign.CENTER});
        const heroPinBtn = this._makeGlyphButton(
            this._pinnedBusName === hero.bus_name ? '\u2605' : '\u2606',
            'spiller-pin-glyph',
            () => this._togglePin(hero.bus_name)
        );
        const heroPinLabel = new St.Label({
            text: this._pinnedBusName === hero.bus_name ? 'Pinned as hero' : 'Pin as hero',
            style_class: 'spiller-pin-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        heroPinRow.add_child(heroPinBtn);
        heroPinRow.add_child(heroPinLabel);
        heroBox.add_child(heroPinRow);

        this._popupContent.add_child(heroBox);

        // --- Everyone else, as a compact list below ---
        const rest = this._players.filter(p => p.bus_name !== hero.bus_name);
        if (rest.length > 0) {
            const divider = new St.Widget({style_class: 'spiller-divider', x_expand: true});
            this._popupContent.add_child(divider);
        }

        for (const p of rest) {
            const row = new St.BoxLayout({vertical: false, style_class: 'spiller-row'});
            const badge = this._makeBadge(p, 'spiller-row-badge');
            badge.y_align = Clutter.ActorAlign.CENTER;
            const label = new St.Label({
                text: p.title || p.identity,
                style_class: 'spiller-row-label',
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            const playBtn = this._makeIconButton(
                p.status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
                () => this._playPauseFor(p.bus_name)
            );
            const pinBtn = this._makeGlyphButton(
                this._pinnedBusName === p.bus_name ? '\u2605' : '\u2606',
                'spiller-pin-glyph',
                () => this._togglePin(p.bus_name)
            );
            row.add_child(badge);
            row.add_child(label);
            row.add_child(pinBtn);
            row.add_child(playBtn);
            this._popupContent.add_child(row);
        }
    }

    _activeBusName() {
        const hero = this._heroPlayer();
        return hero ? hero.bus_name : null;
    }

    _playPause() {
        this._playPauseFor(this._activeBusName());
    }

    _playPauseFor(busName) {
        if (!busName)
            return;
        callSpiller('PlayPause', new GLib.Variant('(s)', [busName]), null, () => this._refresh());
    }

    _playPauseForPrev(busName) {
        this._prevFor(busName);
    }

    _next() {
        this._nextFor(this._activeBusName());
    }

    _nextFor(busName) {
        if (!busName)
            return;
        callSpiller('Next', new GLib.Variant('(s)', [busName]), null, () => this._refresh());
    }

    _prev() {
        this._prevFor(this._activeBusName());
    }

    _prevFor(busName) {
        if (!busName)
            return;
        callSpiller('Previous', new GLib.Variant('(s)', [busName]), null, () => this._refresh());
    }

    _onDestroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        super._onDestroy();
    }
});

export default class SpillerExtension extends Extension {
    enable() {
        this._indicator = new SpillerIndicator();
        // Added into the status area, right-aligned so it sits near the
        // other system indicators. See README for how to nudge its exact
        // position once you see it against Zorin's actual taskbar layout --
        // the sort order among 'right' box indicators is controlled by the
        // 3rd argument here (lower = further left within that box).
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'center');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
