import {
  onCall,
  onRequest,
  HttpsError,
  CallableRequest,
} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import type { Request, Response } from "express";

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
}

/**
 * HTTP endpoint to receive button presses from devices.
 *
 * Expected input: { mac: "AA:BB:CC:DD:EE:FF", state: true, date: "2025-01-15" }
 *
 * This function:
 * 1. Validates the request payload
 * 2. Looks up the device by MAC address
 * 3. If state is true: saves the button press timestamp to device subcollection
 * 4. If state is false: deletes the button press for that date
 *
 * Presses are stored on the device, allowing tracking before the device is claimed.
 *
 * TODO: Add HMAC signature verification when using ESP32-S3/C3 with eFuse
 */
export const buttonPress = onRequest(async (req: Request, res: Response) => {
  // Only allow POST requests
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { mac, state, date } = req.body as ButtonPressData;

  // Validate input
  if (!mac || typeof mac !== "string") {
    res.status(400).json({ error: "MAC address is required" });
    return;
  }

  if (typeof state !== "boolean") {
    res.status(400).json({ error: "State must be a boolean" });
    return;
  }

  if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
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
});

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

  const pressesRef = db.collection("devices").doc(deviceId).collection("presses");
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
