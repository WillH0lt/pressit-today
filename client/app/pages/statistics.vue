<template>
  <div
    class="flex flex-col w-full min-h-screen items-center justify-center py-2 px-4"
  >
    <div class="w-full max-w-4xl flex flex-col">
      <div class="w-full h-full flex items-center justify-center">
        <div class="w-full max-w-xs text-center relative">
          <div class="hidden md:block absolute -right-28">
            <NuxtLink
              to="/"
              class="flex flex-col items-center text-gray-400 hover:text-white transition-colors"
            >
              <UIcon name="i-lucide-x" class="text-5xl" />
              <span class="text-lg mt-1">esc</span>
            </NuxtLink>
          </div>
          <h1 class="text-xl font-bold text-white mb-2">Stats for Nerds</h1>
          <p class="text-sm text-gray-400">
            Just some numbers for the curious.
          </p>
          <p class="text-sm text-gray-400 mb-6">No pressure, just info.</p>
          <div class="rounded-lg divide-y divide-gray-700">
            <div
              v-for="stat in stats"
              :key="stat.label"
              class="flex justify-between items-center px-4 py-3"
            >
              <span class="text-gray-400">{{ stat.label }}</span>
              <span class="text-white font-semibold">{{ stat.value }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="md:hidden absolute top-4 left-4">
      <UButton
        icon="i-lucide-arrow-left"
        variant="ghost"
        color="neutral"
        size="xl"
        to="/"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { doc } from "firebase/firestore";
import { onKeyStroke } from "@vueuse/core";

// Handle Escape key to navigate back
onKeyStroke("Escape", () => {
  navigateTo("/");
});

interface User {
  deviceId: string;
}

definePageMeta({
  colorMode: "dark",
});

const db = useFirestore();
const currentUser = useCurrentUser();

// Redirect if not logged in or no device
watchEffect(() => {
  if (currentUser.value === null) {
    navigateTo("/");
  }
});

// Watch user document to check if they have a device
const userDocRef = computed(() =>
  currentUser.value ? doc(db, "users", currentUser.value.uid) : null
);
const userDocument = useDocument<User>(userDocRef);

// Redirect if no device linked
watchEffect(() => {
  if (userDocument.value && !userDocument.value.deviceId) {
    navigateTo("/");
  }
});

// Load presses for the device
const deviceId = computed(() => userDocument.value?.deviceId);
const { presses } = usePresses(deviceId);

// Statistics
const pressesRef = computed(() => presses.value ?? []);
const { stats } = useStatistics(pressesRef);
</script>
