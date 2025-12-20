import type { Press } from "~/types";

// Parse a date string (YYYY-MM-DD) as local midnight
const parseLocalDate = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
};

// Get week number for a date (Sunday-Saturday weeks)
const getWeekNumber = (date: Date): { year: number; week: number } => {
  // Create a date at the start of the week (Sunday)
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOfWeek = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - dayOfWeek); // Move to Sunday of this week

  // Get the first Sunday of the year
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const firstSunday = new Date(yearStart);
  firstSunday.setDate(yearStart.getDate() - yearStart.getDay());

  // If first Sunday is in previous year, use it; otherwise find first Sunday of this year
  if (firstSunday.getFullYear() < d.getFullYear()) {
    firstSunday.setDate(firstSunday.getDate() + 7);
  }

  // Calculate week number
  const diffTime = d.getTime() - firstSunday.getTime();
  const diffDays = Math.floor(diffTime / 86400000);
  const week = Math.floor(diffDays / 7) + 1;

  return { year: d.getFullYear(), week };
};

// Get week key string for comparison
const getWeekKey = (date: Date): string => {
  const { year, week } = getWeekNumber(date);
  return `${year}-W${week.toString().padStart(2, "0")}`;
};

// Get the day of week (0 = Sunday, 6 = Saturday)
const getDayOfWeek = (date: Date): number => {
  return date.getDay();
};

// Get remaining days in the current week (including today), Sunday-Saturday
const getRemainingDaysInWeek = (date: Date): number => {
  return 7 - getDayOfWeek(date);
};

