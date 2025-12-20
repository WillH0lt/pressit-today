<template>
  <div class="flex flex-col gap-4 min-[803px]:items-center">
    <!-- Year selector dropdown -->
    <div v-if="availableYears.length > 1">
      <USelect
        v-model="selectedYear"
        :items="yearSelectItems"
        class="w-32 ml-13"
        :content="{ bodyLock: false }"
        variant="soft"
      />
    </div>

    <div class="flex gap-1">
      <!-- Day of week labels -->
      <div class="flex flex-col shrink-0 pt-7">
        <div class="flex flex-col" style="gap: 2px">
          <span
            v-for="(label, index) in dayLabels"
            :key="index"
            class="h-3 text-md text-gray-500 flex items-center justify-end pr-1"
          >
            {{ label }}
          </span>
        </div>
      </div>

      <!-- Calendar area - scrollable on mobile -->
      <div
        ref="scrollContainer"
        class="flex flex-col gap-1 overflow-x-auto overflow-y-hidden min-w-0 pr-4"
      >
        <!-- Month labels row -->
        <div class="grid" :style="monthGridStyle(weeks)">
          <span
            v-for="(label, index) in monthLabels"
            :key="index"
            class="text-md text-gray-500"
          >
            {{ label }}
          </span>
        </div>

        <!-- Contribution grid - weeks as columns -->
        <div class="grid" :style="gridStyle(weeks)">
          <template v-for="(week, weekIndex) in weeks" :key="weekIndex">
            <UTooltip
              v-for="(day, dayIndex) in week"
              :key="`${weekIndex}-${dayIndex}`"
              :text="isDayVisible(day) ? formatTooltip(day) : undefined"
              :disabled="!isDayVisible(day)"
            >
              <div
                class="w-3 h-3 rounded-sm transition-colors duration-100"
                :class="getCellClass(day)"
              ></div>
            </UTooltip>
          </template>
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

const scrollContainer = ref<HTMLElement | null>(null);

const dayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];

// Scroll to the right on mount
function scrollToEnd() {
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollLeft = scrollContainer.value.scrollWidth;
    }
  });
}

onMounted(scrollToEnd);

const today = new Date();
today.setHours(23, 59, 59, 999);
const currentYear = today.getFullYear();

// Selected year - currentYear means "past year" rolling view
const selectedYear = ref(currentYear);
watch(selectedYear, () => {
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollLeft = 0;
    }
  });
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

// Map of date keys to press times for tooltip display
const pressTimeMap = computed(() => {
  const map = new Map<string, Date>();
  for (const press of props.presses) {
    const pressDate = press.pressedAt.toDate();
    const key = formatDateKey(pressDate);
    // Store the first press time for each day
    if (!map.has(key)) {
      map.set(key, pressDate);
    }
  }
  return map;
});

// Get the earliest year with data
const earliestYear = computed(() => {
  if (props.presses.length === 0) return currentYear;
  let min = currentYear;
  for (const press of props.presses) {
    const year = press.pressedAt.toDate().getFullYear();
    if (year < min) min = year;
  }
  return min;
});

// Available years for dropdown (current year + all previous years with data)
const availableYears = computed(() => {
  const years: number[] = [currentYear];
  for (let year = currentYear - 1; year >= earliestYear.value; year--) {
    years.push(year);
  }
  return years;
});

// Format years for USelect
const yearSelectItems = computed(() => {
  return availableYears.value.map((year) => ({
    label: year === currentYear ? "This year" : String(year),
    value: year,
  }));
});

// Generate weeks based on selected year
const weeks = computed(() => {
  const result: CalendarDay[][] = [];

  let startDate: Date;
  let endDate: Date;

  if (selectedYear.value === currentYear) {
    // Rolling 12-month view
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    startDate = new Date(oneYearAgo);
    endDate = today;
  } else {
    // Calendar year view
    startDate = new Date(selectedYear.value, 0, 1);
    endDate = new Date(selectedYear.value, 11, 31);
  }

  // Adjust start to beginning of week
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
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

  return result;
});

function gridStyle(weeks: CalendarDay[][]) {
  return {
    gridTemplateColumns: `repeat(${weeks.length}, 12px)`,
    gridTemplateRows: "repeat(7, 12px)",
    gridAutoFlow: "column",
    gap: "2px",
  };
}

function monthGridStyle(weeks: CalendarDay[][]) {
  return {
    gridTemplateColumns: `repeat(${weeks.length}, 12px)`,
    gap: "2px",
  };
}

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const monthLabels = computed(() => {
  const labels: string[] = [];
  let lastLabeledMonth = -1;
  const isCalendarYear = selectedYear.value !== currentYear;

  for (const week of weeks.value) {
    // Get Sunday (first day of the week)
    const sunday = week[0]!;
    const sundayYear = sunday.date.getFullYear();
    const month = sunday.date.getMonth();

    // For calendar year view, only show labels for months in the selected year
    if (isCalendarYear && sundayYear !== selectedYear.value) {
      labels.push("");
    } else if (month !== lastLabeledMonth) {
      labels.push(monthNames[month]!);
      lastLabeledMonth = month;
    } else {
      labels.push("");
    }
  }

  return labels;
});

function isDayVisible(day: CalendarDay): boolean {
  const dateKey = formatDateKey(day.date);
  const todayKey = formatDateKey(today);

  // Hide future days
  if (dateKey > todayKey) return false;

  // For calendar year view, hide days outside the selected year
  if (selectedYear.value !== currentYear) {
    if (day.date.getFullYear() !== selectedYear.value) return false;
  }

  return true;
}

function formatTooltip(day: CalendarDay): string {
  const dateStr = day.date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (day.hasPress) {
    const pressTime = pressTimeMap.value.get(formatDateKey(day.date));
    if (pressTime) {
      const timeStr = pressTime.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      return `${dateStr} at ${timeStr}`;
    }
  }

  return dateStr;
}

function getCellClass(day: CalendarDay): string {
  if (!isDayVisible(day)) return "bg-transparent";

  if (day.hasPress) return "bg-primary cursor-pointer hover:bg-primary-light";

  return "bg-gray-600 cursor-pointer hover:bg-gray-500";
}
</script>
