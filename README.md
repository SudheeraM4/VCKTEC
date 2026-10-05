# VCKTEC website and ESP32 talking robot

This repository contains the responsive public website for Vidyartha College Kandy Technology Society (VCKTEC), plus the original ESP32 talking-robot firmware in `src/`.

## Website structure

```text
index.html                 Home and previews of events, albums, and VCKTEC Weekly
events.html                Upcoming and past event listings
event.html                 Full event details and its archive link
gallery.html               Public event and society albums
album.html                 Full-size photo and video album viewer
weekly.html                Technology stories, tags, and linked sources
board.html                 Public society leadership profiles
about.html                 Society introduction and values
login.html                 Firebase member sign-in and registration
admin.html                 Tabbed member portal and content manager
assets/
  css/style.css            Responsive custom styling
  images/school-logo.jpg   Supplied Vidyartha College crest
  images/society-logo.jpg  Supplied VCKTEC emblem
  js/app.js                Public Firestore content, detail pages, and media viewer
  js/auth.js               Firebase sign-in, registration, and membership-state handling
  js/admin.js              Event, album, Weekly, board, suggestion, and membership management
  js/firebase.js           Firebase web-app configuration
firestore.rules            Firestore access controls
storage.rules              Photo upload and storage access controls
```

The dashboard has separate tabs for event publishing, the gallery, VCKTEC Weekly posts, board profiles, and member reviews. Event and Weekly forms include upload previews before publishing. Gallery managers can add batches of photos/videos to an album and optionally link them to an event. Owners alone can change board profiles; presidents and owners can manage the other public content. Images are limited to 8 MB each and videos to 50 MB each.

## Configure Firebase

1. Create a Firebase project and register a Web app. Copy its web-app configuration into `assets/js/firebase.js`. These Firebase web configuration values are identifiers, not administrative credentials; never put a service-account key in this static site.
2. In Firebase Authentication, enable the **Email/Password** provider.
3. Create a **Cloud Firestore** database and publish the rules in `firestore.rules`.
4. Set up **Firebase Storage** and publish the rules in `storage.rules`. Use the exact storage bucket value shown in the Firebase project settings for `storageBucket` in `assets/js/firebase.js`. Storage availability, free quotas, and billing requirements can change; check the Firebase console before enabling any paid plan.
5. Register the society owner's account through `login.html`. In Authentication → Users, copy that account's UID. In Firestore, create a document at `users/{OWNER_UID}` with these fields:

   ```text
   name:     owner's display name (string)
   email:    owner's sign-in email (string)
   role:     "owner" (string)
   approved: true (boolean)
   createdAt: current timestamp
   ```

   This one-time console setup makes the first owner without weakening public registration or letting users grant themselves privileges. After signing in, owners and presidents can approve registrations as members or presidents and change those roles in the dashboard.
6. Upload the site files to the repository's GitHub Pages source. A local HTTP server is required for testing because browser modules do not work reliably from a `file:` URL. For example, from the repository root run `python -m http.server 8000`, then open `http://localhost:8000`.

The public homepage, events, event details, gallery albums, Weekly posts, About page, and board profiles are available without signing in. New accounts start as **pending** and cannot use member tools until a society manager approves them. Owners and presidents can approve accounts and assign member/president roles, publish/edit events and Weekly posts, manage the gallery, and review suggestions. Only owners can add/edit/remove board profiles. Approved members can create event and photo suggestions. Firestore and Storage rules enforce these permissions—the dashboard's visibility checks are only the user interface.

Images uploaded through the site are limited to 8 MB. The society emblem and school crest supplied for this project are already in `assets/images/`.

## Original ESP32 firmware

The original firmware remains in `src/main.cpp`, with board settings in `platformio.ini`. Follow the existing sketch comments to configure the Wi-Fi and Gemini credentials locally before building; do not publish real credentials to GitHub.
