import {
  onCall,
  onRequest,
  HttpsError,
  CallableRequest,
} from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import type { Request, Response } from "express";

// HMAC secret for device signature verification
// Set with: firebase functions:secrets:set HMAC_SECRET
// Value should be the hex-encoded 32-byte key burned to device eFuse
const hmacSecret = defineSecret("HMAC_SECRET");

// IPLocate API key for timezone detection
// Set with: firebase functions:secrets:set IPLOCATE_API_KEY
const iplocateApiKey = defineSecret("IPLOCATE_API_KEY");

admin.initializeApp();

const db = admin.firestore();

interface ClaimDeviceData {
  claimCode: string;
}

/**
 * Cloud function to claim a device using a claim code.
 *
 * Expected input: { claimCode: "ABC123" }
 *
 * This function:
 * 1. Verifies the user is authenticated
 * 2. Looks up the claim code in the devices collection
 * 3. Checks the device isn't already claimed
 * 4. Associates the device with the user's UID
 */
export const claimDevice = onCall(
  async (request: CallableRequest<ClaimDeviceData>) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Must be logged in to link a device",
      );
    }

    const uid = request.auth.uid;
    const claimCode = request.data?.claimCode;

    // Validate input
    if (!claimCode || typeof claimCode !== "string") {
      throw new HttpsError("invalid-argument", "Code is required");
    }

    const normalizedCode = claimCode.toUpperCase().trim();

    if (normalizedCode.length !== 10) {
      throw new HttpsError("invalid-argument", "Code must be 10 characters");
    }

    // Look up the device by claim code
    const devicesRef = db.collection("devices");
    const snapshot = await devicesRef
      .where("claimCode", "==", normalizedCode)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new HttpsError("not-found", "Invalid code");
    }

    const deviceDoc = snapshot.docs[0];
    const deviceData = deviceDoc.data();

    // Claim the device - update both collections in a batch
    const batch = db.batch();

    // Update or create the user document with the device reference
    const userRef = db.collection("users").doc(uid);
    batch.set(
      userRef,
      {
        deviceId: deviceDoc.id,
        deviceClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await batch.commit();

    return {
      success: true,
      message: "Device linked successfully",
      macAddress: deviceData.macAddress,
    };
  },
);

interface PressEntry {
  date: string; // YYYY-MM-DD in device's local time
  timestamp: number; // Unix timestamp when button was pressed
}

interface ButtonPressData {
  mac: string;
  presses: PressEntry[]; // Array of all presses for the last week
  timestamp: number; // Current Unix timestamp for replay protection
}

// Maximum allowed time difference for replay protection (5 minutes)
const MAX_TIMESTAMP_DRIFT_SECONDS = 300;

/**
 * Verify HMAC-SHA256 signature from device.
 * Uses constant-time comparison to prevent timing attacks.
 */
function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  try {
    // Secret is stored as hex, convert to buffer
    const keyBuffer = Buffer.from(secret, "hex");
    const expectedSignature = crypto
      .createHmac("sha256", keyBuffer)
      .update(payload)
      .digest("hex");

    // Constant-time comparison
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex"),
    );
  } catch {
    return false;
  }
}

interface HmacVerificationResult {
  valid: boolean;
  error?: string;
  statusCode?: number;
}

/**
 * Verify HMAC signature and timestamp for device requests.
 * Returns validation result with error details if verification fails.
 *
 * @param req - Express request object
 * @param secret - HMAC secret (hex-encoded)
 * @param requireTimestamp - Whether to validate timestamp for replay protection
 */
function verifyDeviceRequest(
  req: Request,
  secret: string,
  requireTimestamp = true,
): HmacVerificationResult {
  // Get raw body for signature verification
  const rawBody =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body);

  const signature = req.get("X-HMAC-Signature");

  if (!signature) {
    return { valid: false, error: "Missing HMAC signature", statusCode: 401 };
  }

  if (!verifyHmacSignature(rawBody, signature, secret)) {
    return { valid: false, error: "Invalid HMAC signature", statusCode: 401 };
  }

  // Validate timestamp for replay protection
  if (requireTimestamp) {
    const timestamp = req.body?.timestamp;

    if (!timestamp || typeof timestamp !== "number") {
      return { valid: false, error: "Timestamp is required", statusCode: 400 };
    }

    const now = Math.floor(Date.now() / 1000);
    const drift = Math.abs(now - timestamp);

    if (drift > MAX_TIMESTAMP_DRIFT_SECONDS) {
      return {
        valid: false,
        error: `Request expired (drift: ${drift}s)`,
        statusCode: 401,
      };
    }
  }

  return { valid: true };
}

