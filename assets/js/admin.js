import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";
import { subscribeToAccess } from "./auth.js";
import { db, isFirebaseConfigured, storage } from "./firebase.js";

const gate = document.querySelector("#dashboard-gate");
const dashboard = document.querySelector("#dashboard-content");
const dashboardMessage = document.querySelector("#dashboard-message");
const managerRoles = new Set(["owner", "president"]);
const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const videoTypes = ["video/mp4", "video/webm", "video/quicktime"];
let currentUser = null;
let currentProfile = null;
const previewUrls = new WeakMap();

function setMessage(message, isError = false) {
  dashboardMessage.textContent = message;
  dashboardMessage.classList.toggle("is-error", isError);
}

function showGate(title, copy, showLoginLink = false) {
  gate.hidden = false;
  dashboard.hidden = true;
  document.querySelector("#gate-title").textContent = title;
  document.querySelector("#gate-copy").textContent = copy;
  document.querySelector("#gate-link").hidden = !showLoginLink;
}

function escapeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || "upload";
}

function validateFile(file) {
  if (!file) throw new Error("Choose a file to upload.");
  const isImage = imageTypes.includes(file.type);
  const isVideo = videoTypes.includes(file.type);
  if (!isImage && !isVideo) throw new Error("Choose a JPG, PNG, WebP, GIF, MP4, WebM, or MOV file.");
  if (isImage && file.size > 8 * 1024 * 1024) throw new Error("Images must be smaller than 8 MB.");
  if (isVideo && file.size > 50 * 1024 * 1024) throw new Error("Videos must be smaller than 50 MB.");
}

function validateImage(file) {
  if (!file || !imageTypes.includes(file.type)) throw new Error("Choose a JPG, PNG, WebP, or GIF image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Images must be smaller than 8 MB.");
}

function makeEmptyNote(message) {
  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent = message;
  return note;
}

function makeButton(label, action, className = "mini-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function makeManagedItem(titleText, detailText) {
  const item = document.createElement("article");
  item.className = "managed-item";
  const copy = document.createElement("div");
  copy.className = "managed-item-copy";
  const title = document.createElement("strong");
  title.textContent = titleText;
  const detail = document.createElement("small");
  detail.textContent = detailText;
  copy.append(title, detail);
  const actions = document.createElement("div");
  actions.className = "managed-actions";
  item.append(copy, actions);
  return { item, actions };
}

function stringValue(formData, key) {
  return String(formData.get(key) || "").trim();
}

function tagsValue(value) {
  return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 10);
}

