<template>
  <div
    class="flex flex-col w-full min-h-screen items-center justify-center py-2 px-4"
  >
    <!-- Not logged in -->
    <template v-if="!currentUser">
      <div class="w-full max-w-xs">
        <Login />
      </div>
    </template>

    <!-- Logged in but no device -->
    <template v-else-if="!userDocument?.deviceId">
      <div class="w-full max-w-xs">
        <LinkDevice />
      </div>
      <div class="absolute top-4 right-4">
        <UButton
          class="cursor-pointer"
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
      <div class="w-full max-w-4xl flex flex-col">
        <StreakCalendar :presses="presses ?? []" />
      </div>

      <div class="absolute top-4 right-4">
        <UDropdownMenu :items="menuItems">
          <UButton
            icon="i-lucide-menu"
            variant="ghost"
            color="neutral"
            size="sm"
          />
        </UDropdownMenu>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { signOut } from "firebase/auth";
import { doc, Timestamp } from "firebase/firestore";
import { ModalClearPresses, ModalUnlinkDevice } from "#components";

interface User {
  deviceClaimedAt: Timestamp;
  deviceId: string;
}

definePageMeta({
  colorMode: "dark",
});

const auth = useFirebaseAuth()!;
const db = useFirestore();
const currentUser = useCurrentUser();
const toast = useToast();
const overlay = useOverlay();
const { unlinkDevice, clearPresses } = useFunctions();

const clearPressesModal = overlay.create(ModalClearPresses);
const unlinkDeviceModal = overlay.create(ModalUnlinkDevice);

// Watch user document to check if they have a device
const userDocRef = computed(() =>
  currentUser.value ? doc(db, "users", currentUser.value.uid) : null
);
const userDocument = useDocument<User>(userDocRef);

// Load presses for the device
const deviceId = computed(() => userDocument.value?.deviceId);
const { presses } = usePresses(deviceId);

// Menu items for dropdown
const menuItems = computed(() => {
  const items = [];

  if (userDocument.value?.deviceId) {
    items.push([
      {
        label: "Clear All",
        icon: "i-lucide-trash-2",
        onSelect: handleClearPresses,
      },
      {
        label: "Unlink Device",
        icon: "i-lucide-unlink",
        onSelect: handleUnlinkDevice,
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

async function handleClearPresses() {
  const confirmed = await clearPressesModal.open();
  if (!confirmed) return;

  try {
    await clearPresses();
    toast.add({ title: "All presses cleared", color: "success" });
  } catch (error: any) {
    toast.add({
      title: error.message || "Failed to clear presses",
      color: "error",
    });
  }
}

async function handleUnlinkDevice() {
  const confirmed = await unlinkDeviceModal.open();
  if (!confirmed) return;

  try {
    await unlinkDevice();
    toast.add({ title: "Device unlinked", color: "success" });
  } catch (error: any) {
    toast.add({
      title: error.message || "Failed to unlink device",
      color: "error",
    });
  }
}
</script>
