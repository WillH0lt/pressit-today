import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import type { Press } from "~/types";
import { useStatistics } from "~/composables/useStatistics";

// Helper to create a mock Press object
const createPress = (date: string, hour = 9, minute = 0): Press => ({
  date,
  pressedAt: {
    toDate: () => new Date(`${date}T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00`),
  } as any,
});

// Helper to get date string for N days ago (in local timezone)
const daysAgo = (n: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - n);
  // Use local date formatting to match what the composable expects
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Helper to get today's date string
const today = (): string => daysAgo(0);

describe("useStatistics", () => {
  let originalDate: DateConstructor;

  beforeEach(() => {
    // Store original Date
    originalDate = global.Date;
  });

  afterEach(() => {
    // Restore original Date
    global.Date = originalDate;
    vi.restoreAllMocks();
  });

  describe("totalPresses", () => {
    it("returns 0 for empty presses", () => {
      const presses = ref<Press[]>([]);
      const { totalPresses } = useStatistics(presses);
      expect(totalPresses.value).toBe(0);
    });

    it("returns correct count for multiple presses", () => {
      const presses = ref<Press[]>([
        createPress("2024-01-01"),
        createPress("2024-01-02"),
        createPress("2024-01-03"),
      ]);
      const { totalPresses } = useStatistics(presses);
      expect(totalPresses.value).toBe(3);
    });
  });

  describe("currentStreak", () => {
    it("returns 0 for empty presses", () => {
      const presses = ref<Press[]>([]);
      const { currentStreak } = useStatistics(presses);
      expect(currentStreak.value).toBe(0);
    });

    it("returns 1 for a press today only", () => {
      const presses = ref<Press[]>([createPress(today())]);
      const { currentStreak } = useStatistics(presses);
      expect(currentStreak.value).toBe(1);
    });

    it("returns correct streak for consecutive days ending today", () => {
      const presses = ref<Press[]>([
        createPress(daysAgo(2)),
        createPress(daysAgo(1)),
        createPress(today()),
      ]);
      const { currentStreak } = useStatistics(presses);
      expect(currentStreak.value).toBe(3);
    });

    it("returns correct streak for consecutive days ending yesterday", () => {
      const presses = ref<Press[]>([
        createPress(daysAgo(3)),
        createPress(daysAgo(2)),
        createPress(daysAgo(1)),
      ]);
      const { currentStreak } = useStatistics(presses);
      expect(currentStreak.value).toBe(3);
    });

    it("returns 0 when streak is broken (gap of 2+ days)", () => {
      const presses = ref<Press[]>([createPress(daysAgo(3))]);
      const { currentStreak } = useStatistics(presses);
      expect(currentStreak.value).toBe(0);
    });
  });

  describe("longestStreak", () => {
    it("returns 0 for empty presses", () => {
      const presses = ref<Press[]>([]);
      const { longestStreak } = useStatistics(presses);
      expect(longestStreak.value).toBe(0);
    });

    it("returns 1 for a single press", () => {
      const presses = ref<Press[]>([createPress("2024-01-15")]);
      const { longestStreak } = useStatistics(presses);
      expect(longestStreak.value).toBe(1);
    });

    it("returns correct longest streak", () => {
      const presses = ref<Press[]>([
        createPress("2024-01-01"),
        createPress("2024-01-02"),
        createPress("2024-01-03"),
        // gap
        createPress("2024-01-10"),
        createPress("2024-01-11"),
      ]);
      const { longestStreak } = useStatistics(presses);
      expect(longestStreak.value).toBe(3);
    });

    it("finds longest streak even if not at the start", () => {
      const presses = ref<Press[]>([
        createPress("2024-01-01"),
        createPress("2024-01-02"),
        // gap
        createPress("2024-01-10"),
        createPress("2024-01-11"),
        createPress("2024-01-12"),
        createPress("2024-01-13"),
      ]);
      const { longestStreak } = useStatistics(presses);
      expect(longestStreak.value).toBe(4);
    });
  });

  describe("longestGap", () => {
    it("returns '-' for empty presses", () => {
      const presses = ref<Press[]>([]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("-");
    });

    it("returns '-' for a single press", () => {
      const presses = ref<Press[]>([createPress("2024-01-15")]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("-");
    });

    it("returns '-' for consecutive days (no gap)", () => {
      const presses = ref<Press[]>([
        createPress("2024-01-01"),
        createPress("2024-01-02"),
        createPress("2024-01-03"),
      ]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("-");
    });

    it("returns correct gap for non-consecutive days", () => {
      const presses = ref<Press[]>([
        createPress("2024-01-01"),
        createPress("2024-01-05"), // 3 days gap (2, 3, 4)
      ]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("3 days");
    });

    it("returns '1 day' for singular gap", () => {
      const presses = ref<Press[]>([
        createPress("2024-01-01"),
        createPress("2024-01-03"), // 1 day gap (2)
      ]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("1 day");
    });

    it("finds the longest gap among multiple gaps", () => {
      const presses = ref<Press[]>([
        createPress("2024-01-01"),
        createPress("2024-01-03"), // 1 day gap
        createPress("2024-01-10"), // 6 days gap
        createPress("2024-01-12"), // 1 day gap
      ]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("6 days");
    });
  });

  describe("percentTotal", () => {
    it("returns '-' for empty presses", () => {
      const presses = ref<Press[]>([]);
      const { percentTotal } = useStatistics(presses);
      expect(percentTotal.value).toBe("-");
    });

    it("returns 100% for a single press", () => {
      const presses = ref<Press[]>([createPress("2024-01-15")]);
      const { percentTotal } = useStatistics(presses);
      expect(percentTotal.value).toBe("100%");
    });

    it("returns 100% for consecutive days", () => {
      const presses = ref<Press[]>([
        createPress("2024-01-01"),
        createPress("2024-01-02"),
        createPress("2024-01-03"),
      ]);
      const { percentTotal } = useStatistics(presses);
      expect(percentTotal.value).toBe("100%");
    });

    it("returns 50% for every other day", () => {
      const presses = ref<Press[]>([
        createPress("2024-01-01"),
        createPress("2024-01-03"),
        createPress("2024-01-05"),
      ]);
      const { percentTotal } = useStatistics(presses);
      // 3 presses over 5 days = 60%
      expect(percentTotal.value).toBe("60%");
    });
  });

  describe("avgTimeOfDay", () => {
    it("returns '-' for empty presses", () => {
      const presses = ref<Press[]>([]);
      const { avgTimeOfDay } = useStatistics(presses);
      expect(avgTimeOfDay.value).toBe("-");
    });

    it("returns correct time for morning press", () => {
      const presses = ref<Press[]>([createPress("2024-01-15", 9, 30)]);
      const { avgTimeOfDay } = useStatistics(presses);
      expect(avgTimeOfDay.value).toBe("9:30 AM");
    });

    it("returns correct time for afternoon press", () => {
      const presses = ref<Press[]>([createPress("2024-01-15", 14, 45)]);
      const { avgTimeOfDay } = useStatistics(presses);
      expect(avgTimeOfDay.value).toBe("2:45 PM");
    });

    it("returns correct average for multiple presses", () => {
      const presses = ref<Press[]>([
        createPress("2024-01-15", 8, 0), // 480 minutes
        createPress("2024-01-16", 10, 0), // 600 minutes
      ]);
      const { avgTimeOfDay } = useStatistics(presses);
      // Average: 540 minutes = 9:00 AM
      expect(avgTimeOfDay.value).toBe("9:00 AM");
    });

    it("handles noon correctly", () => {
      const presses = ref<Press[]>([createPress("2024-01-15", 12, 0)]);
      const { avgTimeOfDay } = useStatistics(presses);
      expect(avgTimeOfDay.value).toBe("12:00 PM");
    });

    it("handles midnight correctly", () => {
      const presses = ref<Press[]>([createPress("2024-01-15", 0, 0)]);
      const { avgTimeOfDay } = useStatistics(presses);
      expect(avgTimeOfDay.value).toBe("12:00 AM");
    });
  });

  describe("pluralizeDays", () => {
    it("returns '1 day' for count of 1", () => {
      const presses = ref<Press[]>([]);
      const { pluralizeDays } = useStatistics(presses);
      expect(pluralizeDays(1)).toBe("1 day");
    });

    it("returns '0 days' for count of 0", () => {
      const presses = ref<Press[]>([]);
      const { pluralizeDays } = useStatistics(presses);
      expect(pluralizeDays(0)).toBe("0 days");
    });

    it("returns '5 days' for count of 5", () => {
      const presses = ref<Press[]>([]);
      const { pluralizeDays } = useStatistics(presses);
      expect(pluralizeDays(5)).toBe("5 days");
    });
  });

  describe("percentThisMonth", () => {
    it("returns '-' for empty presses", () => {
      const presses = ref<Press[]>([]);
      const { percentThisMonth } = useStatistics(presses);
      expect(percentThisMonth.value).toBe("-");
    });

    it("returns 100% when first press is today and pressed today", () => {
      const presses = ref<Press[]>([createPress(today())]);
      const { percentThisMonth } = useStatistics(presses);
      expect(percentThisMonth.value).toBe("100%");
    });
  });

  describe("percentThisYear", () => {
    it("returns '-' for empty presses", () => {
      const presses = ref<Press[]>([]);
      const { percentThisYear } = useStatistics(presses);
      expect(percentThisYear.value).toBe("-");
    });

    it("returns 100% when first press is today and pressed today", () => {
      const presses = ref<Press[]>([createPress(today())]);
      const { percentThisYear } = useStatistics(presses);
      expect(percentThisYear.value).toBe("100%");
    });
  });

  describe("stats array", () => {
    it("returns all expected stat labels", () => {
      const presses = ref<Press[]>([createPress(today())]);
      const { stats } = useStatistics(presses);
      const labels = stats.value.map((s) => s.label);
      expect(labels).toContain("Total presses");
      expect(labels).toContain("Longest streak");
      expect(labels).toContain("Current streak");
      expect(labels).toContain("Longest gap");
      expect(labels).toContain("This month");
      expect(labels).toContain("This year");
      expect(labels).toContain("All time");
      expect(labels).toContain("Avg time of day");
    });
  });
});