function formatDate(dateValue) {
  if (!dateValue) return "Date not set";
  const date = new Date(`${dateValue}T00:00:00`);
  return Number.isNaN(date.getTime()) ? dateValue : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function fileType(file) {
  return file.type.startsWith("video/") ? "video" : "image";
}

async function uploadAsset(file, folder) {
  validateFile(file);
  const uploadName = `${folder}-${Date.now()}-${escapeFileName(file.name)}`;
  const path = folder === "submissions"
    ? `submissions/${currentUser.uid}/${uploadName}`
    : `public/${currentUser.uid}/${uploadName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  try {
    return { url: await getDownloadURL(storageRef), path };
  } catch (error) {
    try { await deleteObject(storageRef); }
    catch (cleanupError) { console.error("Could not clean up an upload without a download URL:", cleanupError); }
    throw error;
  }
}

async function removeStoredAsset(path) {
  if (!path) return;
  await deleteObject(ref(storage, path));
}

function bindDashboardTabs(role) {
  const buttons = [...document.querySelectorAll(".dashboard-tab")];
  buttons.forEach((button) => {
    if (button.id === "tab-board") button.hidden = role !== "owner";
    button.addEventListener("click", () => {
      if (button.hidden) return;
      buttons.forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
        document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
      });
    });
  });
}

function bindPreview(input, target, multiple = false) {
  input.addEventListener("change", () => {
    (previewUrls.get(input) || []).forEach((url) => URL.revokeObjectURL(url));
    previewUrls.set(input, []);
    target.replaceChildren();
    const files = [...input.files || []];
    target.hidden = !files.length;
    if (!files.length) return;
    const list = multiple ? files : files.slice(0, 1);
    list.forEach((file) => {
      const url = URL.createObjectURL(file);
      previewUrls.get(input).push(url);
      const media = document.createElement(fileType(file) === "video" ? "video" : "img");
      media.src = url;
      if (media.tagName === "VIDEO") {
        media.muted = true;
        media.playsInline = true;
      } else media.alt = `Preview of ${file.name}`;
      target.append(media);
    });
  });
}

function clearFormPreview(formId, inputName, previewId) {
  const input = document.querySelector(`#${formId} [name="${inputName}"]`);
  const preview = document.querySelector(`#${previewId}`);
  (previewUrls.get(input) || []).forEach((url) => URL.revokeObjectURL(url));
  previewUrls.delete(input);
  input.value = "";
  preview.replaceChildren();
  preview.hidden = true;
}

function bindSuggestionForms() {
  const eventForm = document.querySelector("#event-suggestion-form");
  eventForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await addDoc(collection(db, "eventSuggestions"), {
        title: stringValue(data, "title"),
        date: stringValue(data, "date"),
        time: stringValue(data, "time"),
        description: stringValue(data, "description"),
        submittedBy: currentUser.uid,
        status: "pending",
        createdAt: serverTimestamp()
      });
      form.reset();
      setMessage("Your event idea has been sent to the society team.");
      await loadSuggestions();
    } catch (error) {
      console.error("Could not submit the event suggestion:", error);
      setMessage(error.message || "The event suggestion could not be sent.", true);
    }
  });
  const photoForm = document.querySelector("#photo-suggestion-form");
  photoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    let upload;
    try {
      validateImage(data.get("photo"));
      upload = await uploadAsset(data.get("photo"), "submissions");
      await addDoc(collection(db, "photoSuggestions"), {
        album: stringValue(data, "album"),
        caption: stringValue(data, "caption"),
        imageUrl: upload.url,
        storagePath: upload.path,
        submittedBy: currentUser.uid,
        status: "pending",
        createdAt: serverTimestamp()
      });
      form.reset();
      setMessage("Your photo has been sent for review.");
      await loadSuggestions();
    } catch (error) {
      if (upload) {
        try { await removeStoredAsset(upload.path); }
        catch (cleanupError) { console.error("Could not clean up an unpublished suggestion photo:", cleanupError); }
      }
      console.error("Could not submit the photo suggestion:", error);
      setMessage(error.message || "The photo suggestion could not be sent.", true);
    }
  });
}

function readEventForm(form) {
  const data = new FormData(form);
  return {
    title: stringValue(data, "title"),
    topic: stringValue(data, "topic"),
    venue: stringValue(data, "venue"),
    date: stringValue(data, "date"),
    time: stringValue(data, "time"),
    endDate: stringValue(data, "endDate"),
    endTime: stringValue(data, "endTime"),
    description: stringValue(data, "description"),
    tags: tagsValue(stringValue(data, "tags"))
  };
}

function resetEventForm() {
  const form = document.querySelector("#event-form");
  form.reset();
  form.elements.eventId.value = "";
  form.elements.previousCoverPath.value = "";
  document.querySelector("#event-form-heading").textContent = "Create an event.";
  document.querySelector("#cancel-event-edit").hidden = true;
  clearFormPreview("event-form", "cover", "event-cover-preview");
}

async function saveEvent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const eventId = stringValue(data, "eventId");
  const cover = data.get("cover");
  let uploaded = null;
  let saved = false;
  try {
    if (cover?.size) {
      validateImage(cover);
      uploaded = await uploadAsset(cover, "event-covers");
    } else if (!eventId) throw new Error("Choose a cover image for the new event.");
    const eventData = readEventForm(form);
    if (uploaded) {
      eventData.coverImageUrl = uploaded.url;
      eventData.coverStoragePath = uploaded.path;
    }
    if (eventId) {
      eventData.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "events", eventId), eventData);
      saved = true;
      const previousPath = stringValue(data, "previousCoverPath");
      if (uploaded && previousPath) {
        try { await removeStoredAsset(previousPath); }
        catch (error) { console.error("Could not remove the replaced event cover:", error); }
      }
      setMessage("Event details updated.");
    } else {
      eventData.createdAt = serverTimestamp();
      await addDoc(collection(db, "events"), eventData);
      saved = true;
      setMessage("Event published.");
    }
    resetEventForm();
    await loadEvents();
  } catch (error) {
    if (uploaded && !saved) {
      try { await removeStoredAsset(uploaded.path); }
      catch (cleanupError) { console.error("Could not clean up an unpublished event cover:", cleanupError); }
    }
    console.error("Could not save the VCKTEC event:", error);
    setMessage(error.message || "The event could not be saved.", true);
  }
}

