import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db, isFirebaseConfigured } from "./firebase.js";

let latestAccess = null;
const accessListeners = new Set();

export function subscribeToAccess(listener) {
  accessListeners.add(listener);
  if (latestAccess) listener(latestAccess);
  return () => accessListeners.delete(listener);
}

function notifyAccess(access) {
  latestAccess = access;
  accessListeners.forEach((listener) => listener(access));
}

function setAuthMessage(message, isError = false) {
  const target = document.querySelector("#auth-message");
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("is-error", isError);
}

function setAuthBusy(form, isBusy) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = isBusy;
  button.setAttribute("aria-busy", String(isBusy));
}

function setupLoginForms() {
  const loginForm = document.querySelector("#login-form");
  const registerForm = document.querySelector("#register-form");
  if (!loginForm || !registerForm) return;

  const loginTab = document.querySelector("#login-tab");
  const registerTab = document.querySelector("#register-tab");
  const loginPanel = document.querySelector("#login-panel");
  const registerPanel = document.querySelector("#register-panel");

  function selectPanel(panelName) {
    const showLogin = panelName === "login";
    loginPanel.hidden = !showLogin;
    registerPanel.hidden = showLogin;
    loginTab.classList.toggle("is-active", showLogin);
    registerTab.classList.toggle("is-active", !showLogin);
    loginTab.setAttribute("aria-selected", String(showLogin));
    registerTab.setAttribute("aria-selected", String(!showLogin));
    setAuthMessage("");
  }
  loginTab.addEventListener("click", () => selectPanel("login"));
  registerTab.addEventListener("click", () => selectPanel("register"));

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!auth || !isFirebaseConfigured) return;
    setAuthBusy(loginForm, true);
    setAuthMessage("");
    const data = new FormData(loginForm);
    try {
      await signInWithEmailAndPassword(auth, String(data.get("email")).trim(), String(data.get("password")));
      window.location.assign("admin.html");
    } catch (error) {
      console.error("VCKTEC sign-in failed:", error);
      setAuthMessage(error.message || "Sign-in failed. Check your email and password.", true);
    } finally {
      setAuthBusy(loginForm, false);
    }
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!auth || !db || !isFirebaseConfigured) return;
    setAuthBusy(registerForm, true);
    setAuthMessage("");
    const data = new FormData(registerForm);
    const name = String(data.get("name")).trim();
    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        String(data.get("email")).trim(),
        String(data.get("password"))
      );
      await updateProfile(credential.user, { displayName: name });
      await setDoc(doc(db, "users", credential.user.uid), {
        name,
        email: credential.user.email,
        role: "pending",
        approved: false,
        createdAt: serverTimestamp()
      });
      await signOut(auth);
      registerForm.reset();
      selectPanel("login");
      setAuthMessage("Registration received. A society owner must approve your account before you can sign in.");
    } catch (error) {
      console.error("VCKTEC registration failed:", error);
      setAuthMessage(error.message || "Registration could not be completed. Please try again.", true);
    } finally {
      setAuthBusy(registerForm, false);
    }
  });
}

function setupLogout() {
  const button = document.querySelector("#logout-button");
  if (!button) return;
  button.addEventListener("click", async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      window.location.assign("login.html");
    } catch (error) {
      console.error("VCKTEC sign-out failed:", error);
      const target = document.querySelector("#dashboard-message");
      if (target) {
        target.textContent = "Sign out failed. Please try again.";
        target.classList.add("is-error");
      }
    }
  });
}

if (!isFirebaseConfigured) {
  const note = document.querySelector("#firebase-config-note");
  if (note) note.hidden = false;
  setAuthMessage("Firebase is not configured. Add your Firebase project settings before using the member portal.", true);
  notifyAccess({ user: null, profile: null, configured: false });
} else {
  setupLoginForms();
  setupLogout();
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      notifyAccess({ user: null, profile: null, configured: true });
      return;
    }
    try {
      const profileSnapshot = await getDoc(doc(db, "users", user.uid));
      const profile = profileSnapshot.exists() ? profileSnapshot.data() : null;
      notifyAccess({ user, profile, configured: true });
      if (document.querySelector("#login-form") && profile?.approved === true) {
        window.location.assign("admin.html");
      }
    } catch (error) {
      console.error("Could not verify the VCKTEC membership profile:", error);
      notifyAccess({ user, profile: null, configured: true, error });
    }
  });
}
