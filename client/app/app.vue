<template>
  <UApp :toaster="toaster">
    <NuxtPage :transition="{ name: 'page', mode: 'out-in' }" />
  </UApp>
</template>

<script lang="ts" setup>
const title = "pressit.today";
const description =
  "Will gave me this thing. It will end up in a closet some day soon, but for now, it's here.";

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
  twitterCard: "summary_large_image",
  robots: "noindex",
});

const toaster = {
  position: "top-center" as const,
};
</script>