function editEvent(id, data) {
  const form = document.querySelector("#event-form");
  form.elements.eventId.value = id;
  form.elements.previousCoverPath.value = data.coverStoragePath || "";
  for (const key of ["title", "topic", "venue", "date", "time", "endDate", "endTime", "description"]) {
    form.elements[key].value = data[key] || "";
  }
  form.elements.tags.value = Array.isArray(data.tags) ? data.tags.join(", ") : "";
  const preview = document.querySelector("#event-cover-preview");
  preview.replaceChildren();
  if (data.coverImageUrl) {
    const image = document.createElement("img");
    image.src = data.coverImageUrl;
    image.alt = "Current event cover";
    preview.append(image);
    preview.hidden = false;
  } else preview.hidden = true;
  document.querySelector("#event-form-heading").textContent = "Edit this event.";
  document.querySelector("#cancel-event-edit").hidden = false;
  document.querySelector("#tab-events").click();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderEventManagerItem(entry) {
  const { id, ...data } = entry;
  const detail = `${formatDate(data.date)} · ${data.time || "Time not set"}${data.venue ? ` · ${data.venue}` : ""}`;
  const { item, actions } = makeManagedItem(data.title || "VCKTEC event", detail);
  if (data.coverImageUrl) {
    const image = document.createElement("img");
    image.className = "managed-thumbnail";
    image.src = data.coverImageUrl;
    image.alt = "";
    item.prepend(image);
  }
  actions.append(makeButton("Edit", () => editEvent(id, data)));
  actions.append(makeButton("Delete", async () => {
    if (!window.confirm(`Delete “${data.title || "this event"}”?`)) return;
    try {
      await deleteDoc(doc(db, "events", id));
      if (data.coverStoragePath) {
        try { await removeStoredAsset(data.coverStoragePath); }
        catch (error) { console.error("Could not remove the event cover:", error); }
      }
      setMessage("Event deleted.");
      await loadEvents();
    } catch (error) {
      console.error("Could not delete the VCKTEC event:", error);
      setMessage(error.message || "The event could not be deleted.", true);
    }
  }, "mini-button danger"));
  return item;
}

async function loadEvents() {
  const container = document.querySelector("#managed-events");
  const eventSelect = document.querySelector('#gallery-form select[name="eventId"]');
  container.replaceChildren(makeEmptyNote("Loading events…"));
  const snapshot = await getDocs(query(collection(db, "events"), orderBy("date", "asc")));
  const events = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  container.replaceChildren();
  if (!events.length) container.append(makeEmptyNote("No events have been published yet."));
  events.forEach((entry) => container.append(renderEventManagerItem(entry)));
  const selected = eventSelect.value;
  eventSelect.replaceChildren(new Option("Standalone album", ""));
  events.forEach((event) => eventSelect.add(new Option(`${event.title} · ${formatDate(event.date)}`, event.id)));
  eventSelect.value = selected;
}

function mediaSrc(data) {
  return data.mediaUrl || data.imageUrl || data.videoUrl || "";
}

async function uploadGalleryFiles(form) {
  const data = new FormData(form);
  const files = [...form.elements.media.files];
  if (!files.length) throw new Error("Select at least one image or video.");
  if (files.length > 40) throw new Error("Upload no more than 40 items to an album at once.");
  files.forEach(validateFile);
  const album = stringValue(data, "album");
  const caption = stringValue(data, "caption");
  const eventId = stringValue(data, "eventId");
  const uploaded = [];
  try {
    for (const file of files) {
      const asset = await uploadAsset(file, "gallery");
      uploaded.push({ ...asset, file });
    }
    const batch = writeBatch(db);
    uploaded.forEach((asset) => {
      batch.set(doc(collection(db, "gallery")), {
        album,
        eventId,
        caption: caption || asset.file.name.replace(/\.[^.]+$/, ""),
        mediaUrl: asset.url,
        mediaType: fileType(asset.file),
        storagePath: asset.path,
        createdBy: currentUser.uid,
        createdAt: serverTimestamp()
      });
    });
    await batch.commit();
  } catch (error) {
    for (const asset of uploaded) {
      try { await removeStoredAsset(asset.path); }
      catch (cleanupError) { console.error("Could not clean up an unpublished gallery upload:", cleanupError); }
    }
    throw error;
  }
}

function renderMediaManagerItem(entry) {
  const { id, ...data } = entry;
  const detail = `${data.mediaType === "video" ? "Video" : "Photo"} · ${data.eventId ? "Linked to an event" : "Standalone album"} · ${data.caption || ""}`;
  const { item, actions } = makeManagedItem(data.album || "VCKTEC moments", detail);
  const url = mediaSrc(data);
  if (url) {
    const media = document.createElement(data.mediaType === "video" || data.videoUrl ? "video" : "img");
    media.className = "managed-thumbnail";
    media.src = url;
    if (media.tagName === "VIDEO") {
      media.muted = true;
      media.playsInline = true;
    } else media.alt = data.caption || "Gallery media";
    item.prepend(media);
  }
  actions.append(makeButton("Edit details", async () => {
    const album = window.prompt("Album name", data.album || "");
    if (album === null) return;
    const caption = window.prompt("Media caption", data.caption || "");
    if (caption === null) return;
    if (!album.trim()) {
      setMessage("Album name cannot be blank.", true);
      return;
    }
    try {
      await updateDoc(doc(db, "gallery", id), {
        album: album.trim(),
        caption: caption.trim(),
        updatedAt: serverTimestamp()
      });
      setMessage("Gallery media details updated.");
      await loadGallery();
    } catch (error) {
      console.error("Could not update the gallery media:", error);
      setMessage(error.message || "The gallery media details could not be updated.", true);
    }
  }));
  actions.append(makeButton("Delete", async () => {
    if (!window.confirm(`Remove this ${data.mediaType === "video" ? "video" : "photo"} from “${data.album || "the album"}”?`)) return;
    try {
      await deleteDoc(doc(db, "gallery", id));
      if (data.storagePath) {
        try { await removeStoredAsset(data.storagePath); }
        catch (error) { console.error("Could not remove the gallery file:", error); }
      }
      setMessage("Media removed from the gallery.");
      await loadGallery();
    } catch (error) {
      console.error("Could not delete the gallery media:", error);
      setMessage(error.message || "The media could not be deleted.", true);
    }
  }, "mini-button danger"));
  return item;
}

async function loadGallery() {
  const container = document.querySelector("#managed-photos");
  container.replaceChildren(makeEmptyNote("Loading published media…"));
  const snapshot = await getDocs(query(collection(db, "gallery"), orderBy("createdAt", "desc")));
  container.replaceChildren();
  if (snapshot.empty) container.append(makeEmptyNote("No photos or videos have been published yet."));
  snapshot.docs.forEach((entry) => container.append(renderMediaManagerItem({ id: entry.id, ...entry.data() })));
}

function resetWeeklyForm() {
  const form = document.querySelector("#weekly-form");
  form.reset();
  form.elements.postId.value = "";
  form.elements.previousImagePath.value = "";
  document.querySelector("#weekly-form-heading").textContent = "Write a Weekly post.";
  document.querySelector("#cancel-weekly-edit").hidden = true;
  clearFormPreview("weekly-form", "image", "weekly-image-preview");
}

async function saveWeeklyPost(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const postId = stringValue(data, "postId");
  const imageFile = data.get("image");
  const sources = stringValue(data, "sources").split(/\r?\n/).map((source) => source.trim()).filter(Boolean);
  let uploaded = null;
  let saved = false;
  try {
    if (!sources.length) throw new Error("Add at least one trusted source link.");
    const sourceUrls = sources.map((source) => {
      const url = new URL(source);
      if (url.protocol !== "https:") throw new Error("Use secure HTTPS links for all sources.");
      return url.href;
    });
    if (imageFile?.size) {
      validateImage(imageFile);
      uploaded = await uploadAsset(imageFile, "weekly");
    } else if (!postId) throw new Error("Choose a cover image for the new post.");

    const post = {
      title: stringValue(data, "title"),
      topic: stringValue(data, "topic"),
      excerpt: stringValue(data, "excerpt"),
      description: stringValue(data, "description"),
      tags: tagsValue(stringValue(data, "tags")),
      sourceUrl: sourceUrls[0],
      sources: sourceUrls
    };
    if (uploaded) {
      post.imageUrl = uploaded.url;
      post.imageStoragePath = uploaded.path;
    }
    if (postId) {
      post.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "weeklyPosts", postId), post);
      saved = true;
      const oldPath = stringValue(data, "previousImagePath");
      if (uploaded && oldPath) {
        try { await removeStoredAsset(oldPath); }
        catch (error) { console.error("Could not remove the replaced Weekly cover:", error); }
      }
      setMessage("Weekly post updated.");
    } else {
      post.createdAt = serverTimestamp();
      post.publishedAt = new Date().toISOString().slice(0, 10);
      post.createdBy = currentUser.uid;
      await addDoc(collection(db, "weeklyPosts"), post);
      saved = true;
      setMessage("Weekly post published.");
    }
    resetWeeklyForm();
    await loadWeeklyPosts();
  } catch (error) {
    if (uploaded && !saved) {
      try { await removeStoredAsset(uploaded.path); }
      catch (cleanupError) { console.error("Could not clean up an unpublished Weekly image:", cleanupError); }
    }
    console.error("Could not save the Weekly post:", error);
    setMessage(error.message || "The Weekly post could not be saved.", true);
  }
}

