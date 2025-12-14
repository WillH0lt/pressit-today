<template>
  <div class="streak-calendar w-full max-w-md mx-auto" ref="containerRef">
    <!-- Day of week headers -->
    <div class="grid grid-cols-[40px_repeat(7,1fr)] gap-1 mb-2 sticky top-0 bg-white z-10 pb-2">
      <div></div>
      <div
        v-for="day in dayLabels"
        :key="day"
        class="text-center text-xs font-medium text-gray-500"
      >
        {{ day }}
      </div>
    </div>

    <!-- Calendar grid with month labels -->
    <div class="calendar-grid">
      <template v-for="(month, monthIndex) in visibleMonths" :key="`${month.year}-${month.month}`">
        <!-- Month rows -->
        <template v-for="(week, weekIndex) in month.weeks" :key="`${month.year}-${month.month}-${weekIndex}`">
          <div class="grid grid-cols-[40px_repeat(7,1fr)] gap-1 mb-1">
            <!-- Month label on first week of month -->
            <div class="flex items-center justify-end pr-2">
              <span
                v-if="weekIndex === 0"
                class="text-xs font-medium text-gray-400"
              >
                {{ month.label }}
              </span>
            </div>

            <!-- Day cells -->
            <div
              v-for="(day, dayIndex) in week.days"
              :key="dayIndex"
              class="flex flex-col items-center"
            >
              <!-- Light indicator -->
              <div
                class="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
                :class="getLightClass(day)"
              ></div>
              <!-- Day number -->
              <span
                class="text-[10px] mt-0.5"
                :class="day.isCurrentMonth ? 'text-gray-600' : 'text-gray-300'"
              >
                {{ day.dayOfMonth }}
              </span>
            </div>
          </div>
        </template>
      </template>
    </div>

    <!-- Loading indicator -->
    <div v-if="loading" class="flex justify-center py-4">
      <ElementLoadingSpinner size="sm" />
    </div>

    <!-- Infinite scroll sentinel -->
    <div ref="sentinelRef" class="h-4"></div>
  </div>
</template>

<script lang="ts" setup>
import type { Press, CalendarMonth, CalendarDay } from "~/types";

interface Props {
  presses: Press[];
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
});

const emit = defineEmits<{
  loadMore: [];
}>();

const containerRef = ref<HTMLElement | null>(null);
const sentinelRef = ref<HTMLElement | null>(null);

const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];

// Create a Set of press dates for quick lookup (YYYY-MM-DD format)
const pressDateSet = computed(() => {
  const set = new Set<string>();
  for (const press of props.presses) {
    const date = press.timestamp instanceof Date ? press.timestamp : new Date(press.timestamp);
    set.add(formatDateKey(date));
  }
  return set;
});

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Find the date range from presses
const dateRange = computed(() => {
  if (props.presses.length === 0) {
    const today = new Date();
    return { start: today, end: today };
  }

  const dates = props.presses.map((p) =>
    p.timestamp instanceof Date ? p.timestamp : new Date(p.timestamp)
  );
  const sorted = dates.sort((a, b) => a.getTime() - b.getTime());
  return { start: sorted[0]!, end: sorted[sorted.length - 1]! };
});

// Generate months from earliest press to today
const visibleMonths = computed<CalendarMonth[]>(() => {
  const months: CalendarMonth[] = [];
  const today = new Date();
  const startDate = props.presses.length > 0 ? dateRange.value.start : today;

  // Start from the month of the first press
  let currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  while (currentDate <= endDate) {
    months.push(generateMonth(currentDate.getFullYear(), currentDate.getMonth()));
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  }

  return months;
});

function generateMonth(year: number, month: number): CalendarMonth {
  const weeks: CalendarDay[][] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDayOfWeek = firstDay.getDay();

  let currentWeek: CalendarDay[] = [];

  // Fill in days from previous month
  if (startDayOfWeek > 0) {
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const day = prevMonthLastDay - i;
      const date = new Date(year, month - 1, day);
      currentWeek.push({
        date,
        dayOfMonth: day,
        hasPress: pressDateSet.value.has(formatDateKey(date)),
        isCurrentMonth: false,
      });
    }
  }

  // Fill in days of current month
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month, day);
    currentWeek.push({
      date,
      dayOfMonth: day,
      hasPress: pressDateSet.value.has(formatDateKey(date)),
      isCurrentMonth: true,
    });

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  // Fill in days from next month
  if (currentWeek.length > 0) {
    let nextMonthDay = 1;
    while (currentWeek.length < 7) {
      const date = new Date(year, month + 1, nextMonthDay);
      currentWeek.push({
        date,
        dayOfMonth: nextMonthDay,
        hasPress: pressDateSet.value.has(formatDateKey(date)),
        isCurrentMonth: false,
      });
      nextMonthDay++;
    }
    weeks.push(currentWeek);
  }

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  return {
    year,
    month,
    label: monthNames[month]!,
    weeks: weeks.map((days) => ({ days })),
  };
}

function getLightClass(day: CalendarDay): string {
  if (!day.isCurrentMonth) {
    return day.hasPress
      ? "bg-green-200"
      : "bg-gray-100";
  }
  return day.hasPress
    ? "bg-green-500 shadow-sm shadow-green-300"
    : "bg-gray-200";
}

// Infinite scroll with Intersection Observer
onMounted(() => {
  if (!sentinelRef.value) return;

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !props.loading) {
        emit("loadMore");
      }
    },
    { threshold: 0.1 }
  );

  observer.observe(sentinelRef.value);

  onUnmounted(() => {
    observer.disconnect();
  });
});
</script>

<style scoped>
.streak-calendar {
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}
</style>