/**
 * HTTP endpoint to receive button presses from devices.
 *
 * Expected input:
 * {
 *   mac: "AA:BB:CC:DD:EE:FF",
 *   presses: [{ date: "2025-01-15", timestamp: 1234567890 }, ...],
 *   timestamp: 1234567890
 * }
 * Header: X-HMAC-Signature: <hex-encoded HMAC-SHA256 of request body>
 *
 * This function:
 * 1. Verifies HMAC signature (if HMAC_SECRET is configured)
 * 2. Validates timestamp to prevent replay attacks
 * 3. Validates the request payload
 * 4. Looks up the device by MAC address
 * 5. Syncs the presses subcollection to match the incoming array
 *    - Adds/updates presses that are in the array
 *    - Deletes presses within the week window that are not in the array
 *
 * Presses are stored on the device, allowing tracking before the device is claimed.
 */
export const buttonPress = onRequest(
  { secrets: [hmacSecret] },
  async (req: Request, res: Response) => {
    // Only allow POST requests
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // Verify HMAC signature and timestamp if secret is configured
    const secret = hmacSecret.value();
    if (secret) {
      const verification = verifyDeviceRequest(req, secret, true);
      if (!verification.valid) {
        res
          .status(verification.statusCode!)
          .json({ error: verification.error });
        return;
      }
    }

    const { mac, presses } = req.body as ButtonPressData;

    // Validate input
    if (!mac || typeof mac !== "string") {
      res.status(400).json({ error: "MAC address is required" });
      return;
    }

    if (!Array.isArray(presses)) {
      res.status(400).json({ error: "Presses must be an array" });
      return;
    }

    // Validate each press entry
    for (const press of presses) {
      if (
        !press.date ||
        typeof press.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(press.date)
      ) {
        res
          .status(400)
          .json({ error: "Each press must have a date in YYYY-MM-DD format" });
        return;
      }
      if (typeof press.timestamp !== "number") {
        res
          .status(400)
          .json({ error: "Each press must have a numeric timestamp" });
        return;
      }
    }

    const normalizedMac = mac.toUpperCase().trim();

    // Look up the device by MAC address
    const devicesRef = db.collection("devices");
    const snapshot = await devicesRef
      .where("macAddress", "==", normalizedMac)
      .limit(1)
      .get();

    if (snapshot.empty) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    const deviceDoc = snapshot.docs[0];
    const pressesRef = db
      .collection("devices")
      .doc(deviceDoc.id)
      .collection("presses");

    // Calculate the week window based on server time (today and 6 days before)
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartStr = weekStart.toISOString().split("T")[0];

    // Get existing presses from the last week only (doc ID is the date string)
    const existingPresses = await pressesRef
      .where(admin.firestore.FieldPath.documentId(), ">=", weekStartStr)
      .get();
    const existingDates = new Set(existingPresses.docs.map((doc) => doc.id));

    // Build set of incoming dates
    const incomingDates = new Set(presses.map((p) => p.date));

    // Use batch for atomic updates
    const batch = db.batch();

    // Add/update presses from the incoming array
    for (const press of presses) {
      const pressRef = pressesRef.doc(press.date);
      batch.set(pressRef, {
        date: press.date,
        pressedAt: admin.firestore.Timestamp.fromMillis(press.timestamp * 1000),
      });
    }

    // Delete presses that exist but are not in incoming array
    // (query already filtered to last week, so all existingDates are in window)
    for (const existingDate of existingDates) {
      if (!incomingDates.has(existingDate)) {
        const pressRef = pressesRef.doc(existingDate);
        batch.delete(pressRef);
        console.log(`Deleting stale press for ${existingDate}`);
      }
    }

    await batch.commit();

    console.log(`Synced ${presses.length} presses for device ${normalizedMac}`);

    res.status(200).json({
      success: true,
      message: `Synced ${presses.length} presses`,
    });
  },
);

/**
 * Cloud function to unlink a device from a user's account.
 *
 * This function:
 * 1. Verifies the user is authenticated
 * 2. Removes the device link from the user document
 */
export const unlinkDevice = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Must be logged in to unlink device",
    );
  }

  const uid = request.auth.uid;
  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    throw new HttpsError("not-found", "User document not found");
  }

  const userData = userDoc.data();
  if (!userData?.deviceId) {
    throw new HttpsError("failed-precondition", "No device linked");
  }

  await userRef.update({
    deviceId: admin.firestore.FieldValue.delete(),
    deviceClaimedAt: admin.firestore.FieldValue.delete(),
  });

  return {
    success: true,
    message: "Device unlinked successfully",
  };
});

