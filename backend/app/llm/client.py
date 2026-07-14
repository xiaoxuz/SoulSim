"""LLM 接入。基于 CAMEL ChatAgent，走 OpenAI 兼容格式，便于对接任意代理。"""
import json
import logging
import re
import time

from camel.agents import ChatAgent
from camel.models import ModelFactory
from camel.types import ModelPlatformType

from app.config import settings

logger = logging.getLogger(__name__)


def _build_model():
    return ModelFactory.create(
        model_platform=ModelPlatformType.OPENAI_COMPATIBLE_MODEL,
        model_type=settings.llm_model,
        url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model_config_dict={"temperature": 0.7},
    )


def complete(system_prompt: str, user_prompt: str, *, max_retries: int = 3) -> str:
    """单轮补全，返回纯文本。每次新建 agent，无跨调用记忆。
    LLM 上游偶发 400/5xx 时自动重试，避免单次故障导致整个构建失败。"""
    last_err: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            agent = ChatAgent(system_message=system_prompt, model=_build_model())
            resp = agent.step(user_prompt)
            return resp.msgs[0].content
        except Exception as e:
            last_err = e
            msg = str(e)[:200]
            logger.warning("[llm] complete failed attempt=%d/%d err=%s", attempt, max_retries, msg)
            if attempt < max_retries:
                time.sleep(2 * attempt)
    raise last_err


def complete_json(system_prompt: str, user_prompt: str) -> dict | list:
    """要求模型返回 JSON，容错解析（剥离 markdown 围栏、截取首个 JSON 块）。"""
    raw = complete(
        system_prompt + "\n\n只返回合法 JSON，不要任何解释文字或 markdown 围栏。",
        user_prompt,
    )
    return _parse_json(raw)


def _parse_json(raw: str) -> dict | list:
    text = raw.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"[\{\[]", text)
        if match:
            data, _ = json.JSONDecoder().raw_decode(text[match.start():].strip())
            return data
        raise
