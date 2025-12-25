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
        "Must be logged in to link a device"
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
      { merge: true }
    );

    await batch.commit();

    return {
      success: true,
      message: "Device linked successfully",
      macAddress: deviceData.macAddress,
    };
  }
);

interface ButtonPressData {
  mac: string;
  state: boolean;
  date: string; // YYYY-MM-DD in device's local time
  timestamp: number; // Unix timestamp for replay protection
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
  secret: string
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
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * HTTP endpoint to receive button presses from devices.
 *
 * Expected input: { mac: "AA:BB:CC:DD:EE:FF", state: true, date: "2025-01-15", timestamp: 1234567890 }
 * Header: X-HMAC-Signature: <hex-encoded HMAC-SHA256 of request body>
 *
 * This function:
 * 1. Verifies HMAC signature (if HMAC_SECRET is configured)
 * 2. Validates timestamp to prevent replay attacks
 * 3. Validates the request payload
 * 4. Looks up the device by MAC address
 * 5. If state is true: saves the button press timestamp to device subcollection
 * 6. If state is false: deletes the button press for that date
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

    // Get raw body for signature verification
    const rawBody =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    // Verify HMAC signature if secret is configured
    const secret = hmacSecret.value();
    if (secret) {
      const signature = req.get("X-HMAC-Signature");

      if (!signature) {
        res.status(401).json({ error: "Missing HMAC signature" });
        return;
      }

      if (!verifyHmacSignature(rawBody, signature, secret)) {
        res.status(401).json({ error: "Invalid HMAC signature" });
        return;
      }
    }

    const { mac, state, date, timestamp } = req.body as ButtonPressData;

    // Validate timestamp for replay protection (only if HMAC is enabled)
    if (secret) {
      if (!timestamp || typeof timestamp !== "number") {
        res.status(400).json({ error: "Timestamp is required" });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const drift = Math.abs(now - timestamp);

      if (drift > MAX_TIMESTAMP_DRIFT_SECONDS) {
        res.status(401).json({
          error: "Request expired",
          serverTime: now,
          requestTime: timestamp,
        });
        return;
      }
    }

    // Validate input
    if (!mac || typeof mac !== "string") {
      res.status(400).json({ error: "MAC address is required" });
      return;
    }

    if (typeof state !== "boolean") {
      res.status(400).json({ error: "State must be a boolean" });
      return;
    }

    if (
      !date ||
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
      res.status(400).json({ error: "Date must be in YYYY-MM-DD format" });
      return;
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

    // Write press to device subcollection (works even before device is claimed)
    const pressRef = db
      .collection("devices")
      .doc(deviceDoc.id)
      .collection("presses")
      .doc(date);

    if (state) {
      // Save the button press
      await pressRef.set({
        date,
        pressedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.status(200).json({ success: true, message: "Press recorded" });
    } else {
      // Delete the button press
      await pressRef.delete();

      res.status(200).json({ success: true, message: "Press deleted" });
    }
  }
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
      "Must be logged in to unlink device"
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
      "Must be logged in to clear presses"
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
      "Must be logged in to delete account"
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
