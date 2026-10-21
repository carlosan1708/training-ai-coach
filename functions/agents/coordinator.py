"""
LangGraph multi-agent coordinator.

Graph topology:
  START → router → (diet | exercise | health | general) → END

The router classifies the user's message and sets state["intent"].
Each specialist node receives the full conversation history plus
the user-context system prompt and replies as that agent.
"""

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, START, END

from .state import CoachState, INTENTS
from lib.context import build_user_context
from lib.llm import content_text
from lib.quota import MAX_OUTPUT_TOKENS

# ─── Shared LLM factory ───────────────────────────────────────────────────────

# Mirrors GEMINI_MODEL in main.py; kept local to avoid importing the functions
# entry point (which would be circular).
FLASH_MODEL = "gemini-3.5-flash"
PRO_MODEL = "gemini-pro-latest"


def _make_llm(api_key: str, model: str = FLASH_MODEL) -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model=model, google_api_key=api_key, max_output_tokens=MAX_OUTPUT_TOKENS
    )


# ─── Node factories ──────────────────────────────────────────────────────────

def _router_node(llm: ChatGoogleGenerativeAI):
    """Classifies the latest user message into one of the INTENTS."""

    def node(state: CoachState) -> dict:
        last = next(
            (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)),
            ""
        )
        prompt = (
            "Classify this health coaching message into exactly one category.\n\n"
            f'Message: "{last}"\n\n'
            "Categories:\n"
            "- diet: food, meals, nutrition, meal plans, what to eat, recipes\n"
            "- exercise: workouts, training, gym, sets, reps, cardio, soreness\n"
            "- health: weight trends, body measurements, BMI, progress analysis\n"
            "- general: motivation, greetings, general advice, anything else\n\n"
            "Reply with ONLY one word: diet, exercise, health, or general"
        )
        response = llm.invoke([HumanMessage(content=prompt)])
        intent = content_text(response).strip().lower().split()[0]
        if intent not in INTENTS:
            intent = "general"
        return {"intent": intent}

    return node


def _agent_node(llm: ChatGoogleGenerativeAI, system_prompt: str):
    """
    Generic agent node. Prepends the user-context block and the
    agent-specific system prompt, then runs the full conversation.
    """

    def node(state: CoachState) -> dict:
        context = build_user_context(
            state.get("user_profile", {}),
            active_meal_plan=state.get("active_meal_plan", {}),
            recent_logs=state.get("recent_logs", []),
        )
        system = SystemMessage(content=f"{system_prompt}\n\n{context}")
        response = llm.invoke([system, *state["messages"]])
        return {"messages": [response]}

    return node


# ─── System prompts ───────────────────────────────────────────────────────────

_DIET_PROMPT = """\
You are the Diet Coach agent of a personal AI health coach app.
Your responsibilities:
- Answer questions about the user's meal plan, food choices, and nutrition.
- Suggest healthy substitutions that respect the user's intolerances and dislikes.
- Explain Spanish nutritional terminology when relevant.
- Provide portion-size guidance aligned to the user's caloric target.
- If the user has no uploaded meal plan yet, give general evidence-based dietary advice.
Keep responses concise and actionable."""

_EXERCISE_PROMPT = """\
You are the Exercise Coach agent of a personal AI health coach app.
Your responsibilities:
- Recommend workouts tailored to the user's goal, equipment, and available time.
- Provide exercise form cues and safe alternatives.
- Adapt around rest days, soreness, or injuries the user mentions.
- Track progression: if the user mentions doing the same workout repeatedly, suggest increasing load.
Keep responses concise and actionable."""

_HEALTH_PROMPT = """\
You are the Health Analyst agent of a personal AI health coach app.
Your responsibilities:
- Analyse weight and measurement trends from the data the user shares.
- Correlate diet adherence with weight change when data is available.
- Surface meaningful insights (plateaus, rapid changes, positive trends).
- Flag anything that warrants attention without being alarmist.
- Calculate BMI or TDEE estimates when asked, using the user's profile data.
Keep responses concise and data-driven."""

_GENERAL_PROMPT = """\
You are the AI Health Coach coordinator — a knowledgeable, supportive personal coach.
Your responsibilities:
- Answer general health, motivation, and lifestyle questions.
- Provide encouragement and help the user stay on track.
- Clarify how the app works when asked.
- Route implicitly: if the user's question clearly fits diet, exercise, or health,
  give a focused answer in that domain rather than a vague redirect.
Keep responses warm, concise, and actionable."""


# ─── Graph builder ────────────────────────────────────────────────────────────

def build_graph(api_key: str):
    """Build and compile the LangGraph coordinator graph."""
    llm_flash = _make_llm(api_key, FLASH_MODEL)
    llm_pro = _make_llm(api_key, PRO_MODEL)

    graph = StateGraph(CoachState)

    graph.add_node("router", _router_node(llm_flash))
    graph.add_node("diet",     _agent_node(llm_flash, _DIET_PROMPT))
    graph.add_node("exercise", _agent_node(llm_flash, _EXERCISE_PROMPT))
    graph.add_node("health",   _agent_node(llm_pro,   _HEALTH_PROMPT))
    graph.add_node("general",  _agent_node(llm_flash, _GENERAL_PROMPT))

    graph.add_edge(START, "router")
    graph.add_conditional_edges(
        "router",
        lambda state: state.get("intent", "general"),
        {intent: intent for intent in INTENTS},
    )
    for intent in INTENTS:
        graph.add_edge(intent, END)

    return graph.compile()