function editWeeklyPost(id, data) {
  const form = document.querySelector("#weekly-form");
  form.elements.postId.value = id;
  form.elements.previousImagePath.value = data.imageStoragePath || "";
  for (const key of ["title", "topic", "excerpt", "description"]) form.elements[key].value = data[key] || "";
  form.elements.sources.value = Array.isArray(data.sources) ? data.sources.join("\n") : (data.sourceUrl || "");
  form.elements.tags.value = Array.isArray(data.tags) ? data.tags.join(", ") : "";
  const preview = document.querySelector("#weekly-image-preview");
  preview.replaceChildren();
  if (data.imageUrl) {
    const image = document.createElement("img");
    image.src = data.imageUrl;
    image.alt = "Current Weekly post cover";
    preview.append(image);
    preview.hidden = false;
  } else preview.hidden = true;
  document.querySelector("#weekly-form-heading").textContent = "Edit Weekly post.";
  document.querySelector("#cancel-weekly-edit").hidden = false;
  document.querySelector("#tab-weekly").click();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadWeeklyPosts() {
  const container = document.querySelector("#managed-weekly");
  container.replaceChildren(makeEmptyNote("Loading Weekly posts…"));
  const snapshot = await getDocs(query(collection(db, "weeklyPosts"), orderBy("createdAt", "desc")));
  container.replaceChildren();
  if (snapshot.empty) container.append(makeEmptyNote("No Weekly posts have been published yet."));
  snapshot.docs.forEach((entry) => {
    const data = entry.data();
    const { item, actions } = makeManagedItem(data.title || "Weekly post", data.topic || "Technology");
    if (data.imageUrl) {
      const image = document.createElement("img");
      image.className = "managed-thumbnail";
      image.src = data.imageUrl;
      image.alt = "";
      item.prepend(image);
    }
    actions.append(makeButton("Edit", () => editWeeklyPost(entry.id, data)));
    actions.append(makeButton("Delete", async () => {
      if (!window.confirm(`Delete “${data.title || "this Weekly post"}”?`)) return;
      try {
        await deleteDoc(doc(db, "weeklyPosts", entry.id));
        if (data.imageStoragePath) {
          try { await removeStoredAsset(data.imageStoragePath); }
          catch (error) { console.error("Could not remove the Weekly cover image:", error); }
        }
        setMessage("Weekly post deleted.");
        await loadWeeklyPosts();
      } catch (error) {
        console.error("Could not delete the Weekly post:", error);
        setMessage(error.message || "The Weekly post could not be deleted.", true);
      }
    }, "mini-button danger"));
    container.append(item);
  });
}

function resetBoardForm() {
  const form = document.querySelector("#board-form");
  form.reset();
  form.elements.memberId.value = "";
  form.elements.previousImagePath.value = "";
  form.elements.order.value = "1";
  document.querySelector("#board-form-heading").textContent = "Introduce a board member.";
  document.querySelector("#cancel-board-edit").hidden = true;
  clearFormPreview("board-form", "image", "board-image-preview");
}

async function saveBoardProfile(event) {
  event.preventDefault();
  if (currentProfile.role !== "owner") {
    setMessage("Only the owner can manage board profiles.", true);
    return;
  }
  const form = event.currentTarget;
  const data = new FormData(form);
  const memberId = stringValue(data, "memberId");
  const imageFile = data.get("image");
  let uploaded = null;
  let saved = false;
  try {
    if (imageFile?.size) {
      validateImage(imageFile);
      uploaded = await uploadAsset(imageFile, "board");
    } else if (!memberId) throw new Error("Choose a portrait for the new board profile.");
    const profile = {
      name: stringValue(data, "name"),
      rank: stringValue(data, "rank"),
      bio: stringValue(data, "bio"),
      order: Number(data.get("order"))
    };
    if (!Number.isInteger(profile.order) || profile.order < 1 || profile.order > 100) throw new Error("Display order must be a number from 1 to 100.");
    if (uploaded) {
      profile.imageUrl = uploaded.url;
      profile.imageStoragePath = uploaded.path;
    }
    if (memberId) {
      profile.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "boardMembers", memberId), profile);
      saved = true;
      const previousPath = stringValue(data, "previousImagePath");
      if (uploaded && previousPath) {
        try { await removeStoredAsset(previousPath); }
        catch (error) { console.error("Could not remove the replaced board portrait:", error); }
      }
      setMessage("Board profile updated.");
    } else {
      profile.createdAt = serverTimestamp();
      profile.createdBy = currentUser.uid;
      await addDoc(collection(db, "boardMembers"), profile);
      saved = true;
      setMessage("Board profile added.");
    }
    resetBoardForm();
    await loadBoardProfiles();
  } catch (error) {
    if (uploaded && !saved) {
      try { await removeStoredAsset(uploaded.path); }
      catch (cleanupError) { console.error("Could not clean up an unpublished board portrait:", cleanupError); }
    }
    console.error("Could not save the board profile:", error);
    setMessage(error.message || "The board profile could not be saved.", true);
  }
}

