<template>
  <div class="flex flex-col w-full flex-1 p-2">
    <div class="flex flex-col gap-1 w-full">
      <!-- Day of week labels at top -->
      <div class="flex" :style="{ gap: `${cellGap}px` }">
        <span
          v-for="day in dayLabels"
          :key="day"
          class="text-[10px] text-gray-500 text-center flex-1"
        >
          {{ day.charAt(0) }}
        </span>
      </div>

      <!-- Contribution grid -->
      <div class="flex flex-col flex-1" :style="{ gap: `${cellGap}px` }">
        <div
          v-for="(week, weekIndex) in weeks"
          :key="weekIndex"
          class="flex"
          :style="{ gap: `${cellGap}px` }"
        >
          <!-- Week cells -->
          <div
            v-for="(day, dayIndex) in week"
            :key="dayIndex"
            class="rounded-sm transition-transform duration-100 flex-1 aspect-square"
            :class="getCellClass(day)"
            :title="day.date.toDateString()"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { Press } from "~/types";

interface CalendarDay {
  date: Date;
  hasPress: boolean;
}

const props = defineProps<{
  presses: Press[];
}>();

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const cellGap = 3;

const today = new Date();
today.setHours(23, 59, 59, 999);

const earliest = computed(() => {
  if (props.presses.length === 0) return today;
  let min = props.presses[0]!.pressedAt.toDate();
  for (const press of props.presses) {
    const d = press.pressedAt.toDate();
    if (d < min) min = d;
  }
  return min;
});

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

const pressSet = computed(() => {
  const set = new Set<string>();
  for (const press of props.presses) {
    set.add(formatDateKey(press.pressedAt.toDate()));
  }
  return set;
});

// Generate all weeks from earliest press to today
const weeks = computed(() => {
  const result: CalendarDay[][] = [];

  const startDate = new Date(earliest.value);
  startDate.setHours(0, 0, 0, 0);
  const dayOfWeek = startDate.getDay();
  startDate.setDate(startDate.getDate() - dayOfWeek);

  const currentDate = new Date(startDate);

  while (currentDate <= today) {
    const week: CalendarDay[] = [];

    for (let i = 0; i < 7; i++) {
      const key = formatDateKey(currentDate);
      week.push({
        date: new Date(currentDate),
        hasPress: pressSet.value.has(key),
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    result.push(week);
  }

  return result.reverse();
});

function getCellClass(day: CalendarDay): string {
  const dateKey = formatDateKey(day.date);
  const todayKey = formatDateKey(today);
  const earliestKey = formatDateKey(earliest.value);

  if (dateKey > todayKey) return "bg-transparent";
  if (dateKey < earliestKey) return "bg-transparent";
  if (day.hasPress) return "bg-green-500 cursor-pointer hover:scale-110";

  // Alternate gray shades by month (even months lighter, odd months darker)
  const isEvenMonth = day.date.getMonth() % 2 === 0;
  return isEvenMonth
    ? "bg-gray-200 dark:bg-gray-600 cursor-pointer hover:scale-110"
    : "bg-gray-300 dark:bg-gray-500 cursor-pointer hover:scale-110";
}
</script>
