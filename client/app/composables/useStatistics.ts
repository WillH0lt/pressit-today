import type { Press } from "~/types";

// Parse a date string (YYYY-MM-DD) as local midnight
const parseLocalDate = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
};

export const useStatistics = (presses: Ref<Press[]>) => {
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
    if (sortedDates.value.length < 2) return "-";

    let maxGap = 0;
    for (let i = 1; i < sortedDates.value.length; i++) {
      const prev = new Date(sortedDates.value[i - 1]!);
      const curr = new Date(sortedDates.value[i]!);
      const gap =
        Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)) -
        1;
      maxGap = Math.max(maxGap, gap);
    }

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
    `${count} ${count === 1 ? "day" : "days"}`;

  const stats = computed(() => [
    { label: "Total presses", value: totalPresses.value },
    { label: "Current streak", value: pluralizeDays(currentStreak.value) },
    { label: "Longest streak", value: pluralizeDays(longestStreak.value) },
    { label: "Longest gap", value: longestGap.value },
    { label: "This month", value: percentThisMonth.value },
    { label: "This year", value: percentThisYear.value },
    { label: "All time", value: percentTotal.value },
    { label: "Avg time of day", value: avgTimeOfDay.value },
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
    stats,
  };
};