function editBoardProfile(id, data) {
  const form = document.querySelector("#board-form");
  form.elements.memberId.value = id;
  form.elements.previousImagePath.value = data.imageStoragePath || "";
  form.elements.name.value = data.name || "";
  form.elements.rank.value = data.rank || "";
  form.elements.bio.value = data.bio || "";
  form.elements.order.value = String(data.order || 1);
  const preview = document.querySelector("#board-image-preview");
  preview.replaceChildren();
  if (data.imageUrl) {
    const image = document.createElement("img");
    image.src = data.imageUrl;
    image.alt = "Current board portrait";
    preview.append(image);
    preview.hidden = false;
  } else preview.hidden = true;
  document.querySelector("#board-form-heading").textContent = "Edit board profile.";
  document.querySelector("#cancel-board-edit").hidden = false;
  document.querySelector("#tab-board").click();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadBoardProfiles() {
  const container = document.querySelector("#managed-board");
  container.replaceChildren(makeEmptyNote("Loading board profiles…"));
  const snapshot = await getDocs(query(collection(db, "boardMembers"), orderBy("order", "asc")));
  container.replaceChildren();
  if (snapshot.empty) container.append(makeEmptyNote("No board profiles have been added yet."));
  snapshot.docs.forEach((entry) => {
    const data = entry.data();
    const { item, actions } = makeManagedItem(data.name || "Board member", `${data.rank || "Member"} · Display order ${data.order || 1}`);
    if (data.imageUrl) {
      const image = document.createElement("img");
      image.className = "managed-thumbnail";
      image.src = data.imageUrl;
      image.alt = "";
      item.prepend(image);
    }
    actions.append(makeButton("Edit", () => editBoardProfile(entry.id, data)));
    actions.append(makeButton("Delete", async () => {
      if (!window.confirm(`Remove ${data.name || "this board profile"} from the public board?`)) return;
      try {
        await deleteDoc(doc(db, "boardMembers", entry.id));
        if (data.imageStoragePath) {
          try { await removeStoredAsset(data.imageStoragePath); }
          catch (error) { console.error("Could not remove the board portrait:", error); }
        }
        setMessage("Board profile removed.");
        await loadBoardProfiles();
      } catch (error) {
        console.error("Could not delete the board profile:", error);
        setMessage(error.message || "The board profile could not be deleted.", true);
      }
    }, "mini-button danger"));
    container.append(item);
  });
}

async function loadUsers() {
  if (!managerRoles.has(currentProfile.role)) return;
  const pendingContainer = document.querySelector("#pending-members");
  const activeContainer = document.querySelector("#active-members");
  const usersSnapshot = await getDocs(collection(db, "users"));
  pendingContainer.replaceChildren();
  activeContainer.replaceChildren();
  const pending = [];
  const active = [];
  usersSnapshot.docs.forEach((userDoc) => {
    if (userDoc.id === currentUser.uid) return;
    const profile = userDoc.data();
    if (profile.role === "pending" || profile.approved !== true) pending.push({ id: userDoc.id, profile });
    else active.push({ id: userDoc.id, profile });
  });
  if (!pending.length) pendingContainer.append(makeEmptyNote("No membership requests to review."));
  pending.forEach(({ id, profile }) => {
    const { item, actions } = makeManagedItem(profile.name || profile.email || "New member", profile.email || "Email not available");
    actions.append(makeButton("Approve member", () => setMemberRole(id, "member")));
    actions.append(makeButton("Approve president", () => setMemberRole(id, "president")));
    pendingContainer.append(item);
  });
  if (!active.length) activeContainer.append(makeEmptyNote("No other approved members yet."));
  active.forEach(({ id, profile }) => {
    const { item, actions } = makeManagedItem(profile.name || profile.email || "Member", `${profile.email || "Email not available"} · ${profile.role}`);
    if (profile.role === "president") actions.append(makeButton("Set as member", () => setMemberRole(id, "member")));
    if (profile.role === "member") actions.append(makeButton("Make president", () => setMemberRole(id, "president")));
    activeContainer.append(item);
  });
}

async function setMemberRole(userId, role) {
  try {
    await updateDoc(doc(db, "users", userId), { role, approved: true });
    setMessage(`Membership role updated to ${role}.`);
    await loadUsers();
  } catch (error) {
    console.error("Could not update the VCKTEC member role:", error);
    setMessage(error.message || "The member role could not be updated.", true);
  }
}

async function reviewSuggestion(suggestion, suggestionId, type, approve) {
  const suggestionCollection = type === "event" ? "eventSuggestions" : "photoSuggestions";
  try {
    const batch = writeBatch(db);
    if (approve && type === "event") {
      batch.set(doc(collection(db, "events")), {
        title: suggestion.title,
        date: suggestion.date,
        time: suggestion.time,
        description: suggestion.description,
        createdAt: serverTimestamp(),
        suggestedBy: suggestion.submittedBy
      });
    }
    if (approve && type === "photo") {
      batch.set(doc(collection(db, "gallery")), {
        album: suggestion.album,
        caption: suggestion.caption,
        imageUrl: suggestion.imageUrl,
        mediaUrl: suggestion.imageUrl,
        mediaType: "image",
        storagePath: suggestion.storagePath,
        createdAt: serverTimestamp(),
        suggestedBy: suggestion.submittedBy
      });
    }
    batch.update(doc(db, suggestionCollection, suggestionId), {
      status: approve ? "approved" : "rejected",
      reviewedBy: currentUser.uid,
      reviewedAt: serverTimestamp()
    });
    await batch.commit();
    setMessage(`${type === "event" ? "Event" : "Photo"} suggestion ${approve ? "approved" : "declined"}.`);
    await loadSuggestions();
  } catch (error) {
    console.error(`Could not review the VCKTEC ${type} suggestion:`, error);
    setMessage(error.message || "The suggestion could not be reviewed.", true);
  }
}

async function loadSuggestionType(type) {
  const isEvent = type === "event";
  const name = isEvent ? "eventSuggestions" : "photoSuggestions";
  const container = document.querySelector(isEvent ? "#event-suggestions" : "#photo-suggestions");
  const snapshot = await getDocs(query(collection(db, name), where("status", "==", "pending")));
  container.replaceChildren();
  if (snapshot.empty) {
    container.append(makeEmptyNote("No pending suggestions."));
    return;
  }
  const suggestions = [...snapshot.docs].sort((first, second) => {
    const firstDate = first.data().createdAt;
    const secondDate = second.data().createdAt;
    const firstMillis = firstDate && typeof firstDate.toMillis === "function" ? firstDate.toMillis() : 0;
    const secondMillis = secondDate && typeof secondDate.toMillis === "function" ? secondDate.toMillis() : 0;
    return secondMillis - firstMillis;
  });
  suggestions.forEach((entry) => {
    const suggestion = entry.data();
    const title = isEvent ? suggestion.title : suggestion.album;
    const detail = isEvent
      ? `${formatDate(suggestion.date)} · ${suggestion.time || "Time not set"} · ${suggestion.description || ""}`
      : suggestion.caption || "Photo suggestion";
    const { item, actions } = makeManagedItem(title || "Community suggestion", detail);
    const photoUrl = suggestion.imageUrl || suggestion.mediaUrl;
    if (!isEvent && photoUrl) {
      const image = document.createElement("img");
      image.className = "managed-thumbnail";
      image.src = photoUrl;
      image.alt = suggestion.caption || "Suggested photo";
      item.prepend(image);
    }
    actions.append(makeButton("Approve", () => reviewSuggestion(suggestion, entry.id, type, true)));
    actions.append(makeButton("Decline", () => reviewSuggestion(suggestion, entry.id, type, false), "mini-button danger"));
    container.append(item);
  });
}

async function loadSuggestions() {
  if (!managerRoles.has(currentProfile.role)) return;
  await Promise.all([loadSuggestionType("event"), loadSuggestionType("photo")]);
}

function bindManagerForms() {
  const eventForm = document.querySelector("#event-form");
  eventForm.addEventListener("submit", saveEvent);
  document.querySelector("#cancel-event-edit").addEventListener("click", resetEventForm);
  document.querySelector("#gallery-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await uploadGalleryFiles(form);
      form.reset();
      document.querySelector("#gallery-preview").replaceChildren();
      document.querySelector("#gallery-preview").hidden = true;
      setMessage("Photos and videos added to the album.");
      await loadGallery();
    } catch (error) {
      console.error("Could not publish the gallery media:", error);
      setMessage(error.message || "The gallery media could not be published.", true);
    } finally {
      submit.disabled = false;
    }
  });
  const weeklyForm = document.querySelector("#weekly-form");
  weeklyForm.addEventListener("submit", saveWeeklyPost);
  document.querySelector("#cancel-weekly-edit").addEventListener("click", resetWeeklyForm);
  const boardForm = document.querySelector("#board-form");
  boardForm.addEventListener("submit", saveBoardProfile);
  document.querySelector("#cancel-board-edit").addEventListener("click", resetBoardForm);

  bindPreview(eventForm.elements.cover, document.querySelector("#event-cover-preview"));
  bindPreview(document.querySelector('#gallery-form [name="media"]'), document.querySelector("#gallery-preview"), true);
  bindPreview(weeklyForm.elements.image, document.querySelector("#weekly-image-preview"));
  bindPreview(boardForm.elements.image, document.querySelector("#board-image-preview"));
}

