# Training AI Coach — Product Specification

## Overview

A serverless, mobile-first web application that acts as a personal health coach. It combines AI-powered document analysis with multi-agent intelligence to help the user follow Spanish meal plans, track body measurements and weight, and receive personalised exercise recommendations.

---

## Core Goals

1. Upload and understand Spanish meal plan documents (PDF, image, text).
2. Track weight, body measurements, and food adherence over time.
3. Receive AI-generated diet guidance aligned to the uploaded meal plans.
4. Receive AI-generated exercise recommendations based on user input and health data.
5. Get a holistic health analysis that connects diet, exercise, and measurement trends.
6. Personalise all AI responses using a rich user preference profile built during onboarding and editable at any time.

---

## Architecture

### Hosting & Serverless

- **Static frontend**: Firebase Hosting — CDN-backed, free tier, deployed via Firebase CLI.
- **Backend logic**: Firebase Cloud Functions (Python 3.12) — Gemini API key lives here, never exposed to the client.
- **Database**: Firebase Firestore (serverless, real-time, free tier generous).
- **File storage**: Firebase Storage for uploaded documents.
- **Authentication**: Firebase Auth — Google Sign-In only.
- **Single project**: Hosting, Functions, Firestore, Storage, and Auth all live under one Firebase project and one CLI (`firebase deploy`).

### AI Layer — Google Gemini via LangGraph

- **Models**: `gemini-2.0-flash` for routing and most agents; `gemini-2.5-pro` for deep health analysis.
- **Agent framework**: LangGraph `StateGraph` — Python-based multi-agent graph running in Cloud Functions.
- **Document understanding**: Gemini's multimodal API to parse uploaded meal plan PDFs and images directly — no OCR pre-processing needed.

---

## Authentication & Access Control

### Sign-In Flow
1. User lands on the splash screen with a single **Sign In with Google** button.
2. Google Sign-In popup authenticates the user via Firebase Auth.
3. On first sign-in, a `user_status` document is created with `status: "pending"`.
4. The user sees a **Pending Approval** screen until the admin approves them.
5. Once approved, if `onboarding_complete` is false the user goes through the onboarding wizard; otherwise straight to the dashboard.

### Admin Approval Mechanism
- Every new user starts with `status: "pending"` in the `user_status/{uid}` Firestore collection.
- The admin (identified by `VITE_ADMIN_UID` env variable and an `admins/{uid}` Firestore document) accesses `/admin` to approve or reject users.
- Approval is real-time — the user's session updates instantly via Firestore `onSnapshot`.
- The admin bypasses the approval check entirely.

| Status | User experience |
|--------|----------------|
| `pending` | "Awaiting Approval" screen |
| `rejected` | "Access Denied" screen |
| `approved` | Full app access |

### Onboarding Wizard (first-time only, skippable)
| Step | Fields collected |
|------|-----------------|
| 1 — About you | Name, age, biological sex, height, goal weight |
| 2 — Diet preferences | Dietary style, food intolerances/allergies, disliked foods, preferred cuisines, meal frequency, caloric target |
| 3 — Exercise preferences | Training goal, available equipment, training days per week, session length, injuries/restrictions |
| 4 — Health context | Health notes (optional), preferred units (kg/cm or lb/in) |
| 5 — Language & tone | UI language (English/Spanish), AI response language, coaching tone |

Users can skip any step and complete or edit preferences later in Settings.

---

## User Preference Profile

Stored in Firestore under `users/{uid}/profile/data` and automatically injected as system context into every agent call.

```
{
  name, age, biological_sex, height_cm, goal_weight_kg,
  dietary_style,           // "omnivore" | "vegetarian" | "vegan" | "other"
  intolerances: [],
  disliked_foods: [],
  preferred_cuisines: [],
  meals_per_day,
  caloric_target,          // number or "auto"
  training_goal,           // "fat_loss" | "muscle_gain" | "endurance" | "general"
  equipment,               // "none" | "home" | "gym"
  training_days_per_week,
  session_length_min,
  movement_restrictions,
  health_notes,
  units,                   // "metric" | "imperial"
  ui_language,             // "en" | "es"
  response_language,       // "en" | "es" | "both"
  coaching_tone,           // "motivational" | "clinical" | "friendly"
  onboarding_complete,
  created_at, updated_at
}
```

---

## Multi-Agent System (LangGraph)

Four nodes in a `StateGraph`. A router node classifies each message and directs it to the appropriate specialist. All agents receive the user preference profile as system context on every call.

### Graph Topology

```
User message
     │
     ▼
 [router]  ← gemini-2.0-flash classifies intent
     │
     ├── "diet"     → [diet_agent]     ← gemini-2.0-flash
     ├── "exercise" → [exercise_agent] ← gemini-2.0-flash
     ├── "health"   → [health_agent]   ← gemini-2.5-pro
     └── "general"  → [general_agent]  ← gemini-2.0-flash
```

### Agent 1 — Diet Coach (`diet`)
- Answer questions about meals, substitutions, portion sizes.
- Translate and explain Spanish nutritional terminology.
- Respect intolerances and disliked foods from the user profile.

### Agent 2 — Exercise Coach (`exercise`)
- Recommend workouts based on goals, equipment, and energy level.
- Provide form cues and alternatives.
- Track progression and suggest load increases.

### Agent 3 — Health Analyst (`health`)
- Analyse weight and measurement trends.
- Surface insights and flag anomalies.
- Calculate BMI/TDEE estimates using profile data.

