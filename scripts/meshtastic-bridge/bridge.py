#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""
Meshtastic ↔ Samur API bridge.

Runs on a device (Raspberry Pi / laptop) connected to a Meshtastic LoRa radio.
Relays messages between the mesh network and the Samur flood relief API.

Inbound:  mesh text → parse → POST to API
Outbound: API WebSocket alerts → format → send to mesh
"""

import json
import logging
import os
import sqlite3
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests
import socketio
import yaml

# ─── Configuration ──────────────────────────────────────────────────────────

DEFAULT_CONFIG = {
    "api": {
        "base_url": "http://localhost:3000",
        "api_key": "",
        "timeout": 10,
    },
    "meshtastic": {
        "connection": "serial",  # serial | bluetooth
        "serial_port": "/dev/ttyUSB0",
        "bluetooth_address": "",
        "channel_index": 0,
    },
    "bridge": {
        "broadcast_interval": 1800,  # 30 minutes
        "heartbeat_interval": 120,   # 2 minutes
        "retry_max": 10,
        "retry_base_delay": 5,       # seconds, exponential backoff
        "log_level": "INFO",
    },
    "geo": {
        "dagestan_north": 44.3,
        "dagestan_south": 41.1,
        "dagestan_east": 48.6,
        "dagestan_west": 45.0,
    },
}


def load_config(path: str = "meshtastic-bridge.yaml") -> dict:
    """Load config from YAML, falling back to defaults."""
    config = DEFAULT_CONFIG.copy()
    config_path = Path(path)

    if config_path.exists():
        with open(config_path) as f:
            user = yaml.safe_load(f) or {}
        # Deep merge
        for section in config:
            if section in user and isinstance(user[section], dict):
                config[section] = {**config[section], **user[section]}
    else:
        logging.warning(f"Config file {path} not found, using defaults")

    # Environment overrides
    if os.environ.get("API_BASE_URL"):
        config["api"]["base_url"] = os.environ["API_BASE_URL"]
    if os.environ.get("WEBHOOK_API_KEY"):
        config["api"]["api_key"] = os.environ["WEBHOOK_API_KEY"]
    if os.environ.get("MESHTASTIC_SERIAL_PORT"):
        config["meshtastic"]["serial_port"] = os.environ["MESHTASTIC_SERIAL_PORT"]
    if os.environ.get("MESHTASTIC_CONNECTION"):
        config["meshtastic"]["connection"] = os.environ["MESHTASTIC_CONNECTION"]

    return config


# ─── Local SQLite backup ───────────────────────────────────────────────────

class LocalDB:
    """Local SQLite database for message backup and offline queue."""

    def __init__(self, path: str = "meshtastic-bridge.db"):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        self._init_tables()

    def _init_tables(self):
        with self.lock:
            self.conn.executescript("""
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    direction TEXT NOT NULL,  -- 'inbound' | 'outbound'
                    node_id TEXT,
                    raw_message TEXT NOT NULL,
                    parsed_action TEXT,
                    api_response TEXT,
                    lat REAL,
                    lng REAL
                );

                CREATE TABLE IF NOT EXISTS offline_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    method TEXT NOT NULL,
                    path TEXT NOT NULL,
                    body TEXT NOT NULL,
                    retries INTEGER DEFAULT 0,
                    last_error TEXT
                );
            """)
            self.conn.commit()

    def log_message(
        self,
        direction: str,
        node_id: str,
        raw_message: str,
        parsed_action: str = "",
        api_response: str = "",
        lat: Optional[float] = None,
        lng: Optional[float] = None,
    ):
        with self.lock:
            self.conn.execute(
                """INSERT INTO messages
                   (timestamp, direction, node_id, raw_message, parsed_action, api_response, lat, lng)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    datetime.now(timezone.utc).isoformat(),
                    direction,
                    node_id,
                    raw_message,
                    parsed_action,
                    api_response,
                    lat,
                    lng,
                ),
            )
            self.conn.commit()

    def enqueue(self, method: str, path: str, body: dict):
        with self.lock:
            self.conn.execute(
                """INSERT INTO offline_queue (created_at, method, path, body)
                   VALUES (?, ?, ?, ?)""",
                (datetime.now(timezone.utc).isoformat(), method, path, json.dumps(body)),
            )
            self.conn.commit()

    def get_queue(self) -> list[tuple]:
        with self.lock:
            cur = self.conn.execute(
                "SELECT id, method, path, body, retries FROM offline_queue ORDER BY id"
            )
            return cur.fetchall()

    def update_queue_retry(self, queue_id: int, retries: int, error: str):
        with self.lock:
            self.conn.execute(
                "UPDATE offline_queue SET retries = ?, last_error = ? WHERE id = ?",
                (retries, error, queue_id),
            )
            self.conn.commit()

    def remove_from_queue(self, queue_id: int):
        with self.lock:
            self.conn.execute("DELETE FROM offline_queue WHERE id = ?", (queue_id,))
            self.conn.commit()