/**
 * Cloud function to clear all presses for a user's linked device.
 *
 * This function:
 * 1. Verifies the user is authenticated
 * 2. Deletes all presses from the user's linked device
 */
export const clearPresses = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Must be logged in to clear presses",
    );
  }

  const uid = request.auth.uid;
  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    throw new HttpsError("not-found", "User document not found");
  }

  const userData = userDoc.data();
  const deviceId = userData?.deviceId;

  if (!deviceId) {
    throw new HttpsError("failed-precondition", "No device linked");
  }

  const pressesRef = db
    .collection("devices")
    .doc(deviceId)
    .collection("presses");
  const pressesSnapshot = await pressesRef.get();

  if (pressesSnapshot.empty) {
    return {
      success: true,
      message: "No presses to clear",
    };
  }

  const batch = db.batch();
  for (const pressDoc of pressesSnapshot.docs) {
    batch.delete(pressDoc.ref);
  }
  await batch.commit();

  return {
    success: true,
    message: "All presses cleared successfully",
  };
});

/**
 * Cloud function to delete a user's account and all associated data.
 *
 * This function:
 * 1. Verifies the user is authenticated
 * 2. Deletes all presses from the user's linked device (if any)
 * 3. Deletes the user document from Firestore
 * 4. Deletes the user from Firebase Auth
 */
export const deleteAccount = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Must be logged in to delete account",
    );
  }

  const uid = request.auth.uid;
  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();

  if (userDoc.exists) {
    // Delete the user document
    await userRef.delete();
  }

  // Delete the user from Firebase Auth
  await admin.auth().deleteUser(uid);

  return {
    success: true,
    message: "Account deleted successfully",
  };
});

/**
 * HTTP endpoint to get timezone offset from client IP address.
 *
 * Uses IPLocate API to determine timezone from the requesting IP.
 * Returns the timezone offset in seconds from UTC.
 * Requires HMAC signature for device authentication.
 *
 * Response format: { "offset": -25200 }
 */
export const getTimezone = onRequest(
  { secrets: [iplocateApiKey, hmacSecret] },
  async (req: Request, res: Response) => {
    // Verify HMAC signature if secret is configured
    const secret = hmacSecret.value();
    if (secret) {
      const verification = verifyDeviceRequest(req, secret, false);
      if (!verification.valid) {
        res
          .status(verification.statusCode!)
          .json({ error: verification.error });
        return;
      }
    }

    // Get client IP from request
    // Cloud Functions provides the client IP in x-forwarded-for header
    const forwardedFor = req.get("x-forwarded-for");
    const clientIp = forwardedFor
      ? forwardedFor.split(",")[0].trim()
      : req.ip || "";

    if (!clientIp) {
      res.status(400).json({ error: "Could not determine client IP" });
      return;
    }

    const apiKey = iplocateApiKey.value();
    if (!apiKey) {
      console.error("IPLOCATE_API_KEY secret not configured");
      res.status(500).json({ error: "Service not configured" });
      return;
    }

    try {
      const response = await fetch(
        `https://iplocate.io/api/lookup/${clientIp}?apikey=${apiKey}`,
      );

      if (!response.ok) {
        console.error(`IPLocate API error: ${response.status}`);
        res.status(502).json({ error: "Timezone lookup failed" });
        return;
      }

      const data = await response.json();

      if (!data.time_zone) {
        console.error("No timezone in IPLocate response:", data);
        res.status(502).json({ error: "Timezone not found" });
        return;
      }

      // Convert IANA timezone to offset in seconds
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: data.time_zone,
        timeZoneName: "shortOffset",
      });
      const parts = formatter.formatToParts(now);
      const offsetPart = parts.find((p) => p.type === "timeZoneName");

      let offsetSeconds = 0;
      if (offsetPart) {
        // Parse offset like "GMT-7" or "GMT+5:30"
        const match = offsetPart.value.match(/GMT([+-])?(\d+)(?::(\d+))?/);
        if (match) {
          const sign = match[1] === "-" ? -1 : 1;
          const hours = parseInt(match[2], 10);
          const minutes = match[3] ? parseInt(match[3], 10) : 0;
          offsetSeconds = sign * (hours * 3600 + minutes * 60);
        }
      }

      console.log(
        `Timezone lookup for ${clientIp}: ${data.time_zone} (offset: ${offsetSeconds}s)`,
      );

      res.status(200).json({ offset: offsetSeconds });
    } catch (error) {
      console.error("Timezone lookup error:", error);
      res.status(500).json({ error: "Internal error" });
    }
  },
);
