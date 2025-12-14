import type { Timestamp } from "firebase/firestore";

export interface Press {
  date: string;
  pressedAt: Timestamp;
}
