<template>
  <UModal
    :open="true"
    :close="{ onClick: () => emit('close', false) }"
    title="Delete your account?"
    description="This will permanently delete your account and all your data. This action cannot be undone."
    class="divide-y-0"
  >
    <template #footer>
      <div class="flex gap-2 w-full">
        <UButton
          class="ml-auto"
          variant="ghost"
          color="neutral"
          label="Cancel"
          @click="emit('close', false)"
        />
        <UButton
          variant="ghost"
          color="error"
          label="Delete Account"
          @click="emit('close', true)"
        />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
const emit = defineEmits<{ close: [boolean] }>();

onMounted(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      emit("close", true);
    }
  };

  document.addEventListener("keydown", handleKeyDown);

  onUnmounted(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });
});
</script>