# ─── API Client ─────────────────────────────────────────────────────────────

class ApiClient:
    """HTTP client for the Samur API."""

    def __init__(self, config: dict, db: LocalDB):
        self.base_url = config["api"]["base_url"].rstrip("/")
        self.api_key = config["api"]["api_key"]
        self.timeout = config["api"]["timeout"]
        self.retry_max = config["bridge"]["retry_max"]
        self.retry_base_delay = config["bridge"]["retry_base_delay"]
        self.db = db
        self.log = logging.getLogger("api")

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["X-API-Key"] = self.api_key
        return h

    def post(self, path: str, body: dict) -> Optional[dict]:
        """POST to API. On failure, enqueue for retry."""
        url = f"{self.base_url}{path}"
        try:
            resp = requests.post(
                url, json=body, headers=self._headers(), timeout=self.timeout
            )
            resp.raise_for_status()
            data = resp.json()
            self.log.info(f"POST {path} → {resp.status_code}")
            return data
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response else 0
            # 4xx = permanent failure, don't retry
            if 400 <= status < 500:
                self.log.error(f"POST {path} → {status} (permanent): {e}")
                return None
            self.log.warning(f"POST {path} → {status}, queuing for retry")
            self.db.enqueue("POST", path, body)
            return None
        except requests.exceptions.RequestException as e:
            self.log.warning(f"POST {path} failed: {e}, queuing for retry")
            self.db.enqueue("POST", path, body)
            return None

    def get(self, path: str) -> Optional[dict]:
        """GET from API."""
        url = f"{self.base_url}{path}"
        try:
            resp = requests.get(url, headers=self._headers(), timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.RequestException as e:
            self.log.warning(f"GET {path} failed: {e}")
            return None

    def process_queue(self):
        """Process offline queue with exponential backoff."""
        items = self.db.get_queue()
        if not items:
            return

        self.log.info(f"Processing {len(items)} queued items")

        for queue_id, method, path, body_json, retries in items:
            if retries >= self.retry_max:
                self.log.error(f"Queue item {queue_id} exceeded max retries, dropping")
                self.db.remove_from_queue(queue_id)
                continue

            url = f"{self.base_url}{path}"
            body = json.loads(body_json)

            try:
                if method == "POST":
                    resp = requests.post(
                        url, json=body, headers=self._headers(), timeout=self.timeout
                    )
                else:
                    resp = requests.get(
                        url, headers=self._headers(), timeout=self.timeout
                    )
                resp.raise_for_status()
                self.log.info(f"Queue item {queue_id} succeeded")
                self.db.remove_from_queue(queue_id)
            except requests.exceptions.RequestException as e:
                delay = self.retry_base_delay * (2 ** retries)
                self.log.warning(
                    f"Queue item {queue_id} retry {retries + 1} failed: {e}, "
                    f"next retry in {delay}s"
                )
                self.db.update_queue_retry(queue_id, retries + 1, str(e))
                time.sleep(min(delay, 300))  # cap at 5 min


# ─── Message Parser ─────────────────────────────────────────────────────────

# Dagestan coordinate bounds (loaded from config)
BOUNDS = {}


def init_bounds(config: dict):
    global BOUNDS
    BOUNDS = config["geo"]


def is_in_dagestan(lat: float, lng: float) -> bool:
    """Check if coordinates are within Dagestan bounds."""
    return (
        BOUNDS["dagestan_south"] <= lat <= BOUNDS["dagestan_north"]
        and BOUNDS["dagestan_west"] <= lng <= BOUNDS["dagestan_east"]
    )


def parse_mesh_message(text: str) -> dict:
    """
    Parse a Meshtastic text message into an API action.

    Formats:
      SOS [description]              → critical help request (rescue)
      HELP [category] [description]  → help request
      LEVEL [river] [cm]             → river level report
      OK [request_id_prefix]         → mark help request completed
      FLOOD [description]            → flood incident
      anything else                  → medium-severity incident
    """
    trimmed = text.strip()
    upper = trimmed.upper()

    if upper.startswith("SOS"):
        desc = trimmed[3:].strip() or "SOS via mesh"
        return {
            "action": "help_request",
            "body": {
                "node_id": "",  # filled by caller
                "message": f"SOS {desc}",
            },
        }

    if upper.startswith("HELP") or upper.startswith("ПОМОЩЬ"):
        prefix_len = 4 if upper.startswith("HELP") else len("ПОМОЩЬ")
        desc = trimmed[prefix_len:].strip() or "Help request via mesh"
        return {
            "action": "help_request",
            "body": {
                "node_id": "",
                "message": f"HELP {desc}",
            },
        }

    if upper.startswith("LEVEL") or upper.startswith("УРОВЕНЬ"):
        prefix_len = 5 if upper.startswith("LEVEL") else len("УРОВЕНЬ")
        rest = trimmed[prefix_len:].strip()
        return {
            "action": "river_level",
            "body": {
                "node_id": "",
                "message": f"LEVEL {rest}",
            },
        }

    if upper.startswith("OK "):
        id_prefix = trimmed[3:].strip()
        return {
            "action": "status_update",
            "body": {
                "node_id": "",
                "message": f"OK {id_prefix}",
            },
        }

    if upper.startswith("FLOOD") or upper.startswith("ПОТОП") or upper.startswith("ВОДА"):
        prefix_len = (
            5 if upper.startswith("FLOOD")
            else 5 if upper.startswith("ПОТОП")
            else 4
        )
        desc = trimmed[prefix_len:].strip() or "Flood report via mesh"
        return {
            "action": "incident",
            "body": {
                "node_id": "",
                "message": f"FLOOD {desc}",
            },
        }

    # Default: generic incident
    return {
        "action": "incident",
        "body": {
            "node_id": "",
            "message": trimmed,
        },
    }


# ─── Inbound Handler (mesh → API) ──────────────────────────────────────────

class InboundHandler:
    """Processes incoming Meshtastic messages and forwards to API."""

    def __init__(self, api: ApiClient, db: LocalDB):
        self.api = api
        self.db = db
        self.log = logging.getLogger("inbound")

    def handle_message(self, node_id: str, text: str, lat: Optional[float], lng: Optional[float]):
        """Handle an incoming text message from the mesh."""
        self.log.info(f"[{node_id}] Received: {text[:100]}")

        # Validate GPS if present
        if lat is not None and lng is not None:
            if not is_in_dagestan(lat, lng):
                self.log.warning(
                    f"[{node_id}] GPS outside Dagestan ({lat}, {lng}), ignoring coordinates"
                )
                lat, lng = None, None

        parsed = parse_mesh_message(text)

        # Build the webhook payload
        body = {
            "node_id": node_id,
            "message": parsed["body"]["message"],
        }
        if lat is not None and lng is not None:
            body["lat"] = lat
            body["lng"] = lng

        result = self.api.post("/api/v1/webhook/meshtastic", body)

        # Log to local DB
        self.db.log_message(
            direction="inbound",
            node_id=node_id,
            raw_message=text,
            parsed_action=parsed["action"],
            api_response=json.dumps(result) if result else "queued",
            lat=lat,
            lng=lng,
        )

        # Return reply text for mesh response (if any)
        if result and "data" in result and "reply" in result["data"]:
            return result["data"]["reply"]
        return None


# ─── Outbound Handler (API → mesh) ─────────────────────────────────────────

class OutboundHandler:
    """Listens for API events and broadcasts to mesh."""

    def __init__(self, api: ApiClient, db: LocalDB, config: dict, send_fn):
        self.api = api
        self.db = db
        self.config = config
        self.send_fn = send_fn  # function to send text to mesh
        self.log = logging.getLogger("outbound")
        self.sio = socketio.Client(
            reconnection=True,
            reconnection_delay=5,
            reconnection_delay_max=60,
        )
        self._setup_socket()

    def _setup_socket(self):
        @self.sio.on("connect")
        def on_connect():
            self.log.info("Connected to API WebSocket")

        @self.sio.on("disconnect")
        def on_disconnect():
            self.log.warning("Disconnected from API WebSocket")

        @self.sio.on("alert:broadcast")
        def on_alert(data):
            self.log.info(f"Alert broadcast: {data.get('title', 'unknown')}")

            channels = data.get("channels", [])
            if "meshtastic" not in channels:
                self.log.debug("Alert not targeted at meshtastic, skipping")
                return

            urgency = data.get("urgency", "info")
            title = data.get("title", "")
            body = data.get("body", "")

            # Format for mesh (max ~228 bytes)
            prefix = "!!!" if urgency == "critical" else "!" if urgency == "warning" else "i"
            text = f"[{prefix}] {title}: {body}"
            # Truncate to 220 bytes for safety
            encoded = text.encode("utf-8")
            if len(encoded) > 220:
                text = encoded[:217].decode("utf-8", errors="ignore") + "..."

            self.send_fn(text)
            self.db.log_message(
                direction="outbound",
                node_id="broadcast",
                raw_message=text,
                parsed_action="alert",
            )

    def connect(self):
        """Connect to the API WebSocket."""
        ws_url = self.config["api"]["base_url"]
        try:
            self.sio.connect(ws_url, transports=["websocket", "polling"])
        except Exception as e:
            self.log.error(f"WebSocket connection failed: {e}")

    def disconnect(self):
        if self.sio.connected:
            self.sio.disconnect()

    def broadcast_river_levels(self):
        """Periodically broadcast latest river levels to mesh."""
        result = self.api.get("/api/v1/river-levels?latest=true&limit=5")
        if not result or "data" not in result:
            return

        levels = result["data"]
        if not levels:
            return

        trend_arrows = {"rising": "↑", "stable": "→", "falling": "↓"}
        parts = []
        for lvl in levels:
            arrow = trend_arrows.get(lvl.get("trend", ""), "")
            parts.append(f"{lvl['riverName']}:{lvl['levelCm']}см{arrow}")

        text = f"РЕКИ {' '.join(parts)}"
        encoded = text.encode("utf-8")
        if len(encoded) > 220:
            text = encoded[:217].decode("utf-8", errors="ignore") + "..."

        self.send_fn(text)
        self.db.log_message(
            direction="outbound",
            node_id="broadcast",
            raw_message=text,
            parsed_action="river_levels",
        )
        self.log.info(f"Broadcast river levels: {text}")


# ─── Heartbeat ──────────────────────────────────────────────────────────────

class Heartbeat:
    """Periodic heartbeat to let coordinators know the bridge is online."""

    def __init__(self, api: ApiClient, config: dict, interface):
        self.api = api
        self.config = config
        self.interface = interface
        self.log = logging.getLogger("heartbeat")

    def send(self):
        """Send heartbeat to API."""
        body: dict[str, Any] = {"node_id": "bridge"}

        # Try to get radio info
        try:
            if self.interface and hasattr(self.interface, "myInfo"):
                info = self.interface.myInfo
                if info:
                    body["battery_level"] = getattr(info, "battery_level", None)
                    body["channel_utilization"] = getattr(
                        info, "channel_utilization", None
                    )
        except Exception:
            pass

        result = self.api.post("/api/v1/webhook/meshtastic/heartbeat", body)
        if result:
            self.log.debug("Heartbeat sent")
        else:
            self.log.warning("Heartbeat failed")


# ─── Main Bridge ────────────────────────────────────────────────────────────

class MeshtasticBridge:
    """Main bridge: connects Meshtastic radio to Samur API."""

    def __init__(self, config_path: str = "meshtastic-bridge.yaml"):
        self.config = load_config(config_path)
        init_bounds(self.config)

        log_level = getattr(logging, self.config["bridge"]["log_level"].upper(), logging.INFO)
        logging.basicConfig(
            level=log_level,
            format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        self.log = logging.getLogger("bridge")

        self.db = LocalDB()
        self.api = ApiClient(self.config, self.db)
        self.inbound = InboundHandler(self.api, self.db)
        self.interface = None
        self.outbound = None
        self.heartbeat_obj = None
        self._running = False

    def _connect_meshtastic(self):
        """Connect to the Meshtastic radio."""
        import meshtastic
        import meshtastic.serial_interface
        import meshtastic.tcp_interface

        conn_type = self.config["meshtastic"]["connection"]

        if conn_type == "serial":
            port = self.config["meshtastic"]["serial_port"]
            self.log.info(f"Connecting to Meshtastic via serial: {port}")
            self.interface = meshtastic.serial_interface.SerialInterface(port)
        elif conn_type == "bluetooth":
            addr = self.config["meshtastic"]["bluetooth_address"]
            self.log.info(f"Connecting to Meshtastic via Bluetooth: {addr}")
            # BLE interface
            import meshtastic.ble_interface
            self.interface = meshtastic.ble_interface.BLEInterface(addr)
        elif conn_type == "tcp":
            host = self.config["meshtastic"].get("tcp_host", "localhost")
            self.log.info(f"Connecting to Meshtastic via TCP: {host}")
            self.interface = meshtastic.tcp_interface.TCPInterface(host)
        else:
            raise ValueError(f"Unknown connection type: {conn_type}")

        self.log.info("Meshtastic radio connected")

    def _send_to_mesh(self, text: str):
        """Send a text message to the configured mesh channel."""
        if not self.interface:
            self.log.error("Cannot send: no Meshtastic interface")
            return

        channel_index = self.config["meshtastic"]["channel_index"]
        try:
            self.interface.sendText(text, channelIndex=channel_index)
            self.log.info(f"Sent to mesh (ch{channel_index}): {text[:80]}")
        except Exception as e:
            self.log.error(f"Failed to send to mesh: {e}")

    def _on_receive(self, packet, interface):
        """Callback for incoming Meshtastic packets."""
        try:
            decoded = packet.get("decoded", {})
            portnum = decoded.get("portnum", "")

            # Only handle TEXT_MESSAGE_APP
            if portnum != "TEXT_MESSAGE_APP":
                return

            text = decoded.get("text", "")
            if not text:
                return

            node_id = packet.get("fromId", packet.get("from", "unknown"))

            # Extract GPS from position if available
            lat = None
            lng = None
            position = packet.get("position", {})
            if position:
                lat = position.get("latitude") or position.get("latitudeI")
                lng = position.get("longitude") or position.get("longitudeI")
                # latitudeI/longitudeI are in 1e-7 degrees
                if lat and abs(lat) > 90:
                    lat = lat / 1e7
                if lng and abs(lng) > 180:
                    lng = lng / 1e7

            reply = self.inbound.handle_message(node_id, text, lat, lng)

            # Send reply back to mesh if available
            if reply:
                self._send_to_mesh(reply)

        except Exception as e:
            self.log.error(f"Error handling packet: {e}", exc_info=True)

    def _queue_processor_loop(self):
        """Background thread: process offline queue periodically."""
        while self._running:
            try:
                self.api.process_queue()
            except Exception as e:
                self.log.error(f"Queue processor error: {e}")
            time.sleep(30)

    def _broadcast_loop(self):
        """Background thread: periodic river level broadcasts."""
        interval = self.config["bridge"]["broadcast_interval"]
        while self._running:
            time.sleep(interval)
            if not self._running:
                break
            try:
                self.outbound.broadcast_river_levels()
            except Exception as e:
                self.log.error(f"Broadcast error: {e}")

    def _heartbeat_loop(self):
        """Background thread: periodic heartbeat."""
        interval = self.config["bridge"]["heartbeat_interval"]
        while self._running:
            try:
                self.heartbeat_obj.send()
            except Exception as e:
                self.log.error(f"Heartbeat error: {e}")
            time.sleep(interval)

    def run(self):
        """Start the bridge."""
        self.log.info("Starting Meshtastic bridge...")
        self._running = True

        # Connect to radio
        try:
            self._connect_meshtastic()
        except Exception as e:
            self.log.error(f"Failed to connect to Meshtastic: {e}")
            self.log.info("Running in API-only mode (no radio)")

        # Set up outbound (WebSocket listener)
        self.outbound = OutboundHandler(
            self.api, self.db, self.config, self._send_to_mesh
        )

        # Set up heartbeat
        self.heartbeat_obj = Heartbeat(self.api, self.config, self.interface)

        # Register message callback
        if self.interface:
            from pubsub import pub
            pub.subscribe(self._on_receive, "meshtastic.receive")
            self.log.info("Listening for Meshtastic messages")

        # Start background threads
        threads = [
            threading.Thread(target=self._queue_processor_loop, daemon=True, name="queue"),
            threading.Thread(target=self._broadcast_loop, daemon=True, name="broadcast"),
            threading.Thread(target=self._heartbeat_loop, daemon=True, name="heartbeat"),
        ]
        for t in threads:
            t.start()

        # Connect outbound WebSocket
        self.outbound.connect()

        self.log.info("Bridge is running. Press Ctrl+C to stop.")

        try:
            while self._running:
                time.sleep(1)
        except KeyboardInterrupt:
            self.log.info("Shutting down...")
        finally:
            self._running = False
            self.outbound.disconnect()
            if self.interface:
                self.interface.close()
            self.log.info("Bridge stopped")


# ─── Entry point ────────────────────────────────────────────────────────────

def main():
    config_path = sys.argv[1] if len(sys.argv) > 1 else "meshtastic-bridge.yaml"
    bridge = MeshtasticBridge(config_path)
    bridge.run()


if __name__ == "__main__":
    main()
