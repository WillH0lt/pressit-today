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
        "Must be logged in to claim a device"
      );
    }

    const uid = request.auth.uid;
    const claimCode = request.data?.claimCode;

    // Validate input
    if (!claimCode || typeof claimCode !== "string") {
      throw new HttpsError("invalid-argument", "Claim code is required");
    }

    const normalizedCode = claimCode.toUpperCase().trim();

    if (normalizedCode.length !== 10) {
      throw new HttpsError(
        "invalid-argument",
        "Claim code must be 10 characters"
      );
    }

    // Look up the device by claim code
    const devicesRef = db.collection("devices");
    const snapshot = await devicesRef
      .where("claimCode", "==", normalizedCode)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new HttpsError("not-found", "Invalid claim code");
    }

    const deviceDoc = snapshot.docs[0];
    const deviceData = deviceDoc.data();

    // Check if device is already claimed
    if (deviceData.ownerId) {
      if (deviceData.ownerId === uid) {
        throw new HttpsError(
          "already-exists",
          "You have already claimed this device"
        );
      }
      throw new HttpsError(
        "permission-denied",
        "This device has already been claimed"
      );
    }

    // Claim the device - update both collections in a batch
    const batch = db.batch();

    // Update the device document
    batch.update(deviceDoc.ref, {
      ownerId: uid,
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update or create the user document with the device reference
    const userRef = db.collection("users").doc(uid);
    batch.set(
      userRef,
      {
        deviceId: deviceDoc.id,
        deviceMac: deviceData.macAddress,
        deviceClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await batch.commit();

    return {
      success: true,
      message: "Device claimed successfully",
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
 * 3. Verifies the device is claimed (has an owner)
 * 4. If state is true: saves the button press timestamp
 * 5. If state is false: deletes the button press for that date
 *
 * TODO: Add HMAC signature verification when using ESP32-S3/C3 with eFuse
 */
export const buttonPress = onRequest(
  async (req: Request, res: Response) => {
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
    const deviceData = deviceDoc.data();

    // Verify device is claimed
    if (!deviceData.ownerId) {
      res.status(403).json({ error: "Device is not claimed" });
      return;
    }

    const ownerId = deviceData.ownerId;
    const pressRef = db
      .collection("users")
      .doc(ownerId)
      .collection("presses")
      .doc(date);

    if (state) {
      // Save the button press
      await pressRef.set({
        date,
        pressedAt: admin.firestore.FieldValue.serverTimestamp(),
        deviceMac: normalizedMac,
      });

      res.status(200).json({ success: true, message: "Press recorded" });
    } else {
      // Delete the button press
      await pressRef.delete();

      res.status(200).json({ success: true, message: "Press deleted" });
    }
  }
);
