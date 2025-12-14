import {
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from "firebase/auth";

export const useEmailAuth = () => {
  const auth = useFirebaseAuth()!;

  async function sendMagicLink(
    email: string,
    redirectUrl: string = "/auth/verify"
  ) {
    // Store email in localStorage for later verification
    localStorage.setItem("emailForSignIn", email);

    const actionCodeSettings = {
      url: `${window.location.origin}${redirectUrl}`,
      handleCodeInApp: true,
    };

    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
  }

  async function signInWithMagicLink(url: string, email?: string) {
    if (!isSignInWithEmailLink(auth, url)) {
      throw new Error("Invalid sign-in link");
    }

    const userEmail = email || localStorage.getItem("emailForSignIn");

    if (!userEmail) {
      throw new Error("Email is required to complete sign-in");
    }

    return await signInWithEmailLink(auth, userEmail, url);
  }

  function isValidMagicLink(url: string) {
    return isSignInWithEmailLink(auth, url);
  }

  function getStoredEmail() {
    return localStorage.getItem("emailForSignIn");
  }

  function clearStoredEmail() {
    localStorage.removeItem("emailForSignIn");
  }

  return {
    sendMagicLink,
    signInWithMagicLink,
    isValidMagicLink,
    getStoredEmail,
    clearStoredEmail,
  };
};