async function loadDashboardData() {
  try {
    await Promise.all([
      loadEvents(),
      loadGallery(),
      loadWeeklyPosts(),
      loadSuggestions(),
      loadUsers(),
      currentProfile.role === "owner" ? loadBoardProfiles() : Promise.resolve()
    ]);
  } catch (error) {
    console.error("Could not load the VCKTEC member dashboard:", error);
    setMessage(error.message || "Some dashboard information could not be loaded. Check Firestore rules and indexes.", true);
  }
}

function showDashboard(access) {
  if (!access.configured) {
    showGate("Firebase setup needed.", "Add your project credentials before the member portal can be used.");
    return;
  }
  if (!access.user) {
    showGate("Members, sign in to continue.", "This portal is for registered VCKTEC members. Public events and photos are available on the home page.", true);
    return;
  }
  if (access.error) {
    showGate("We couldn’t verify your account.", "Please check your connection and try signing in again.", true);
    return;
  }
  if (!access.profile || access.profile.approved !== true) {
    showGate("Your membership is awaiting approval.", "A society owner needs to review your registration before you can access member tools.");
    return;
  }
  currentUser = access.user;
  currentProfile = access.profile;
  gate.hidden = true;
  dashboard.hidden = false;
  document.querySelector("#welcome-line").textContent = `Signed in as ${access.profile.name || access.user.email}.`;
  document.querySelector("#role-badge").textContent = access.profile.role || "member";
  const isManager = managerRoles.has(access.profile.role);
  document.querySelector("#member-tools").hidden = isManager;
  document.querySelector("#manager-tools").hidden = !isManager;
  document.querySelector("#review-panel").hidden = !isManager;
  document.querySelectorAll(".owner-only").forEach((control) => {
    control.hidden = access.profile.role !== "owner";
  });
  if (isManager) {
    bindDashboardTabs(access.profile.role);
    bindManagerForms();
    loadDashboardData();
  } else bindSuggestionForms();
}

if (!isFirebaseConfigured) showDashboard({ configured: false });
else subscribeToAccess(showDashboard);