### Agent 4 — General Coach (`general`)
- Motivation, general advice, app guidance.
- Fallback for anything that doesn't fit the three specialists.

### State
```python
class CoachState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    user_profile: dict
    intent: str | None   # "diet" | "exercise" | "health" | "general"
```

---

## Features

### Document Management *(Phase 2)*
- Upload meal plans as PDF, image (JPG/PNG), or plain text.
- Gemini multimodal API processes documents directly.
- Documents stored in Firebase Storage; extracted content cached in Firestore.
- Support multiple meal plans; mark one as "active".

### Daily Check-In
- Weight, mood/energy (1–5), notes.
- Food log and exercise log.
- All entries timestamped in Firestore under `users/{uid}/logs/{YYYY-MM-DD}`.

### Dashboard
- Today's weight vs. goal.
- Energy level from latest log.
- Quick links to Daily Log and Chat.

### AI Chat Interface
- Full-screen chat panel.
- User types naturally; LangGraph coordinator routes to the right agent.
- Chat history saved per session in Firestore.

### Measurement Tracking *(Phase 3)*
- Weight, body fat %, waist, chest, hips, arms, thighs.
- Line charts per metric over selectable time ranges.

### Exercise Recommendations *(Phase 3)*
- Structured workout plans saved and reused.
- Progression detection after repeated sessions.

---

## Internationalisation (i18n)

- **Library**: `i18next` + `react-i18next`.
- **Supported locales**: `en` (English) and `es` (Spanish).
- All UI labels stored in `/src/i18n/locales/en.json` and `es.json`.
- UI language stored in user profile and `localStorage`.
- AI responses follow `response_language` in the user profile independently of UI language.

---

## Data Model (Firestore)

```
user_status/{uid}
  { uid, email, displayName, status: "pending"|"approved"|"rejected", created_at, updated_at }

admins/{uid}
  { }   // document existence = admin privilege; not writable from client

users/{uid}/profile/data
  { ...UserProfile fields }

users/{uid}/logs/{YYYY-MM-DD}
  { weight_kg, measurements: {}, energy: 1-5, notes, food_log: [], exercise_log: [] }

users/{uid}/meal_plans/{planId}          // Phase 2
  { name, language, active, storage_path, extracted_content, created_at }

users/{uid}/chat_sessions/{sessionId}
  { messages: [], created_at, last_active }
```

---

## UI / UX

- **Framework**: React + Vite
- **Component library**: Material UI (MUI v7)
- **Mobile responsive**: Bottom navigation bar on mobile; permanent sidebar on desktop.
- **Charts**: Recharts
- **Language**: Full bilingual support — English and Spanish via `i18next`.

### Key Screens
| Screen | Description |
|--------|-------------|
| Splash / Landing | App intro with single "Sign In with Google" button |
| Pending Approval | Shown after first sign-in; updates in real-time when admin approves |
| Access Denied | Shown if admin rejects the account |
| Onboarding Wizard | 5-step preference setup shown once after first sign-in |
| Dashboard | Today's weight, energy, quick-action buttons |
| Daily Log | Weight, energy slider, notes |
| Chat | Full-screen AI coach chat with LangGraph multi-agent backend |
| Admin | User approval management (admin only) |
| Settings *(Phase 2)* | Edit profile, goals, units, language |
| Meal Plans *(Phase 2)* | Upload and manage meal plan documents |
| Progress *(Phase 3)* | Charts for weight and measurements |

---

## Security & Privacy

- All user data under `users/{uid}` — Firestore rules enforce per-user access only.
- `user_status/{uid}` — owner can read; only admin can update status.
- `admins/{uid}` — readable by authenticated users, not writable from client.
- Firebase Auth required before any read/write.
- Gemini API key stored as Firebase Secret — never exposed to the client.
- Documents stored in Firebase Storage with per-user security rules.

---

## Phased Delivery

### Phase 1 — Foundation ✅
- Firebase project setup (Auth, Firestore, Storage, Hosting, Functions).
- React + Vite + MUI scaffold deployed to Firebase Hosting.
- Google Sign-In only authentication.
- Admin approval mechanism with real-time status updates.
- Onboarding wizard — 5-step preference profile collection.
- i18next with English and Spanish locale files.
- Daily log form (weight, energy, notes).
- LangGraph multi-agent chat (router + diet, exercise, health, general agents).
- User preference profile injected into every agent call.

### Phase 2 — Document Intelligence
- Meal plan upload + Gemini multimodal parsing.
- Diet agent with meal plan context.
- Dashboard with today's meals and food log.
- Settings screen.

### Phase 3 — Exercise & Health Agents
- Measurement charts (Recharts).
- Exercise progression detection.
- Health analyst weekly summary.
- Full coordinator routing refinement.

### Phase 4 — Polish & Insights
- Automated weekly health summary.
- Offline support (PWA, service worker).
- Push notification reminders.

---

## Tech Stack Summary

| Layer | Choice |
|-------|--------|
| Frontend | React + Vite + Material UI (MUI v7) |
| Hosting | Firebase Hosting |
| Serverless functions | Firebase Cloud Functions (Python 3.12) |
| AI agent framework | LangGraph (`StateGraph`) |
| Database | Firebase Firestore |
| File storage | Firebase Storage |
| Auth | Firebase Auth — Google Sign-In only |
| i18n | i18next + react-i18next (English & Spanish) |
| AI models | Gemini 2.0 Flash (routing/agents) · Gemini 2.5 Pro (health analysis) |
| Charts | Recharts |
