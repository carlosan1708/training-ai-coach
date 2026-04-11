# Training AI Coach

**Live app: [ai-training-coach-6880b.web.app](https://ai-training-coach-6880b.web.app)**

A serverless, mobile-first personal health coach web app powered by Google Gemini and a LangGraph multi-agent backend. Upload your meal plans, log your workouts and body metrics, and chat with an AI that knows your full context.

---

## Features

- **Google Sign-In** with admin-controlled access approval
- **5-step onboarding** wizard capturing diet, exercise, health, and language preferences
- **Daily log** — weight, energy level (1–5), and free-form notes
- **Measurements tab** — two complementary types:
  - Body composition analyzer report upload (Fitdays, InBody, Tanita, Withings, etc.) → AI extracts all BIA data, segmental analysis, body score, metabolic age, and weight control targets
  - Manual tape measurements (waist, chest, hips, arms, thighs)
- **Exercise log** — log sets/reps/weight per exercise; take a photo of your gym whiteboard or handwritten notes → Gemini reads it and pre-fills the entries
- **Meal plans** — upload PDF, DOC, DOCX, JPG, or PNG; Gemini extracts the full nutrition structure (meals, macros, foods, portions, notes, supplements); expandable extraction preview on each card
- **AI chat** — LangGraph multi-agent coordinator routes each message to the right specialist:
  - Diet agent (meal plans, substitutions, portions)
  - Exercise agent (workout programming, form, progression)
  - Health analyst (weight trends, BIA analysis, BMI/TDEE)
  - General coach (motivation, app guidance)
- Every chat message is enriched with the user's active meal plan content and the last 7 days of logs
- **Bilingual** — full English and Spanish UI; AI responds in the language you choose
- **Admin panel** — approve or reject new users in real time

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + Material UI v7 |
| Hosting | Firebase Hosting |
| Backend | Firebase Cloud Functions — Python 3.12 |
| AI agent framework | LangGraph `StateGraph` |
| AI models | Gemini 2.0 Flash (routing, most agents) · Gemini 2.5 Pro (health analysis) |
| Database | Firebase Firestore |
| File storage | Firebase Storage |
| Auth | Firebase Auth — Google Sign-In only |
| State management | Zustand |
| i18n | i18next + react-i18next (English & Spanish) |

---

## Architecture

```
Browser (React + Vite + MUI)
        │
        │  Firebase SDK (Auth · Firestore · Storage · httpsCallable)
        │
Firebase Cloud Functions (Python 3.12)
        │
        ├── chat()
        │      └── LangGraph StateGraph
        │              ├── router      (gemini-2.0-flash — classifies intent)
        │              ├── diet        (gemini-2.0-flash)
        │              ├── exercise    (gemini-2.0-flash)
        │              ├── health      (gemini-2.5-pro)
        │              └── general     (gemini-2.0-flash)
        │
        ├── parse_exercise_photo()          — Gemini vision → structured exercise list
        ├── parse_body_composition_report() — Gemini vision → full BIA/composition data
        └── extract_meal_plan_content()     — Gemini vision → structured nutrition data
```

### Context injected into every chat

```
User Profile
  name · age · sex · height · goal weight
  dietary style · intolerances · dislikes · caloric target
  training goal · equipment · days/week · session length
  health notes · preferred units · coaching tone · language

Active Meal Plan (extracted_content from Firestore)
  plan name · dietary type · daily calories · macros
  full meal breakdown with foods and portions

Recent 7-day Logs
  weight · body fat % · energy level · notes
  body composition report (BIA data, segmental analysis)
  manual measurements (waist/chest/hips/arms/thighs)
  exercise log (exercises · sets · reps · weight)
```

---

## Data Model (Firestore)

```
user_status/{uid}
  { uid, email, displayName, status: "pending"|"approved"|"rejected" }

users/{uid}/profile/data
  { name, age, biological_sex, height_cm, goal_weight_kg,
    dietary_style, intolerances[], disliked_foods[], caloric_target,
    training_goal, equipment, training_days_per_week, session_length_min,
    movement_restrictions, health_notes, units,
    ui_language, response_language, coaching_tone, onboarding_complete }

users/{uid}/logs/{YYYY-MM-DD}
  { weight_kg, body_fat_pct, energy,
    measurements: { waist_cm, chest_cm, hips_cm, arms_cm, thighs_cm },
    body_composition_report: { source_app, body_fat_pct, skeletal_muscle_kg,
      bmi, visceral_fat_level, body_score, segmental_fat, segmental_muscle,
      bia, weight_control, ... },
    exercise_log: [{ exercise, sets, reps, weight_kg, duration_min, notes }],
    food_log: [{ meal, description, adherent, timestamp }],
    notes }

users/{uid}/meal_plans/{planId}
  { name, active, file_type, storage_path, download_url,
    extracted_content: { plan_name, dietary_type, daily_calories,
      macros: {protein_g, carbs_g, fat_g},
      meals: [{name, time, foods: [{name, portion, calories, ...}]}],
      notes[], supplements[] } }

users/{uid}/chat_sessions/{sessionId}
  { messages: [{ role, content, timestamp }], created_at, last_active }
```

---

## Project Structure

```
├── firebase.json
├── firestore.rules
├── storage.rules
│
├── functions/               # Python Cloud Functions
│   ├── main.py              # Function entry points
│   ├── requirements.txt
│   ├── agents/
│   │   ├── coordinator.py   # LangGraph StateGraph
│   │   └── state.py         # CoachState TypedDict
│   └── lib/
│       └── context.py       # Builds AI context from Firestore data
│
└── web/                     # React frontend
    ├── src/
    │   ├── firebase/        # config · auth · firestore · storage helpers
    │   ├── pages/
    │   │   ├── DashboardPage.tsx
    │   │   ├── ChatPage.tsx
    │   │   ├── MealPlansPage.tsx
    │   │   ├── LogPage.tsx  # tabbed container
    │   │   └── tabs/
    │   │       ├── DailyTab.tsx
    │   │       ├── MeasurementsTab.tsx
    │   │       └── ExerciseTab.tsx
    │   ├── store/           # Zustand stores (auth · profile · chat)
    │   ├── types/           # TypeScript interfaces
    │   ├── i18n/locales/    # en.json · es.json
    │   └── router/          # React Router v6 with protected routes
    └── vite.config.ts
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.12
- Firebase CLI: `npm install -g firebase-tools`
- A Firebase project with **Auth**, **Firestore**, **Storage**, **Hosting**, and **Functions** enabled
- A Google Gemini API key stored as a Firebase Secret named `GEMINI_API_KEY`

### 1. Clone and install

```bash
git clone https://github.com/your-username/Training-AI-Coach.git
cd Training-AI-Coach

# Frontend
cd web && npm install && cd ..

# Functions Python venv
cd functions
python -m venv venv
venv/Scripts/pip install -r requirements.txt   # Windows
# or: venv/bin/pip install -r requirements.txt  # macOS/Linux
cd ..
```

### 2. Configure environment

Create `web/.env.local`:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_ADMIN_UID=<your Firebase Auth UID>
```

### 3. Set the Gemini API key as a Firebase Secret

```bash
firebase secrets:set GEMINI_API_KEY
```

### 4. Update `firebase.json` storage bucket

In `firebase.json`, replace the storage bucket name with your project's bucket:

```json
"storage": {
  "bucket": "your-project-id.firebasestorage.app",
  "rules": "storage.rules"
}
```

### 5. Deploy

```bash
firebase login
npm run build --prefix web
firebase deploy
```

---

## Cloud Functions

| Function | Trigger | Description |
|---|---|---|
| `chat` | HTTPS callable | LangGraph multi-agent chat; fetches profile, active meal plan, and last 7 days of logs as context |
| `parse_exercise_photo` | HTTPS callable | Gemini vision extracts exercises (name, sets, reps, weight) from a photo |
| `parse_body_composition_report` | HTTPS callable | Gemini vision extracts full BIA data from analyzer app screenshots |
| `extract_meal_plan_content` | HTTPS callable | Gemini vision extracts structured nutrition data from meal plan PDFs and images |

---

## Security

- All Firestore reads/writes under `users/{uid}` are enforced to the authenticated owner
- `user_status` documents are owner-readable; only the admin UID can update them
- The admin UID is hardcoded in Firestore rules and set via `VITE_ADMIN_UID` — never stored in a client-readable collection
- The Gemini API key is a Firebase Secret — never bundled into the frontend
- Firebase Storage rules restrict file access to the owning user

---

## License

MIT
