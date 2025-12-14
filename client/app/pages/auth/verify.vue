<template>
  <div class="min-h-screen flex items-center justify-center">
    <div class="max-w-md w-full space-y-8 p-6">
      <div class="text-center">
        <!-- Loading state -->

        <div v-if="isVerifying" class="space-y-4">
          <ElementLoadingSpinner class="mx-auto" size="xl" />
          <h2 class="text-2xl font-bold">Signing you in...</h2>
          <p>Please wait while we verify your email link.</p>
        </div>

        <!-- Email input state -->
        <div v-else-if="needsEmail" class="space-y-4">
          <h2 class="">Enter your email to continue</h2>
          <UForm
            :schema="schema"
            :state="state"
            class="space-y-4 w-full"
            @submit="continueWithEmail"
          >
            <UFormField
              name="email"
              :ui="{
                error: 'text-xs ml-2',
              }"
            >
              <UInput
                class="w-full"
                v-model="state.email"
                placeholder="Enter your email address"
              />
            </UFormField>

            <UButton class="cursor-pointer" type="submit" block>
              Continue
            </UButton>
          </UForm>
        </div>

        <!-- Success state -->
        <div v-else-if="isSuccess" class="space-y-4">
          <h2 class="text-2xl font-bold">Welcome!</h2>
          <p>You've been successfully signed in.</p>
          <p>Redirecting...</p>
        </div>

        <!-- Error state -->
        <div v-else-if="errorMessage" class="space-y-4">
          <h2 class="text-2xl font-bold">Sign-in failed</h2>
          <p class="text-error">{{ errorMessage }}</p>
          <div class="space-y-2">
            <UButton @click="tryAgain" variant="solid" color="primary" block>
              Try signing in again
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import z from "zod";
import type { FormSubmitEvent } from "@nuxt/ui";

import { AuthErrorText } from "~/constants";

definePageMeta({
  colorMode: "dark",
});

const { signInWithMagicLink, isValidMagicLink, getStoredEmail } =
  useEmailAuth();
const router = useRouter();

const isVerifying = ref(true);
const needsEmail = ref(false);
const isSuccess = ref(false);
const errorMessage = ref("");

const schema = z.object({
  email: z.email("Please enter a valid email address"),
});

type Schema = z.infer<typeof schema>;

const state = reactive({
  email: "",
});

async function verifyEmailLink(inputEmail?: string) {
  try {
    const url = window.location.href;

    const email = inputEmail ?? getStoredEmail();
    if (!email) {
      // No stored email, prompt user to enter it
      needsEmail.value = true;
      isVerifying.value = false;
      return;
    }

    // Check if this is a valid sign-in link
    if (!isValidMagicLink(url)) {
      throw new Error("Invalid sign-in link");
    }

    // Sign in the user with the email link
    await signInWithMagicLink(url, email);

    // Show success state
    isVerifying.value = false;
    isSuccess.value = true;

    // Redirect to dashboard or home after a short delay
    setTimeout(() => {
      router.replace("/");
    }, 2000);
  } catch (error: any) {
    console.error("Email link verification failed:", error);

    isVerifying.value = false;
    errorMessage.value =
      error.code in AuthErrorText
        ? AuthErrorText[error.code as keyof typeof AuthErrorText]
        : error.message ||
          "An error occurred during sign-in. Please try again.";
  }
}

function continueWithEmail(event: FormSubmitEvent<Schema>) {
  isVerifying.value = true;
  needsEmail.value = false;

  verifyEmailLink(event.data.email);
}

function tryAgain() {
  router.replace("/");
}

function goHome() {
  router.replace("/");
}

const auth = useFirebaseAuth()!;

verifyEmailLink();
</script>
