"""Shared helpers for working with LLM replies."""


def content_text(message) -> str:
    """
    Flatten an LLM reply to plain text.

    Gemini 3 models are thinking models: LangChain surfaces `.content` as a
    list of blocks (reasoning signatures alongside the answer) instead of the
    plain string the 2.x models returned. Calling `.strip()` on that list is
    a TypeError, so every read of `.content` goes through here.
    """
    content = getattr(message, "content", message)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and "text" in block:
                parts.append(block["text"])
        return "".join(parts)
    return str(content)
