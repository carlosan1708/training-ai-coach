from typing import TypedDict, Annotated
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

# Intent categories the router can assign
INTENTS = ("diet", "exercise", "health", "general")

class CoachState(TypedDict):
    # Full conversation history — add_messages merges new messages in
    messages: Annotated[list[BaseMessage], add_messages]
    # Firestore user profile document fields
    user_profile: dict
    # Extracted content from the user's active meal plan (may be empty)
    active_meal_plan: dict
    # Last 7 days of daily log documents (weight, measurements, exercises, photo analysis)
    recent_logs: list
    # Set by the router node; drives conditional edge to the right agent
    intent: str | None
