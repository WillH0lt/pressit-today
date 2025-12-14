import { collection, query, orderBy } from "firebase/firestore";
import type { Press } from "~/types";

export const usePresses = (deviceId: Ref<string | null | undefined>) => {
  const db = useFirestore();

  const pressesQuery = computed(() => {
    if (!deviceId.value) return null;
    return query(
      collection(db, "devices", deviceId.value, "presses"),
      orderBy("pressedAt", "asc")
    );
  });

  const { data: presses, pending: loading } =
    useCollection<Press>(pressesQuery);

  return {
    presses,
    loading,
  };
};