export const useStatistics = (
  presses: Ref<Press[]>,
  pressesPerWeekThreshold: Ref<number> = ref(1)
) => {
  const totalPresses = computed(() => presses.value.length);

  const sortedDates = computed(() => {
    return [
      ...new Set(
        presses.value.map((p) => p.date).filter((d): d is string => !!d)
      ),
    ].sort();
  });

  const currentStreak = computed(() => {
    if (!presses.value.length) return 0;

    const pressedDates = new Set(
      presses.value.map((p) => p.date).filter((d): d is string => !!d)
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let streak = 0;
    let checkDate = new Date(today);

    // Check if today has a press, if not start from yesterday
    const todayStr = checkDate.toISOString().split("T")[0] ?? "";
    if (todayStr && !pressedDates.has(todayStr)) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (true) {
      const dateStr = checkDate.toISOString().split("T")[0];
      if (dateStr && pressedDates.has(dateStr)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  });

  const longestStreak = computed(() => {
    if (!presses.value.length) return 0;

    const dates = sortedDates.value;
    if (dates.length === 0) return 0;

    let longest = 1;
    let current = 1;

    for (let i = 1; i < dates.length; i++) {
      const prev = dates[i - 1];
      const curr = dates[i];
      if (!prev || !curr) continue;

      const prevDate = new Date(prev);
      const currDate = new Date(curr);
      const diffDays = Math.round(
        (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diffDays === 1) {
        current++;
        longest = Math.max(longest, current);
      } else {
        current = 1;
      }
    }

    return longest;
  });

  const thisMonth = computed(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    return presses.value.filter((p) => {
      if (!p.date) return false;
      const pressDate = new Date(p.date);
      return pressDate.getFullYear() === year && pressDate.getMonth() === month;
    }).length;
  });

  const percentThisMonth = computed(() => {
    if (!sortedDates.value.length) return "-";
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const firstPress = parseLocalDate(sortedDates.value[0]!);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDate = firstPress > startOfMonth ? firstPress : startOfMonth;
    const daysSoFar =
      Math.round(
        (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;
    if (daysSoFar <= 0) return "-";
    return `${Math.round((thisMonth.value / daysSoFar) * 100)}%`;
  });

  const thisYear = computed(() => {
    const year = new Date().getFullYear();
    return presses.value.filter((p) => {
      if (!p.date) return false;
      return new Date(p.date).getFullYear() === year;
    }).length;
  });

  const percentThisYear = computed(() => {
    if (!sortedDates.value.length) return "-";
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const firstPress = parseLocalDate(sortedDates.value[0]!);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startDate = firstPress > startOfYear ? firstPress : startOfYear;
    const daysSoFar =
      Math.round(
        (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;
    if (daysSoFar <= 0) return "-";
    return `${Math.round((thisYear.value / daysSoFar) * 100)}%`;
  });

  const percentTotal = computed(() => {
    if (!sortedDates.value.length) return "-";
    const firstDate = new Date(sortedDates.value[0]!);
    const lastDate = new Date(sortedDates.value[sortedDates.value.length - 1]!);
    const totalDays =
      Math.ceil(
        (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;
    if (!totalDays) return "-";
    return `${Math.round((sortedDates.value.length / totalDays) * 100)}%`;
  });

  const longestGap = computed(() => {
    if (sortedDates.value.length === 0) return "-";

    let maxGap = 0;

    // Check gaps between presses
    for (let i = 1; i < sortedDates.value.length; i++) {
      const prev = new Date(sortedDates.value[i - 1]!);
      const curr = new Date(sortedDates.value[i]!);
      const gap =
        Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)) -
        1;
      maxGap = Math.max(maxGap, gap);
    }

    // Check gap from last press until today
    const lastPressDate = parseLocalDate(
      sortedDates.value[sortedDates.value.length - 1]!
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const gapFromLastPress =
      Math.round(
        (today.getTime() - lastPressDate.getTime()) / (1000 * 60 * 60 * 24)
      ) - 1;
    maxGap = Math.max(maxGap, gapFromLastPress);

    return maxGap > 0 ? pluralizeDays(maxGap) : "-";
  });

  const avgTimeOfDay = computed(() => {
    const times = presses.value
      .filter((p) => p.pressedAt)
      .map((p) => {
        const date = p.pressedAt.toDate();
        return date.getHours() * 60 + date.getMinutes();
      });

    if (!times.length) return "-";

    const avgMinutes = Math.round(
      times.reduce((a, b) => a + b, 0) / times.length
    );
    const hours = Math.floor(avgMinutes / 60);
    const minutes = avgMinutes % 60;
    const period = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, "0")} ${period}`;
  });

  const pluralizeDays = (count: number) =>
    count === 0 ? "-" : `${count} ${count === 1 ? "day" : "days"}`;

  const pluralizeWeeks = (count: number) =>
    count === 0 ? "-" : `${count} ${count === 1 ? "week" : "weeks"}`;

  // Weekly statistics
  const pressesPerWeek = computed(() => {
    const weekCounts = new Map<string, number>();
    presses.value.forEach((p) => {
      if (!p.date) return;
      const weekKey = getWeekKey(parseLocalDate(p.date));
      weekCounts.set(weekKey, (weekCounts.get(weekKey) || 0) + 1);
    });
    return weekCounts;
  });

  const sortedWeeks = computed(() => {
    return [...pressesPerWeek.value.keys()].sort();
  });

  // Weeks that meet the threshold
  const qualifyingWeeks = computed(() => {
    const threshold = pressesPerWeekThreshold.value;
    return new Set(
      [...pressesPerWeek.value.entries()]
        .filter(([, count]) => count >= threshold)
        .map(([week]) => week)
    );
  });

  const currentWeeklyStreak = computed(() => {
    if (!qualifyingWeeks.value.size) return 0;

    const today = new Date();
    const currentWeekKey = getWeekKey(today);
    const currentWeekPresses = pressesPerWeek.value.get(currentWeekKey) || 0;
    const threshold = pressesPerWeekThreshold.value;
    const remainingDays = getRemainingDaysInWeek(today);

    // Check if current week qualifies
    const currentWeekQualifies = qualifyingWeeks.value.has(currentWeekKey);

    // Check if it's still possible for current week to qualify
    const canStillQualify = currentWeekPresses + remainingDays >= threshold;

    // If current week doesn't qualify and can't qualify anymore, streak is broken
    if (!currentWeekQualifies && !canStillQualify) {
      return 0;
    }

    // Start counting from the appropriate week
    let checkDate = new Date(today);
    if (!currentWeekQualifies) {
      // Current week doesn't qualify yet but still can - start from previous week
      checkDate.setDate(checkDate.getDate() - 7);
    }

    // Count backwards through qualifying weeks
    let streak = 0;
    while (qualifyingWeeks.value.has(getWeekKey(checkDate))) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 7);
    }

    return streak;
  });

  const longestWeeklyStreak = computed(() => {
    const weeks = sortedWeeks.value.filter((w) => qualifyingWeeks.value.has(w));
    if (weeks.length === 0) return 0;

    let longest = 1;
    let current = 1;

    for (let i = 1; i < weeks.length; i++) {
      const prev = weeks[i - 1]!;
      const curr = weeks[i]!;

      // Parse week keys and check if consecutive
      const [prevYear, prevWeek] = prev.split("-W").map(Number);
      const [currYear, currWeek] = curr.split("-W").map(Number);

      const isConsecutive =
        (currYear === prevYear && currWeek === prevWeek! + 1) ||
        (currYear === prevYear! + 1 && prevWeek === 52 && currWeek === 1) ||
        (currYear === prevYear! + 1 && prevWeek === 53 && currWeek === 1);

      if (isConsecutive) {
        current++;
        longest = Math.max(longest, current);
      } else {
        current = 1;
      }
    }

    return longest;
  });

  const longestWeeklyGap = computed(() => {
    const weeks = sortedWeeks.value.filter((w) => qualifyingWeeks.value.has(w));
    if (weeks.length === 0) return "-";

    let maxGap = 0;

    // Check gaps between qualifying weeks
    for (let i = 1; i < weeks.length; i++) {
      const prev = weeks[i - 1]!;
      const curr = weeks[i]!;

      const [prevYear, prevWeek] = prev.split("-W").map(Number);
      const [currYear, currWeek] = curr.split("-W").map(Number);

      // Calculate gap in weeks
      const prevTotal = prevYear! * 52 + prevWeek!;
      const currTotal = currYear! * 52 + currWeek!;
      const gap = currTotal - prevTotal - 1;

      maxGap = Math.max(maxGap, gap);
    }

    // Check gap from last qualifying week until current week
    const lastQualifyingWeek = weeks[weeks.length - 1]!;
    const currentWeekKey = getWeekKey(new Date());

    const [lastYear, lastWeek] = lastQualifyingWeek.split("-W").map(Number);
    const [currYear, currWeek] = currentWeekKey.split("-W").map(Number);

    const lastTotal = lastYear! * 52 + lastWeek!;
    const currTotal = currYear! * 52 + currWeek!;
    const gapFromLastQualifying = currTotal - lastTotal - 1;

    maxGap = Math.max(maxGap, gapFromLastQualifying);

    return maxGap > 0 ? pluralizeWeeks(maxGap) : "-";
  });

  const totalQualifyingWeeks = computed(() => qualifyingWeeks.value.size);

  const stats = computed(() => [
    { label: "Total presses", value: totalPresses.value },
    { label: "Current streak", value: pluralizeDays(currentStreak.value) },
    { label: "Longest streak", value: pluralizeDays(longestStreak.value) },
    { label: "Longest gap", value: longestGap.value },
    // { label: "This month", value: percentThisMonth.value },
    // { label: "This year", value: percentThisYear.value },
    // { label: "All time", value: percentTotal.value },
    { label: "Avg time of day", value: avgTimeOfDay.value },
  ]);

  const weeklyStats = computed(() => [
    { label: "Total good weeks", value: totalQualifyingWeeks.value },
    {
      label: "Current streak",
      value: pluralizeWeeks(currentWeeklyStreak.value),
    },
    {
      label: "Longest streak",
      value: pluralizeWeeks(longestWeeklyStreak.value),
    },
    { label: "Longest gap", value: longestWeeklyGap.value },
  ]);

  return {
    totalPresses,
    currentStreak,
    longestStreak,
    thisMonth,
    percentThisMonth,
    thisYear,
    percentThisYear,
    percentTotal,
    longestGap,
    avgTimeOfDay,
    pluralizeDays,
    pluralizeWeeks,
    stats,
    weeklyStats,
    currentWeeklyStreak,
    longestWeeklyStreak,
    longestWeeklyGap,
    totalQualifyingWeeks,
  };
};
