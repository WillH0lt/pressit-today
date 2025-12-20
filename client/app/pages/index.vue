<template>
  <div class="flex flex-col w-full min-h-screen">
    <!-- Header -->
    <Transition name="fade-up" appear>
      <div v-if="currentUser && !userDocPending" class="flex justify-end p-4">
        <UButton
          v-if="!userDocument?.deviceId"
          class="cursor-pointer"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="signOut(auth)"
        >
          Sign Out
        </UButton>
        <UDropdownMenu v-else :items="menuItems" :modal="false">
          <UButton
            icon="i-lucide-menu"
            variant="ghost"
            color="neutral"
            size="sm"
          />
        </UDropdownMenu>
      </div>
    </Transition>

    <!-- Content -->
    <div class="flex-1 flex items-center justify-center px-4 pb-8">
      <!-- Not logged in -->
      <Transition name="fade-up" appear>
        <div v-if="currentUser === null" class="w-full max-w-xs">
          <Login />
        </div>
      </Transition>

      <!-- Logged in but no device -->
      <Transition name="fade-up" appear>
        <div
          v-if="currentUser && !userDocPending && !userDocument?.deviceId"
          class="w-full max-w-xs"
        >
          <LinkDevice />
        </div>
      </Transition>

      <!-- Logged in with device - Show stats and streak calendar -->
      <Transition name="fade-up" appear>
        <div
          v-if="currentUser && !userDocPending && userDocument?.deviceId && !pressesLoading"
          class="w-full max-w-4xl flex flex-col gap-8"
        >
          <Statistics
            :presses="presses ?? []"
            v-model:presses-per-week="pressesPerWeek"
          />
          <StreakCalendar :presses="presses ?? []" />
        </div>
      </Transition>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { signOut } from "firebase/auth";
import { doc, Timestamp, updateDoc } from "firebase/firestore";

interface User {
  deviceClaimedAt: Timestamp;
  deviceId: string;
  pressesPerWeek?: number;
}

definePageMeta({
  colorMode: "dark",
});

const auth = useFirebaseAuth()!;
const db = useFirestore();
const currentUser = useCurrentUser();

// Watch user document to check if they have a device
const userDocRef = computed(() =>
  currentUser.value ? doc(db, "users", currentUser.value.uid) : null
);
const { data: userDocument, pending: userDocPending } =
  useDocument<User>(userDocRef);

// Load presses for the device
const deviceId = computed(() => userDocument.value?.deviceId);
const { presses, loading: pressesLoading } = usePresses(deviceId);

// Presses per week setting (synced with user document)
const pressesPerWeek = ref(userDocument.value?.pressesPerWeek ?? 3);

// Update local ref when user document loads
watch(
  () => userDocument.value?.pressesPerWeek,
  (newVal) => {
    if (newVal !== undefined) {
      pressesPerWeek.value = newVal;
    }
  }
);

// Save to Firestore when pressesPerWeek changes
watch(pressesPerWeek, async (newVal) => {
  if (userDocRef.value) {
    await updateDoc(userDocRef.value, { pressesPerWeek: newVal });
  }
});

// Menu items for dropdown
const menuItems = computed(() => {
  const items = [];

  if (userDocument.value?.deviceId) {
    items.push([
      {
        label: "Settings",
        icon: "i-lucide-settings",
        onSelect: () => navigateTo("/settings"),
      },
    ]);
  }

  items.push([
    {
      label: "Sign Out",
      icon: "i-lucide-log-out",
      onSelect: () => signOut(auth),
    },
  ]);

  return items;
});
</script>

<style scoped>
.fade-up-enter-active {
  transition: opacity 0.8s ease, transform 0.8s ease;
}

.fade-up-enter-from {
  opacity: 0;
  transform: translateY(16px);
}

.fade-up-enter-to {
  opacity: 1;
  transform: translateY(0);
}
</style>
