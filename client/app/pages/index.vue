<template>
  <div class="flex flex-col w-full min-h-screen items-center gap-6 py-8 px-4">
    <!-- Not logged in -->
    <template v-if="!currentUser">
      <div class="flex flex-col items-center justify-center flex-1 gap-6">
        <div class="text-2xl font-bold">Daily Streak Tracker</div>
        <div class="text-gray-600">
          Track your daily habits with a physical device
        </div>
        <UButton @click="loginModal.open()"> Login to Get Started </UButton>
      </div>
    </template>

    <!-- Logged in but no device -->
    <template v-else-if="!userDevice">
      <div class="flex flex-col items-center justify-center flex-1 gap-6">
        <div class="text-2xl font-bold">Welcome!</div>
        <div class="text-gray-600 text-center max-w-md">
          Link your Streak Tracker device to start tracking your daily habits.
        </div>
        <UButton @click="claimModal.open()"> Link Device </UButton>
        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          @click="signOut(auth)"
        >
          Sign Out
        </UButton>
      </div>
    </template>

    <!-- Logged in with device - Show streak calendar -->
    <template v-else>
      <div class="w-full max-w-md">
        <div class="flex items-center justify-between mb-6">
          <div>
            <div class="text-xl font-bold">Your Streaks</div>
            <div class="text-xs text-gray-400 font-mono">
              {{ userDevice.deviceMac }}
            </div>
          </div>
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click="signOut(auth)"
          >
            Sign Out
          </UButton>
        </div>

        <StreakCalendar :presses="presses ?? []" :loading="pressesLoading" />
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { signOut } from "firebase/auth";
import { doc } from "firebase/firestore";
import { ModalLogin, ModalClaimDevice, UButton } from "#components";

const overlay = useOverlay();
const loginModal = overlay.create(ModalLogin);
const claimModal = overlay.create(ModalClaimDevice);

const auth = useFirebaseAuth()!;
const db = useFirestore();
const currentUser = useCurrentUser();

// Watch user document to check if they have a device
const userDocRef = computed(() =>
  currentUser.value ? doc(db, "users", currentUser.value.uid) : null
);
const userDocument = useDocument(userDocRef);

const userDevice = computed(() => {
  if (!userDocument.data.value) return null;
  const data = userDocument.data.value;
  if (data.deviceMac) {
    return {
      deviceId: data.deviceId as string,
      deviceMac: data.deviceMac as string,
      deviceClaimedAt: data.deviceClaimedAt,
    };
  }
  return null;
});

// Load presses for the user
const userId = computed(() => currentUser.value?.uid ?? null);
const { presses, loading: pressesLoading } = usePresses(userId);

// Close login modal when user signs in
watch(
  currentUser,
  async (currUser) => {
    if (currUser) {
      loginModal.close();
    }
  },
  { immediate: true }
);

// Close claim modal when device is claimed
watch(userDevice, (device) => {
  if (device) {
    claimModal.close();
  }
});
</script>
