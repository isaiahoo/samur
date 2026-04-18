// SPDX-License-Identifier: AGPL-3.0-only
import { getIO, helpRoom, userRoom } from "../socket.js";
import { calculateDistance } from "@samur/shared";
import type {
  Incident,
  HelpRequest,
  HelpRequestParty,
  HelpRequestStatus,
  HelpResponseStatus,
  HelpMessage,
  Alert,
  RiverLevel,
  Shelter,
  EarthquakeEvent,
  ServerToClientEvents,
} from "@samur/shared";

interface GeoItem {
  lat: number;
  lng: number;
}

type EventName = keyof ServerToClientEvents;

/**
 * Emit a Socket.IO event to all connected clients whose subscription area
 * includes the item's coordinates. Clients without a geo subscription get all events.
 */
function emitToNearby<K extends EventName>(
  event: K,
  item: GeoItem & Parameters<ServerToClientEvents[K]>[0]
): void {
  const io = getIO();
  const sockets = io.sockets.sockets;

  for (const [, socket] of sockets) {
    const sub = (socket as unknown as { geoSub?: { lat: number; lng: number; radius: number } }).geoSub;
    if (!sub) {
      (socket.emit as (ev: string, ...args: unknown[]) => void)(event, item);
      continue;
    }

    const distKm = calculateDistance(sub.lat, sub.lng, item.lat, item.lng);
    const distM = distKm * 1000;
    if (distM <= sub.radius) {
      (socket.emit as (ev: string, ...args: unknown[]) => void)(event, item);
    }
  }
}

export function emitIncidentCreated(incident: Incident): void {
  emitToNearby("incident:created", incident);
}

export function emitIncidentUpdated(incident: Incident): void {
  emitToNearby("incident:updated", incident);
}

export function emitHelpRequestCreated(request: HelpRequest): void {
  emitToNearby("help_request:created", request);
}

export function emitHelpRequestUpdated(request: HelpRequest): void {
  emitToNearby("help_request:updated", request);
}

export function emitHelpRequestClaimed(request: HelpRequest): void {
  emitToNearby("help_request:claimed", request);
}

export function emitSOSCreated(request: HelpRequest): void {
  getIO().emit("sos:created", request);
}

/**
 * Deliver an in-app chat message. The full payload (body, photo URLs,
 * author) is emitted only to sockets inside the help-request room —
 * i.e. participants who are actively viewing this chat. In parallel we
 * emit a lightweight `help_message:notify` to every listed participant's
 * user-room so their Layout can bump unread counters without needing to
 * receive the message body.
 *
 * Callers must pass the authoritative participant list (request author
 * + non-cancelled responder user IDs). Moderation-only viewers
 * (coordinator/admin) are excluded from the notify fan-out by design —
 * they opt into a chat by subscribing to the room, not by being paged.
 */
export function emitHelpMessageCreated(
  message: HelpMessage,
  participantIds: string[],
): void {
  const io = getIO();
  io.to(helpRoom(message.helpRequestId)).emit("help_message:created", message);
  const notify = { helpRequestId: message.helpRequestId, authorId: message.authorId };
  for (const uid of participantIds) {
    io.to(userRoom(uid)).emit("help_message:notify", notify);
  }
}

/** Emitted to every socket currently in the help-request room. Payload
 * only identifies which message to hide — no body, no author. Clients
 * swap the rendered message to a "[Сообщение удалено]" placeholder. */
export function emitHelpMessageDeleted(helpRequestId: string, messageId: string): void {
  getIO().to(helpRoom(helpRequestId)).emit("help_message:deleted", {
    helpRequestId,
    messageId,
  });
}

export function emitHelpResponseChanged(payload: {
  helpRequestId: string;
  responseId: string;
  status: HelpResponseStatus;
  user: HelpRequestParty;
  responseCount: number;
  derivedStatus: HelpRequestStatus;
}): void {
  getIO().emit("help_response:changed", payload);
}

export function emitAlertBroadcast(alert: Alert): void {
  getIO().emit("alert:broadcast", alert);
}

export function emitRiverLevelUpdated(level: RiverLevel): void {
  emitToNearby("river_level:updated", level);
}

export function emitShelterUpdated(shelter: Shelter): void {
  emitToNearby("shelter:updated", shelter);
}

export function emitEarthquakeNew(earthquake: EarthquakeEvent): void {
  // M5.0+ broadcast to all; M4.5-4.9 geo-filtered
  if (earthquake.magnitude >= 5.0) {
    getIO().emit("earthquake:new", earthquake);
  } else {
    emitToNearby("earthquake:new", earthquake);
  }
}
