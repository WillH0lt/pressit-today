import type { Timestamp } from "firebase/firestore";

export interface Press {
  date: string; // Date in device's local timezone (e.g., "2024-06-15")
  time: string; // Time in device's local timezone (e.g., "6:41 AM")
  pressedAt: Timestamp; // Firestore Timestamp
}
