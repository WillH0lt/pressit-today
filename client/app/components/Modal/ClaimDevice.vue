<template>
  <UModal
    :close="{ onClick: () => emit('close') }"
    class="divide-y-0 w-xs"
    :ui="{ body: 'sm:pt-0 pt-0' }"
  >
    <template #body>
      <!-- Success state -->
      <div
        v-if="claimSuccess"
        class="flex flex-col w-full items-center gap-4 text-center"
      >
        <div class="text-4xl">&#127881;</div>
        <div class="font-bold text-lg">Device Claimed!</div>
        <div class="text-sm text-gray-600 px-4">
          Your device has been successfully linked to your account.
        </div>
        <div
          class="text-xs text-gray-500 font-mono bg-gray-100 px-3 py-1 rounded"
        >
          {{ claimedMac }}
        </div>
        <UButton @click="emit('close')" class="mt-2"> Done </UButton>
      </div>

      <!-- Claim form state -->
      <div v-else class="flex flex-col w-full items-center gap-4">
        <div class="font-bold">Link Your Device</div>
        <div class="text-sm text-gray-600 text-center px-2">
          Enter the 10-character claim code shown on your device after WiFi
          setup.
        </div>

        <UForm
          :schema="schema"
          :state="state"
          class="space-y-4 w-full"
          @submit="handleClaim"
        >
          <UFormField
            name="claimCode"
            :ui="{
              error: 'text-xs ml-2',
            }"
          >
            <UInput
              class="w-full text-center font-mono text-xl tracking-widest uppercase"
              v-model="state.claimCode"
              placeholder="ABC123"
              maxlength="10"
              autocomplete="off"
            />
          </UFormField>

          <UButton
            class="cursor-pointer"
            type="submit"
            block
            :loading="isLoading"
            :disabled="isLoading"
          >
            {{ isLoading ? "Claiming..." : "Claim Device" }}
          </UButton>
        </UForm>
      </div>

      <div
        v-if="errorMessage"
        class="w-full text-center text-sm mt-2 text-error"
      >
        * {{ errorMessage }}
      </div>
    </template>
  </UModal>
</template>

<script lang="ts" setup>
import z from "zod";

const { claimDevice } = useFunctions();

const emit = defineEmits(["close", "claimed"]);

const errorMessage = ref("");
const claimSuccess = ref(false);
const claimedMac = ref("");
const isLoading = ref(false);

const schema = z.object({
  claimCode: z
    .string()
    .length(10, "Claim code must be 10 characters")
    .regex(/^[A-Z0-9]+$/i, "Claim code must be alphanumeric"),
});

const state = reactive({
  claimCode: "",
});

async function handleClaim() {
  errorMessage.value = "";
  isLoading.value = true;

  try {
    const result = await claimDevice({
      claimCode: state.claimCode.toUpperCase(),
    });
    claimedMac.value = result.data.macAddress;
    claimSuccess.value = true;
    emit("claimed", result.data);
  } catch (err: any) {
    console.error(err);
    // Firebase callable function errors have a 'code' and 'message' property
    const code = err.code || "";
    if (code.includes("not-found")) {
      errorMessage.value = "Invalid claim code. Please check and try again.";
    } else if (code.includes("already-exists")) {
      errorMessage.value = "You have already claimed this device.";
    } else if (code.includes("permission-denied")) {
      errorMessage.value =
        "This device has already been claimed by another user.";
    } else {
      errorMessage.value =
        err.message || "An error occurred. Please try again.";
    }
  } finally {
    isLoading.value = false;
  }
}
</script>
