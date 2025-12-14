import { collection, query, orderBy } from "firebase/firestore";
import type { Press } from "~/types";

export const usePresses = (userId: Ref<string | null>) => {
  const db = useFirestore();

  const pressesQuery = computed(() => {
    if (!userId.value) return null;
    return query(
      collection(db, "users", userId.value, "presses"),
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
