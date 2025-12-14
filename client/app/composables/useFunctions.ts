import { getFunctions, httpsCallable } from 'firebase/functions';

interface ClaimDeviceResponse {
  success: boolean;
  message: string;
  macAddress: string;
}

export const useFunctions = () => {
  const app = useFirebaseApp();
  const functions = getFunctions(app);

  const createPortalLink = httpsCallable(
    functions,
    'ext-firestore-stripe-payments-createPortalLink',
  );

  const claimDevice = httpsCallable<{ claimCode: string }, ClaimDeviceResponse>(
    functions,
    'claimDevice',
  );

  return {
    createPortalLink,
    claimDevice,
  };
};
