# 🖼️ Virtual IIIF Exhibition

A lightweight, modern Single Page Application (SPA) for showcasing high-resolution IIIF (International Image Interoperability Framework) images in immersive, full-screen virtual exhibitions.

---

## 📖 About the Project

This software allows GLAM (Galleries, Libraries, Archives, and Museums) institutions or individual curators to easily create and present digital exhibitions. It was originally built with the ETH Library's collections in mind but is easily adaptable.

Instead of a traditional scrolling gallery, this app uses a "Prezi-style" interface. It dynamically loads high-resolution IIIF images and utilizes smooth, cinematic panning and zooming animations to transition between different exhibit items or detailed regions of a single image.

**Key Technologies:**
- **Frontend**: Vanilla JavaScript (ES modules), HTML5, CSS3, modern History API (for SPA routing).
- **Backend & Hosting**: Firebase (Firestore Database, Authentication, Hosting).
- **Image Serving**: IIIF Image API and Presentation API (v2 and v3 support).

---

## ✨ Features Overview

### 🌍 Public Viewer (`/`)
The main interface your visitors will see.

- **Immersive Experience**: Full-screen viewer with cinematic animations (Zoom In/Out, Pan).
- **Clean URLs**: Path-based routing (e.g. `/my-exhibition-slug`) allowing for easy sharing without full page reloads.
- **Interactive Info Panels**: Toggleable side panels displaying metadata like Title, Artist, Medium, and custom fields.
- **Responsive Overview Grid**: A visual gallery grid to quickly jump between different exhibits.
- **Auto-Hide UI**: Controls fade out automatically to let the images shine.
- **Landing Page**: Shows a beautiful, card-based overview of all currently published exhibitions.

### 🛡️ Administration Panel (`/admin`)
A secure interface to manage your content.

- **Secure Access**: Authenticated via Google Sign-In and a Firestore `admins` whitelist.
- **Exhibition Management**: Create, edit, publish/unpublish, and completely manage exhibitions. Customize cover images and accent colors.
- **Exhibit Items**: Add items to an exhibition, manage standard metadata, and define IIIF URLs.
- **Live Preview**: Instantly preview how an IIIF image will render directly inside the admin form.
- **Drag-and-Drop Ordering**: Easily reorder exhibits within an exhibition.

---

## 👩‍💻 Developer Guide: Getting Started

This guide explains how to set up the project from scratch, including Google Firebase infrastructure.

### Prerequisites
- [Node.js](https://nodejs.org/) installed
- A Google/Firebase account

### Step 1: Firebase Project Setup
This project relies on Firebase for database storage, authentication, and secure routing.
1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. Under the **Build** menu, enable **Firestore Database**. Choose to start in "Production mode" (we will deploy our own rules later).
3. Under the **Build** menu, enable **Authentication**. Click "Add new provider" and select **Google**. Save it.
4. Under the **Build** menu, enable **Hosting** (we will use this to route our clean URLs later).

### Step 2: Local Application Setup
1. Clone this repository to your local machine:
   ```bash
   git clone <your-repo-url>
   cd ethbib-virtual-exhibitions
   ```
2. Install the Firebase Command Line Interface (CLI):
   ```bash
   npm install -g firebase-tools
   ```
3. Log in to Firebase via the CLI:
   ```bash
   firebase login
   ```
4. Link the local repository to your newly created Firebase project:
   ```bash
   firebase use --add
   ```
   *(Select the project you created in Step 1 and give it an alias like "default")*

### Step 3: Application Configuration
Your frontend code needs to know how to connect to your specific Firebase project.
1. In the Firebase Console, go to **Project Settings** (gear icon) > General.
2. Scroll down to "Your apps" and add a new **Web app** (the `</>` icon).
3. Firebase will generate a `firebaseConfig` object. 
4. Open the file `js/firebase-config.js` in your local project and replace the existing `firebaseConfig` block with the one provided by Firebase. It should look something like this:
   ```javascript
   const firebaseConfig = {
       apiKey: "YOUR_API_KEY",
       authDomain: "your-project-id.firebaseapp.com",
       projectId: "your-project-id",
       storageBucket: "your-project-id.firebasestorage.app",
       messagingSenderId: "1234567890",
       appId: "1:123..:web:..."
   };
   ```

### Step 4: Minimal Database & Authorization Setup
To keep the application secure, the database rules prevent unauthorized edits. You need to manually whitelist your email address.

1. Open the **Firestore Database** in the Firebase Console.
2. Click **Start collection** and name it exactly `admins`.
3. For the **Document ID**, enter the exact Google email address you plan to log in with (e.g., `youremail@example.com`). Add a dummy field (e.g., `role`, type `string`, value `admin`). Save.

*(Your admin panel is now securely unlocked for your email address!)*

**To create a sample exhibition so you have something to look at:**
1. Still in Firestore, add a new collection named `exhibitions`.
2. Add a document with ID `sample-exhibition`. Add the following fields:
   - `title` (string): "Sample Exhibition"
   - `slug` (string): "sample-exhibition"
   - `is_published` (boolean): `true`
3. Add a new collection named `exhibit_items`.
4. Add a document with ID `sample-item-1`. Add the following fields:
   - `exhibition_id` (string): "sample-exhibition"
   - `iiif_url` (string): (Provide a valid IIIF info.json URL or Manifest, e.g., `https://www.e-rara.ch/i3f/v20/28108722/info.json`)
   - `title` (string): "First Sample Image"

### Step 5: Deploy
Now that everything is configured, push the Firestore security rules, index rules, and your application files to Google's servers.

```bash
firebase deploy
```

Once deployed, you can visit your live application URL provided by the CLI (e.g., `https://your-project-id.web.app`).

*(Note: For local development and testing without affecting the live database, you can run `firebase emulators:start`)*

---

## 📄 License
This project is licensed under the Apache License, Version 2.0. See the `LICENSE` file for full details.
