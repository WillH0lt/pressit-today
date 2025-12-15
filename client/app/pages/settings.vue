<template>
  <div
    class="flex flex-col w-full min-h-screen items-center justify-center py-2 px-4"
  >
    <div class="w-full max-w-4xl flex flex-col">
      <div class="w-full h-full flex items-center justify-center">
        <div class="w-full max-w-xs text-center relative">
          <div class="hidden md:block absolute -right-28 -top-16">
            <NuxtLink
              to="/"
              class="flex flex-col items-center text-gray-400 hover:text-white transition-colors"
            >
              <UIcon name="i-lucide-x" class="text-5xl" />
              <span class="text-lg mt-1">esc</span>
            </NuxtLink>
          </div>
          <h1 class="text-xl font-bold text-white mb-6">Settings</h1>
          <div class="flex flex-col gap-3">
            <UButton
              block
              variant="soft"
              color="neutral"
              icon="i-lucide-trash-2"
              label="Clear All Presses"
              @click="handleClearPresses"
            />
            <UButton
              block
              variant="soft"
              color="neutral"
              icon="i-lucide-unlink"
              label="Unlink Device"
              @click="handleUnlinkDevice"
            />
            <UButton
              block
              variant="soft"
              color="neutral"
              icon="i-lucide-user-x"
              label="Delete Account"
              @click="handleDeleteAccount"
            />
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
import { signOut, deleteUser } from "firebase/auth";
import { doc } from "firebase/firestore";
import { onKeyStroke } from "@vueuse/core";
import {
  ModalClearPresses,
  ModalUnlinkDevice,
  ModalDeleteAccount,
} from "#components";

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

const auth = useFirebaseAuth()!;
const db = useFirestore();
const currentUser = useCurrentUser();
const toast = useToast();
const overlay = useOverlay();
const { unlinkDevice, clearPresses, deleteAccount } = useFunctions();

const clearPressesModal = overlay.create(ModalClearPresses);
const unlinkDeviceModal = overlay.create(ModalUnlinkDevice);
const deleteAccountModal = overlay.create(ModalDeleteAccount);

// Redirect if not logged in
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
    navigateTo("/");
  } catch (error: any) {
    toast.add({
      title: error.message || "Failed to unlink device",
      color: "error",
    });
  }
}

async function handleDeleteAccount() {
  const confirmed = await deleteAccountModal.open();
  if (!confirmed) return;

  try {
    await deleteAccount();
    // Sign out locally after server-side deletion
    await signOut(auth);
  } catch {
    // Ignore sign out errors - user may already be deleted
  }
  toast.add({ title: "Account deleted", color: "success" });
  navigateTo("/");
}
</script>
