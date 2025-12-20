<template>
  <div class="w-full flex items-center justify-center">
    <div class="w-full max-w-xs text-center h-[430px]">
      <!-- <h1 class="text-xl font-bold text-white mb-2">Stats for Nerds</h1>
      <p class="text-sm text-gray-400">Just some numbers for the curious.</p> -->
      <!-- <p class="text-sm text-gray-400 mb-6">No pressure, just info.</p> -->

      <!-- Tabs -->
      <div class="flex justify-center mb-4">
        <div class="inline-flex rounded-lg bg-gray-800 p-1">
          <button
            :class="[
              'px-4 py-2 text-sm font-medium rounded-md transition-colors',
              activeTab === 'daily'
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-white',
            ]"
            @click="activeTab = 'daily'"
          >
            Daily
          </button>
          <button
            :class="[
              'px-4 py-2 text-sm font-medium rounded-md transition-colors',
              activeTab === 'weekly'
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-white',
            ]"
            @click="activeTab = 'weekly'"
          >
            Weekly
          </button>
        </div>
      </div>

      <!-- Weekly threshold dropdown -->
      <div
        v-if="activeTab === 'weekly'"
        class="text-sm text-gray-400 mb-4 text-center"
      >
        <p>A good week means I managed to</p>
        <p class="flex items-center justify-center gap-1 mt-2">
          <span>press the button on</span>
          <USelect
            v-model="pressesPerWeek"
            :items="pressesPerWeekItems"
            :content="{ bodyLock: false }"
            class="w-16 mx-1"
            variant="soft"
          />
          <span>{{ pressesPerWeek === 1 ? "day." : "days." }}</span>
        </p>
      </div>

      <!-- Daily Stats -->
      <div
        v-if="activeTab === 'daily'"
        class="rounded-lg divide-y divide-gray-700"
      >
        <div
          v-for="stat in stats"
          :key="stat.label"
          class="flex justify-between items-center px-4 py-3"
        >
          <span class="text-gray-400">{{ stat.label }}</span>
          <span class="text-white font-semibold">{{ stat.value }}</span>
        </div>
      </div>

      <!-- Weekly Stats -->
      <div v-else class="rounded-lg divide-y divide-gray-700">
        <div
          v-for="stat in weeklyStats"
          :key="stat.label"
          class="flex justify-between items-center px-4 py-3"
        >
          <span class="text-gray-400">{{ stat.label }}</span>
          <span class="text-white font-semibold">{{ stat.value }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { Press } from "~/types";

const props = defineProps<{
  presses: Press[];
}>();

const pressesPerWeek = defineModel<number>("pressesPerWeek", { default: 3 });

const activeTab = ref<"daily" | "weekly">("weekly");

const pressesPerWeekItems = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  label: String(n),
  value: n,
}));

const pressesRef = computed(() => props.presses);
const { stats, weeklyStats } = useStatistics(pressesRef, pressesPerWeek);
</script>
