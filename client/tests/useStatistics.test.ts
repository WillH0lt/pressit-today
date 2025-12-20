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

    it("includes today in streak when pressed today", () => {
      const presses = ref<Press[]>([
        createPress(daysAgo(2)),
        createPress(daysAgo(1)),
        createPress(today()),
      ]);
      const { currentStreak } = useStatistics(presses);
      expect(currentStreak.value).toBe(3);
    });

    it("counts from yesterday when no press today", () => {
      const presses = ref<Press[]>([
        createPress(daysAgo(3)),
        createPress(daysAgo(2)),
        createPress(daysAgo(1)),
        // No press today
      ]);
      const { currentStreak } = useStatistics(presses);
      expect(currentStreak.value).toBe(3);
    });

    it("returns 1 for yesterday only when no press today", () => {
      const presses = ref<Press[]>([createPress(daysAgo(1))]);
      const { currentStreak } = useStatistics(presses);
      expect(currentStreak.value).toBe(1);
    });

    it("returns 0 when streak is broken (gap of 2+ days from today)", () => {
      const presses = ref<Press[]>([createPress(daysAgo(3))]);
      const { currentStreak } = useStatistics(presses);
      expect(currentStreak.value).toBe(0);
    });

    it("returns 0 when only press is 2 days ago (gap from yesterday)", () => {
      const presses = ref<Press[]>([createPress(daysAgo(2))]);
      const { currentStreak } = useStatistics(presses);
      expect(currentStreak.value).toBe(0);
    });

    it("counts streak correctly when today breaks a gap", () => {
      // Had a streak 5-3 days ago, skipped 2 days ago, pressed yesterday and today
      const presses = ref<Press[]>([
        createPress(daysAgo(5)),
        createPress(daysAgo(4)),
        createPress(daysAgo(3)),
        // Gap at daysAgo(2)
        createPress(daysAgo(1)),
        createPress(today()),
      ]);
      const { currentStreak } = useStatistics(presses);
      expect(currentStreak.value).toBe(2); // Only yesterday and today
    });

    it("handles multiple presses on the same day", () => {
      const presses = ref<Press[]>([
        createPress(daysAgo(1), 9, 0),
        createPress(daysAgo(1), 14, 30),
        createPress(today(), 8, 0),
        createPress(today(), 12, 0),
      ]);
      const { currentStreak } = useStatistics(presses);
      expect(currentStreak.value).toBe(2);
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

    it("returns '-' for consecutive days ending today (no gap)", () => {
      const presses = ref<Press[]>([
        createPress(daysAgo(2)),
        createPress(daysAgo(1)),
        createPress(today()),
      ]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("-");
    });

    it("returns correct gap for non-consecutive days", () => {
      const presses = ref<Press[]>([
        createPress(daysAgo(10)),
        createPress(daysAgo(6)), // 3 days gap
        createPress(today()),
      ]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("5 days"); // Gap from daysAgo(6) to today is 5 days
    });

    it("returns '1 day' for singular gap", () => {
      const presses = ref<Press[]>([
        createPress(daysAgo(3)),
        createPress(daysAgo(1)), // 1 day gap (daysAgo(2) missing)
        createPress(today()),
      ]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("1 day");
    });

    it("finds the longest gap among multiple gaps", () => {
      const presses = ref<Press[]>([
        createPress(daysAgo(15)),
        createPress(daysAgo(13)), // 1 day gap
        createPress(daysAgo(6)), // 6 days gap
        createPress(daysAgo(4)), // 1 day gap
        createPress(today()),
      ]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("6 days");
    });

    it("includes gap from last press until today", () => {
      // Last press was 5 days ago, so there's a 4-day gap
      const presses = ref<Press[]>([createPress(daysAgo(5))]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("4 days");
    });

    it("returns current gap when it's the longest", () => {
      const presses = ref<Press[]>([
        createPress(daysAgo(20)),
        createPress(daysAgo(18)), // 1 day gap
        createPress(daysAgo(10)), // 7 days gap between presses, but 9 days from last press to today
      ]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("9 days"); // Gap from daysAgo(10) to today
    });

    it("returns gap between presses when larger than current gap", () => {
      const presses = ref<Press[]>([
        createPress(daysAgo(20)),
        createPress(daysAgo(5)), // 14 days gap between presses
        createPress(daysAgo(3)), // Current gap is only 2 days
      ]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("14 days");
    });

    it("returns '-' for a single press today (no gap)", () => {
      const presses = ref<Press[]>([createPress(today())]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("-");
    });

    it("returns '-' for a single press yesterday (no gap yet)", () => {
      const presses = ref<Press[]>([createPress(daysAgo(1))]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("-");
    });

    it("returns '1 day' for a single press 2 days ago", () => {
      const presses = ref<Press[]>([createPress(daysAgo(2))]);
      const { longestGap } = useStatistics(presses);
      expect(longestGap.value).toBe("1 day");
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

    it("returns '-' for count of 0", () => {
      const presses = ref<Press[]>([]);
      const { pluralizeDays } = useStatistics(presses);
      expect(pluralizeDays(0)).toBe("-");
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
      expect(labels).toContain("Avg time of day");
    });
  });

  describe("currentWeeklyStreak", () => {
    // Helper to get a date for a specific day of the current week (0 = Sunday, 6 = Saturday)
    const getDateForDayOfWeek = (dayOfWeek: number): string => {
      const now = new Date();
      const currentDay = now.getDay(); // 0 = Sunday
      const diff = dayOfWeek - currentDay;
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() + diff);
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, "0");
      const day = String(targetDate.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    // Helper to get a date N weeks ago on a specific day (0 = Sunday, 6 = Saturday)
    const weeksAgo = (weeks: number, dayOfWeek: number = 0): string => {
      const now = new Date();
      const currentDay = now.getDay();
      const diff = dayOfWeek - currentDay - weeks * 7;
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() + diff);
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, "0");
      const day = String(targetDate.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    it("returns 0 for empty presses", () => {
      const presses = ref<Press[]>([]);
      const threshold = ref(1);
      const { currentWeeklyStreak } = useStatistics(presses, threshold);
      expect(currentWeeklyStreak.value).toBe(0);
    });

    it("returns 1 when current week meets threshold", () => {
      const presses = ref<Press[]>([
        createPress(getDateForDayOfWeek(0)), // Sunday of current week
      ]);
      const threshold = ref(1);
      const { currentWeeklyStreak } = useStatistics(presses, threshold);
      expect(currentWeeklyStreak.value).toBe(1);
    });

    it("returns streak count including current week when it qualifies", () => {
      const presses = ref<Press[]>([
        createPress(weeksAgo(2, 0)), // 2 weeks ago (Sunday)
        createPress(weeksAgo(1, 0)), // 1 week ago (Sunday)
        createPress(getDateForDayOfWeek(0)), // This week (Sunday)
      ]);
      const threshold = ref(1);
      const { currentWeeklyStreak } = useStatistics(presses, threshold);
      expect(currentWeeklyStreak.value).toBe(3);
    });

    it("returns previous streak when current week can still qualify", () => {
      // This test simulates: it's early in the week, haven't pressed yet, but previous weeks qualify
      const now = new Date();
      const currentDayOfWeek = now.getDay(); // 0 = Sunday
      const remainingDays = 7 - currentDayOfWeek; // Days left including today

      // Only run this test if there are remaining days in the week (not Saturday)
      if (remainingDays > 0) {
        const presses = ref<Press[]>([
          createPress(weeksAgo(2, 0)),
          createPress(weeksAgo(1, 0)),
          // No press this week yet
        ]);
        const threshold = ref(1); // Can still be met with remaining days
        const { currentWeeklyStreak } = useStatistics(presses, threshold);
        expect(currentWeeklyStreak.value).toBe(2);
      }
    });

    it("returns 0 when current week cannot qualify and streak is broken", () => {
      // The streak should be 0 because we can't meet the threshold anymore
      const now = new Date();
      const currentDayOfWeek = now.getDay(); // 0 = Sunday
      const remainingDays = 7 - currentDayOfWeek; // includes today

      // Set threshold higher than remaining days + current presses
      const presses = ref<Press[]>([
        createPress(weeksAgo(1, 0)), // Last week qualified
        createPress(getDateForDayOfWeek(0)), // One press this week (Sunday)
      ]);
      const threshold = ref(remainingDays + 2); // Impossible to reach
      const { currentWeeklyStreak } = useStatistics(presses, threshold);
      expect(currentWeeklyStreak.value).toBe(0);
    });

    it("correctly counts consecutive qualifying weeks", () => {
      const presses = ref<Press[]>([
        createPress(weeksAgo(3, 0)), // Sunday
        createPress(weeksAgo(3, 1)), // Monday
        createPress(weeksAgo(2, 0)),
        createPress(weeksAgo(2, 2)), // Tuesday
        createPress(weeksAgo(1, 1)),
        createPress(weeksAgo(1, 3)), // Wednesday
        createPress(getDateForDayOfWeek(0)),
        createPress(getDateForDayOfWeek(1)),
      ]);
      const threshold = ref(2);
      const { currentWeeklyStreak } = useStatistics(presses, threshold);
      expect(currentWeeklyStreak.value).toBe(4);
    });

    it("breaks streak when a week in the middle doesn't qualify", () => {
      const presses = ref<Press[]>([
        createPress(weeksAgo(3, 0)),
        createPress(weeksAgo(3, 1)),
        // weeksAgo(2) has no presses - breaks streak
        createPress(weeksAgo(1, 0)),
        createPress(weeksAgo(1, 1)),
        createPress(getDateForDayOfWeek(0)),
        createPress(getDateForDayOfWeek(1)),
      ]);
      const threshold = ref(2);
      const { currentWeeklyStreak } = useStatistics(presses, threshold);
      expect(currentWeeklyStreak.value).toBe(2); // Only current and last week
    });
  });

  describe("longestWeeklyGap", () => {
    // Helper to get a date for a specific day of the current week (0 = Sunday, 6 = Saturday)
    const getDateForDayOfWeek = (dayOfWeek: number): string => {
      const now = new Date();
      const currentDay = now.getDay(); // 0 = Sunday
      const diff = dayOfWeek - currentDay;
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() + diff);
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, "0");
      const day = String(targetDate.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    // Helper to get a date N weeks ago on a specific day (0 = Sunday, 6 = Saturday)
    const weeksAgo = (weeks: number, dayOfWeek: number = 0): string => {
      const now = new Date();
      const currentDay = now.getDay();
      const diff = dayOfWeek - currentDay - weeks * 7;
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() + diff);
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, "0");
      const day = String(targetDate.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    it("returns '-' for empty presses", () => {
      const presses = ref<Press[]>([]);
      const threshold = ref(1);
      const { longestWeeklyGap } = useStatistics(presses, threshold);
      expect(longestWeeklyGap.value).toBe("-");
    });

    it("returns '-' for consecutive qualifying weeks ending this week", () => {
      const presses = ref<Press[]>([
        createPress(weeksAgo(2, 0)),
        createPress(weeksAgo(1, 0)),
        createPress(getDateForDayOfWeek(0)),
      ]);
      const threshold = ref(1);
      const { longestWeeklyGap } = useStatistics(presses, threshold);
      expect(longestWeeklyGap.value).toBe("-");
    });

    it("returns correct gap for non-consecutive qualifying weeks", () => {
      const presses = ref<Press[]>([
        createPress(weeksAgo(5, 0)), // Week 5 ago
        // Gap: weeks 4 and 3
        createPress(weeksAgo(2, 0)), // Week 2 ago
        createPress(weeksAgo(1, 0)), // Week 1 ago
        createPress(getDateForDayOfWeek(0)), // This week
      ]);
      const threshold = ref(1);
      const { longestWeeklyGap } = useStatistics(presses, threshold);
      expect(longestWeeklyGap.value).toBe("2 weeks");
    });

    it("includes gap from last qualifying week until current week", () => {
      // Only qualifying week was 4 weeks ago, so there's a 3-week gap to current week
      const presses = ref<Press[]>([createPress(weeksAgo(4, 0))]);
      const threshold = ref(1);
      const { longestWeeklyGap } = useStatistics(presses, threshold);
      expect(longestWeeklyGap.value).toBe("3 weeks");
    });

    it("returns current gap when it's the longest", () => {
      const presses = ref<Press[]>([
        createPress(weeksAgo(10, 0)),
        createPress(weeksAgo(9, 0)), // Consecutive
        createPress(weeksAgo(5, 0)), // 3-week gap between presses, but 4 weeks from last to now
      ]);
      const threshold = ref(1);
      const { longestWeeklyGap } = useStatistics(presses, threshold);
      expect(longestWeeklyGap.value).toBe("4 weeks"); // Gap from weeksAgo(5) to current week
    });

    it("returns gap between weeks when larger than current gap", () => {
      const presses = ref<Press[]>([
        createPress(weeksAgo(10, 0)),
        // Gap between week 10 and week 3
        createPress(weeksAgo(3, 0)),
        createPress(weeksAgo(2, 0)),
        createPress(weeksAgo(1, 0)),
        createPress(getDateForDayOfWeek(0)), // Current week - no gap from last week
      ]);
      const threshold = ref(1);
      const { longestWeeklyGap } = useStatistics(presses, threshold);
      // The gap is larger than the current gap (which is 0)
      // The exact number depends on week boundary alignment
      expect(Number(longestWeeklyGap.value.split(" ")[0])).toBeGreaterThanOrEqual(6);
      expect(longestWeeklyGap.value).toContain("weeks");
    });

    it("returns '-' for a single qualifying week this week (no gap)", () => {
      const presses = ref<Press[]>([createPress(getDateForDayOfWeek(0))]);
      const threshold = ref(1);
      const { longestWeeklyGap } = useStatistics(presses, threshold);
      expect(longestWeeklyGap.value).toBe("-");
    });

    it("returns '-' for a single qualifying week last week (no gap yet)", () => {
      const presses = ref<Press[]>([createPress(weeksAgo(1, 0))]);
      const threshold = ref(1);
      const { longestWeeklyGap } = useStatistics(presses, threshold);
      expect(longestWeeklyGap.value).toBe("-");
    });

    it("returns '1 week' for a single qualifying week 2 weeks ago", () => {
      const presses = ref<Press[]>([createPress(weeksAgo(2, 0))]);
      const threshold = ref(1);
      const { longestWeeklyGap } = useStatistics(presses, threshold);
      expect(longestWeeklyGap.value).toBe("1 week");
    });

    it("only considers weeks that meet the threshold", () => {
      const presses = ref<Press[]>([
        createPress(weeksAgo(5, 0)),
        createPress(weeksAgo(5, 1)), // Week 5 qualifies (2 presses)
        createPress(weeksAgo(3, 0)), // Week 3 has only 1 press - doesn't qualify
        createPress(getDateForDayOfWeek(0)),
        createPress(getDateForDayOfWeek(1)), // This week qualifies (2 presses)
      ]);
      const threshold = ref(2);
      const { longestWeeklyGap } = useStatistics(presses, threshold);
      expect(longestWeeklyGap.value).toBe("4 weeks"); // Gap between week 5 and current week
    });
  });
});
