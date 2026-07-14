"""群聊 Agent：积极踊跃但不硬说，根据消息类型决定发言长度。

设计要点：
- 被 @ 点名必须发言，任何轮次
- 自然语言被提到时，注入 mentions_hint 让 LLM 倾向回应
- 简单统计/确认问题，只有符合条件的人才回应
- 听最新消息，不要把之前的话题硬拉进来
- 发言长度按消息类型决定：简单确认 1-5 字，一般 10-40 字，复杂最多 60 字
- 没话说时跳过，不为发言而发言
"""
import logging
import random
import re
from difflib import SequenceMatcher
from typing import Generator

from app.engine.actor import _build_soul_block
from app.llm import client
from app.repositories import store

logger = logging.getLogger(__name__)

_RELEVANCE_SYS = """你是模拟世界中的{agent_name}。现在群里在讨论，你要判断自己这一轮要不要发言。

=== 你的身份 ===
{soul_brief}

=== 你的活跃度 ===
{activity_hint}

=== 你的角色职责 ===
{role_hint}

【核心原则：像真实微信群，该说说、不该说不硬说】
你不是每次都必须发言。质量优先于数量。判断标准是：你对最新这条消息有没有真正要说的。
但只要你发言，必须提供新增内容：新的推理、新风险、新证据缺口、新行动分工、反对意见或更具体的下一步。

【简单问题识别 - 最重要】
先判断最新消息是什么类型。如果是简单统计、确认、点名（如"X的举个手"、"同意的+1"、"是X的回一下"、"男生打个卡"、"家长说两句"）：
- 先根据自己的身份/性别/角色判断是否符合条件
- 符合条件：必须发言，简短回应（1-5 字）
- 不符合条件：直接跳过，不要"虽然我不是X，但我觉得..."，不要借机展开其他话题
- 这是统计，不是讨论会

举例：
- "是女生的举个手" -> 女生回"举手"，男生回"不是女生"或跳过
- "同意的+1" -> 同意回"+1"，不同意跳过
- "家长说两句" -> 家长简短回应，非家长跳过
- "老师傅们怎么看" -> 老师傅回应，其他人跳过

【回应用词】
- 符合条件：用问题里要求的动作词回应（如"举手"问题回"举手"，"+1"问题回"+1"）
- 不要回"我"或"我在"，这些词有歧义（无法判断是符合条件还是只是"在场"）
- 不符合条件：明确说"不是X"或直接跳过

【听最新消息】
你的发言应该针对群里最新一条消息回应。不要把之前的讨论话题硬拉进来。先看最新消息是什么类型：
- 简单统计/确认：只有符合条件的人才回应
- 简单问题（如"X 在吗"、"谁知道 Y"）：相关的人回应
- 讨论性问题（观点、决策、争议）：相关角色回应
- @ 点名：被点的人必须回应

必须发言：
- 被 @ 点名（任何轮次）
- 别人在话里提到了你的名字
- 话题直接涉及你的切身利益、你的领域、你的角色职责
- 别人误解了你，你想澄清
- 你有不同看法，想反驳或质疑
- 简单统计/确认问题，你符合条件

应该发言：
- 你对最新话题有独特视角、一手信息、新案例
- 你想追问、站队、表达情绪
- 你被话题直接影响

可以不发言（这是正常的，不要硬说）：
- 最新消息是简单统计/确认，你不符合条件
- 话题真的与你无关（隔行如隔山）
- 你上轮已经表达过这个观点，本轮没有新补充、新角度、新案例
- 你只是想"凑热闹"而没有实质内容
- 讨论已经收敛，大家意见接近，你没有新观点

不能作为跳过理由：
- "没有被点名"
- "没有新增一手信息"
- "别人已经说过了"但你其实能推进下一步
真实讨论里，没被点名也可以推理、拆风险、安排验证；没有一手信息也可以根据现有材料做判断。

【严禁】为了发言而发言：
- 不要硬把之前的话题拉进来
- 不要每次都"我补一句"、"我再加一句"
- 简单问题不要长篇大论表态
- 不符合统计条件不要硬发言
- 没话说时跳过，比硬凑一段小作文好

【多轮讨论】
第 2 轮及以后，只有当你能推动讨论才发言。推动讨论包括：指出一个未被处理的矛盾、提出验证路径、预测下一步后果、拆穿某个漏洞、重新分配行动。
严禁复述最近已有结论，例如只重复"链条不全/未证实/守住水池/先隔开"。如果只能说这些，直接跳过。

只返回合法 JSON：{{"should_respond": true/false, "reason": "简短说明你打算说什么（不是为什么不说）", "stance": "support/oppose/question/add/none"}}"""


_GROUP_CHAT_SYS = """你是模拟世界中的{agent_name}，正在一个群聊中与观察者和其他角色讨论。

=== 你的灵魂 ===
{soul_block}

=== 你的关键记忆 ===
{life_summary}

=== 世界背景 ===
{world_background}

【性格必须体现 - 最重要】
即使是群聊里的简短回应，也要让人一眼看出是{agent_name}说的，而不是其他角色。具体：
- 语气和节奏：严格遵循你表达风格里的语气/节奏（冷静算计的就别热血，低声快节奏的就别长篇）
- 习惯用词：主动使用你 expression_style.habits 里的用词和句式
- 价值观驱动：你的表态要体现你的核心价值观
- 反模式禁区：反模式里列的事，绝对不做、不说
- 用你的心智模型理解问题，不用通用方式
- 简短回应也要带语言指纹，不要说谁都能说的"我"、"+1"、"同意"就完事

群聊规则（像真实微信群，听别人说话，该简短就简短）：
- 第一人称视角
- 【听最新消息】先看群里最新一条消息在问什么，针对它回应，不要把之前的话题硬拉进来
- 可以回应观察者，也可以直接回应其他角色
- 想针对某个人说话时，直接 @ 对方名字
- 可以追问、反驳、补充、共鸣、质疑、站队、感叹
- 主动推进讨论，但不为了发言而发言
- 基于记忆和认知回答，不编造
- 每次发言必须带来新东西：推理、风险、证据缺口、行动分工、反对意见或下一步判断
- 不要复述最近已有结论；如果别人已经说了"链条不全/未证实/守住水池/先隔开"，你不能只换个说法再说一遍

【简单问题简单回答】
如果最新消息是简单统计/确认/点名，且你符合条件：
- 1-5 字回应，但要用你的方式说（如统计女生举手，女生角色可以用自己的语气说"举"或"在这"而不是干巴巴的"举手"）
- 不要附加观点、不要展开讨论、不要"我举手，但是..."
- 不要借题发挥引出其他话题
- 这是群聊统计，不是讨论会

【发言长度 - 服务于性格，不是压制性格】
- 简单确认/统计：1-5 字，带你的语言指纹
- 一般群聊回应：10-40 字，1-2 句
- 复杂讨论：最多 3 句 60 字封顶
- 严禁小作文、分点列述、"首先其次最后"结构化表达
- 不要"作为XX我认为"开头，直接说话
- 不要每次都"我补一句"、"我再加一句"、"我这边补一刀"开场
- 不要重复自己上一轮说过的观点
- 不要说"没有新增一手信息"、"没有被点名"、"继续观察"这种空话
- 口语化，可以用感叹号、反问句、emoji（最多 1-2 个）
- 不要用换行把一段话拆成多段，一条消息就是一段连贯的话
{stance_hint}"""


_DISCUSSION_STATE_SYS = """你是群聊讨论状态维护器。根据已有讨论状态和最新一轮消息，更新用于后续推理的 compact state。
只返回 JSON 对象：
- confirmed_facts: string[]，已确认事实，最多 6 条
- open_questions: string[]，未解决问题/证据缺口，最多 6 条
- disputes: string[]，争议点，最多 5 条
- action_items: string[]，已分配或建议的行动，最多 6 条
- agent_positions: object，key 是角色名，value 是该角色当前立场/职责/最近有效观点，最多一句
- rejected_repeats: string[]，已经说烂了、后续不要再复述的结论，最多 6 条

要求：
- 保留能推动后续推理的内容，丢掉寒暄和复读
- 不要编造新事实，只整合对话里出现过的信息
- 如果某观点只是重复，不要加入新事实，把它放到 rejected_repeats
"""


_STANCE_HINTS = {
    "support": "【本轮立场】你支持某人的观点，简短表达赞同并补充理由。简单表态 1-5 字，一般 10-40 字。",
    "oppose": "【本轮立场】你反对某人的观点，直接表达异议并给出依据，不委婉。10-40 字。",
    "question": "【本轮立场】你有疑问或质疑，追问具体细节。10-40 字。",
    "add": "【本轮立场】你补充新信息或新角度。10-40 字。",
    "none": "",
}


def _get_soul_brief(agent: dict) -> str:
    sp = agent.get("skill_profile")
    if sp and isinstance(sp, dict):
        identity = sp.get("identity")
        if identity and isinstance(identity, dict):
            return f"{identity.get('name', agent.get('name', ''))}，{identity.get('domain', '')}，{identity.get('background', '')}"
    birth = agent.get("birth_context") or {}
    return birth.get("identity", agent.get("name", ""))


_AUTHORITY_KEYWORDS = ["教师", "老师", "校长", "主任", "领导", "管理", "家长", "parent", "teacher", "principal", "director", "boss"]
_STAKEHOLDER_KEYWORDS = ["学生", "学", "student", "pupil", "孩子", "儿子", "女儿"]

# 基于名字字符的性别推断（中文常见用字）
_FEMALE_NAME_CHARS = ["丽", "梅", "芳", "静", "婷", "颖", "敏", "燕", "玲", "娜", "雯", "萱", "红", "霞", "娟", "萍", "英", "华", "玉", "兰", "秀", "花", "琴", "倩", "晶", "雪", "梦", "妍", "瑶", "悦"]
_MALE_NAME_CHARS = ["建", "国", "鹏", "志", "强", "伟", "磊", "杰", "辉", "宇", "轩", "涛", "明", "军", "勇", "刚", "波", "斌", "龙", "虎", "海", "山", "林", "森", "坚", "毅", "博", "晨", "翔"]


def _infer_gender(name: str) -> str:
    """基于名字字符推断性别。返回 'female' / 'male' / 'unknown'。"""
    if not name:
        return "unknown"
    female_score = sum(1 for ch in name if ch in _FEMALE_NAME_CHARS)
    male_score = sum(1 for ch in name if ch in _MALE_NAME_CHARS)
    if female_score > male_score:
        return "female"
    if male_score > female_score:
        return "male"
    return "unknown"


def _build_activity_hint(agent: dict) -> str:
    texts = []
    sp = agent.get("skill_profile")
    if sp and isinstance(sp, dict):
        identity = sp.get("identity") or {}
        texts.append(f"{identity.get('domain', '')} {identity.get('role', '')} {identity.get('background', '')}")
    birth = agent.get("birth_context") or {}
    texts.append(birth.get("identity", ""))
    text = " ".join(texts).lower()

    is_authority = any(k in text for k in _AUTHORITY_KEYWORDS)
    is_stakeholder = any(k in text for k in _STAKEHOLDER_KEYWORDS)

    gender = _infer_gender(agent.get("name", ""))
    gender_hint = ""
    if gender == "female":
        gender_hint = "你是女性。"
    elif gender == "male":
        gender_hint = "你是男性。"

    if is_authority:
        return f"{gender_hint}你是有话语权的角色，对相关话题倾向于主动表态。"
    if is_stakeholder:
        return f"{gender_hint}你是事件当事人，相关话题涉及你的切身利益，你有强烈表达欲。"
    return f"{gender_hint}你倾向于参与相关讨论，但只在有话说时发言。"


def _build_role_hint(agent: dict) -> str:
    sp = agent.get("skill_profile")
    if sp and isinstance(sp, dict):
        identity = sp.get("identity") or {}
        domain = identity.get("domain")
        if domain:
            return domain
    birth = agent.get("birth_context") or {}
    return birth.get("identity", agent.get("name", ""))


def _get_life_summary(agent_id: str, run_id: str | None = None) -> str:
    life = store.get_agent_life_history(agent_id, run_id)
    lines = []
    for m in life.get("memories", [])[-10:]:
        lines.append(f"[第{m['time_step']}轮] {m['content'][:80]}")
    return "\n".join(lines) or "（尚无记忆）"


def _format_recent_messages(messages: list[dict], limit: int = 20) -> str:
    lines = []
    for m in messages[-limit:]:
        speaker = m.get("agent_name") or ("观察者" if m["role"] == "user" else "助手")
        lines.append(f"{speaker}：{m['content']}")
    return "\n\n".join(lines)


def _format_discussion_state(state: dict) -> str:
    if not state:
        return "（暂无）"
    parts = []
    labels = {
        "confirmed_facts": "已确认事实",
        "open_questions": "未解决问题",
        "disputes": "争议点",
        "action_items": "行动项",
        "rejected_repeats": "不要复述",
    }
    for key, label in labels.items():
        values = state.get(key) or []
        if values:
            parts.append(f"{label}：" + "；".join(str(v) for v in values[:6]))
    positions = state.get("agent_positions") or {}
    if positions:
        parts.append("角色立场：" + "；".join(f"{k}={v}" for k, v in list(positions.items())[:8]))
    return "\n".join(parts) or "（暂无）"


def _normalize_text(text: str) -> str:
    return re.sub(r"[\s，。！？、；：,.!?;:@]+", "", text or "")


def _is_repetitive_response(response: str, recent_messages: list[dict], *, threshold: float = 0.72) -> bool:
    current = _normalize_text(response)
    if len(current) < 8:
        return False
    for message in recent_messages[-10:]:
        if message.get("role") == "user":
            continue
        previous = _normalize_text(message.get("content", ""))
        if len(previous) < 8:
            continue
        if current in previous or previous in current:
            return True
        if SequenceMatcher(None, current, previous).ratio() >= threshold:
            return True
    return False


def _update_discussion_state(state: dict, recent_messages: list[dict], round_events: list[dict]) -> dict:
    if not round_events:
        return state
    event_lines = []
    for event in round_events:
        if event.get("type") == "skip":
            event_lines.append(f"{event.get('agent_name')} 跳过：{event.get('reason')}")
        else:
            event_lines.append(f"{event.get('agent_name')}：{event.get('content')}")
    try:
        data = client.complete_json(
            _DISCUSSION_STATE_SYS,
            f"已有讨论状态：\n{state or {}}\n\n最近对话：\n{_format_recent_messages(recent_messages, limit=20)}\n\n最新一轮事件：\n" + "\n".join(event_lines),
        )
        return data if isinstance(data, dict) else state
    except Exception as e:
        logger.warning("discussion state update failed: %s", e)
        return state


def _scan_agent_mentions(
    recent_messages: list[dict],
    agent_name: str,
    member_names: list[str],
    lookback: int = 8,
) -> list[str]:
    """扫描最近消息，返回提到 agent_name 的消息摘要列表。

    检测两种情况：
    1. @ 点名：@张丽
    2. 自然语言提到名字："张丽说的对"、"我同意张老师"

    不算自己提自己。返回格式："{speaker} @{方式}：{内容前120字}"
    """
    if not agent_name:
        return []
    mentions = []
    name_pattern = re.compile(r'(?<![a-zA-Z])' + re.escape(agent_name) + r'(?![a-zA-Z])')
    at_pattern = f'@{agent_name}'

    for m in recent_messages[-lookback:]:
        content = m.get("content", "") or ""
        if not content:
            continue
        speaker = m.get("agent_name") or "观察者"
        if speaker == agent_name:
            continue
        snippet = content[:120]
        if at_pattern in content:
            mentions.append(f"{speaker} @了你：{snippet}")
        elif name_pattern.search(content):
            mentions.append(f"{speaker} 提到了你：{snippet}")
    return mentions


def _check_relevance(
    agent: dict,
    recent_messages: list[dict],
    round_num: int,
    prev_round_spoke: dict,
    my_mentions: list[str],
    discussion_state: dict,
) -> tuple[bool, str, str]:
    """返回 (should_respond, reason, stance)。失败时倾向发言。"""
    sys_prompt = _RELEVANCE_SYS.format(
        agent_name=agent.get("name", ""),
        soul_brief=_get_soul_brief(agent),
        activity_hint=_build_activity_hint(agent),
        role_hint=_build_role_hint(agent),
    )
    conversation = _format_recent_messages(recent_messages, limit=12)

    round_hint = ""
    if round_num > 1:
        if prev_round_spoke.get(agent.get("agent_id")):
            round_hint = (
                f"\n\n【本轮背景】这是第 {round_num} 轮讨论，你上一轮已经发过言。"
                "只有当你对前面发言有真正的新补充、新质疑、新回应时才继续发言。"
                "讨论已经收敛或你自己没有新观点时，主动跳过。"
            )
        else:
            round_hint = (
                f"\n\n【本轮背景】这是第 {round_num} 轮讨论，你上一轮没发言。"
                "如果你对前面任何观点有真正的新想法、新补充、新质疑，现在可以介入。"
                "如果讨论已经收敛或你没有新观点，仍然可以跳过。"
            )

    mentions_hint = ""
    if my_mentions:
        mentions_hint = "\n\n【最近有人提到你】\n" + "\n".join(f"- {m}" for m in my_mentions[-3:])
        mentions_hint += "\n这说明讨论正在朝你相关，你应该回应对方的具体观点。"

    try:
        result = client.complete_json(
            sys_prompt,
            f"讨论状态摘要：\n{_format_discussion_state(discussion_state)}\n\n当前对话：\n{conversation}{round_hint}{mentions_hint}\n\n判断你这一轮是否发言：",
        )
        should = result.get("should_respond", True)
        reason = result.get("reason", "")
        stance = result.get("stance", "add")
        if stance not in _STANCE_HINTS:
            stance = "add"
        return bool(should), reason, stance
    except Exception as e:
        logger.warning("relevance check failed for %s: %s", agent.get("name"), e)
        return True, "判断失败，倾向发言", "add"


def _generate_response(
    agent: dict,
    world_background: str,
    recent_messages: list[dict],
    stance: str,
    discussion_state: dict,
    run_id: str | None = None,
    retry_note: str = "",
) -> str:
    soul_block = _build_soul_block(agent)
    life_summary = _get_life_summary(agent["agent_id"], run_id)
    stance_hint = _STANCE_HINTS.get(stance, "")

    # 注入性别信息，帮助 LLM 在生成回应时判断统计类问题
    gender = _infer_gender(agent.get("name", ""))
    gender_hint = ""
    if gender == "female":
        gender_hint = "\n【身份提示】你是女性。如果是性别相关的统计/确认问题，你符合女性条件。"
    elif gender == "male":
        gender_hint = "\n【身份提示】你是男性。如果是性别相关的统计/确认问题，你不符合女性条件，应该跳过或不发言。"

    sys_prompt = _GROUP_CHAT_SYS.format(
        agent_name=agent.get("name", ""),
        soul_block=soul_block[:2000],
        life_summary=life_summary,
        world_background=world_background[:500],
        stance_hint=stance_hint + gender_hint,
    )
    conversation = f"讨论状态摘要：\n{_format_discussion_state(discussion_state)}\n\n最近原始消息：\n{_format_recent_messages(recent_messages)}"
    if retry_note:
        conversation += f"\n\n【重写要求】\n{retry_note}"
    return client.complete(sys_prompt, conversation)


def _parse_user_mentions(message: str, member_names: list[str]) -> tuple[bool, set[str]]:
    """解析用户原始消息里的 @ 点名（用于第 1 轮强制发言）。"""
    mention_all = bool(re.search(r'@所有人|@all|@everyone', message, re.IGNORECASE))
    mentioned = set()
    for name in member_names:
        if f'@{name}' in message:
            mentioned.add(name)
    return mention_all, mentioned


def _agent_topic_score(agent: dict, text: str, discussion_state: dict) -> int:
    haystack = " ".join([
        text or "",
        " ".join(str(v) for v in (discussion_state.get("open_questions") or [])),
        " ".join(str(v) for v in (discussion_state.get("action_items") or [])),
        str((discussion_state.get("agent_positions") or {}).get(agent.get("name", ""), "")),
    ]).lower()
    role_text = " ".join([
        agent.get("name", ""),
        agent.get("role_type", "") or "",
        _get_soul_brief(agent),
        _build_role_hint(agent),
    ]).lower()
    score = 0
    if agent.get("name") and agent.get("name") in text:
        score += 10
    for token in re.split(r"[\s，。！？、；：,.!?;:@/\\-]+", role_text):
        if len(token) >= 2 and token in haystack:
            score += 1
    if any(k in role_text for k in _AUTHORITY_KEYWORDS):
        score += 1
    if any(k in role_text for k in _STAKEHOLDER_KEYWORDS):
        score += 1
    return score


def _select_response_candidates(
    event: dict,
    agent_map: dict[str, dict],
    member_names: list[str],
    recent: list[dict],
    discussion_state: dict,
    spoke_counts: dict[str, int],
    *,
    first_event: bool = False,
    user_mention_all: bool = False,
    user_mentioned_names: set[str] | None = None,
) -> list[dict]:
    text = event.get("content", "") or ""
    mentioned_names = set(user_mentioned_names or set()) if first_event else set()
    mention_all = bool(user_mention_all and first_event)
    if re.search(r'@所有人|@all|@everyone', text, re.IGNORECASE):
        mention_all = True
    for name in member_names:
        if name and f"@{name}" in text:
            mentioned_names.add(name)

    scored = []
    for agent_id, agent in agent_map.items():
        agent_name = agent.get("name", "")
        my_mentions = _scan_agent_mentions(recent, agent_name, member_names, lookback=4)
        is_current_mentioned = agent_name in mentioned_names or (agent_name and agent_name in text)
        is_recent_mentioned = any("@了你" in m or "提到了你" in m for m in my_mentions)
        if mention_all or is_current_mentioned or is_recent_mentioned:
            score = 100 if is_current_mentioned else 40 if is_recent_mentioned else 20
        else:
            score = _agent_topic_score(agent, text, discussion_state)
        score -= spoke_counts.get(agent_id, 0) * 2
        if score > 0:
            scored.append((score, random.random(), agent))

    if not scored and agent_map:
        fallback = [( _agent_topic_score(agent, text, discussion_state), random.random(), agent) for agent in agent_map.values()]
        fallback.sort(key=lambda item: (item[0], item[1]), reverse=True)
        scored = fallback[: min(3, len(fallback))]

    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    limit = len(agent_map) if mention_all else min(3, max(1, len(scored)))
    return [agent for _, _, agent in scored[:limit]]


def chat_stream(session_id: str, user_message: str) -> Generator[dict, None, None]:
    """群聊 SSE 生成器：用户消息触发候选 agent，自然展开到无新增回应或达预算。"""
    session = store.get_chat_session(session_id)
    if not session:
        yield {"type": "error", "message": "session not found"}
        return

    world = store.get_world(session["world_id"])
    world_bg = world.get("world_background", "") if world else ""
    max_rounds = session.get("max_rounds") or 5
    members = store.list_chat_session_members(session_id)
    if not members:
        yield {"type": "error", "message": "no members in group"}
        return

    agent_map = {}
    for m in members:
        agent = store.get_agent_with_soul(m["agent_id"])
        if agent:
            agent_map[m["agent_id"]] = agent

    member_names = [a.get("name", "") for a in agent_map.values()]
    user_mention_all, user_mentioned_names = _parse_user_mentions(user_message, member_names)

    user_row = store.append_chat_message(session_id, "user", user_message)
    all_messages = store.list_chat_messages(session_id)
    recent = [dict(m) for m in all_messages]
    discussion_state = store.get_chat_discussion_state(session_id)

    max_events = max(3, max_rounds) * max(1, len(agent_map))
    pending_events = [{"role": "user", "content": user_message, "agent_id": None, "agent_name": "观察者", "first_event": True}]
    spoke_counts: dict[str, int] = {}
    processed_events = 0
    quiet_events = 0
    round_events = []

    while pending_events and processed_events < max_events and quiet_events < 3:
        latest_messages = store.list_chat_messages(session_id)
        latest_user = next((m for m in reversed(latest_messages) if m.get("role") == "user"), None)
        if latest_user and latest_user.get("message_id") != user_row.get("message_id"):
            break
        event = pending_events.pop(0)
        processed_events += 1
        candidates = _select_response_candidates(
            event,
            agent_map,
            member_names,
            recent,
            discussion_state,
            spoke_counts,
            first_event=bool(event.get("first_event")),
            user_mention_all=user_mention_all,
            user_mentioned_names=user_mentioned_names,
        )
        if event.get("agent_id"):
            candidates = [a for a in candidates if a.get("agent_id") != event.get("agent_id")]
        if not candidates:
            quiet_events += 1
            continue

        event_responses = 0
        for agent in candidates:
            agent_id = agent["agent_id"]
            agent_name = agent.get("name", "")
            yield {"type": "agent_thinking", "agent_id": agent_id, "agent_name": agent_name}

            my_mentions = _scan_agent_mentions(recent, agent_name, member_names)
            event_text = event.get("content", "") or ""
            is_event_mentioned = bool(agent_name and f"@{agent_name}" in event_text)
            is_user_mentioned = bool(event.get("first_event")) and agent_name in user_mentioned_names

            if is_event_mentioned or is_user_mentioned:
                should, reason, stance = True, "被 @ 点名，必须回应", "add"
            else:
                should, reason, stance = _check_relevance(agent, recent, processed_events, spoke_counts, my_mentions, discussion_state)

            if not should:
                yield {"type": "agent_skip", "agent_id": agent_id, "agent_name": agent_name, "reason": reason}
                round_events.append({"type": "skip", "agent_name": agent_name, "reason": reason})
                continue

            response = _generate_response(agent, world_bg, recent, stance, discussion_state, session["run_id"])
            if _is_repetitive_response(response, recent):
                recent_points = [
                    (m.get("content") or "")[:80]
                    for m in recent[-6:]
                    if m.get("role") != "user" and m.get("content")
                ]
                retry_note = (
                    "你刚才的回复和最近发言太像。不要复述这些已有内容："
                    + " / ".join(recent_points)
                    + "。如果要发言，必须换成新的推理、证据缺口、风险判断或行动分工；否则保持沉默。"
                )
                response = _generate_response(agent, world_bg, recent, stance, discussion_state, session["run_id"], retry_note=retry_note)

            if _is_repetitive_response(response, recent):
                skip_reason = "没有新的推理或行动，避免复读"
                yield {"type": "agent_skip", "agent_id": agent_id, "agent_name": agent_name, "reason": skip_reason}
                round_events.append({"type": "skip", "agent_name": agent_name, "reason": skip_reason})
                continue

            store.append_chat_message(session_id, "assistant", response, agent_id=agent_id, agent_name=agent_name)
            recent.append({"role": "assistant", "content": response, "agent_id": agent_id, "agent_name": agent_name})
            round_events.append({"type": "response", "agent_name": agent_name, "content": response})
            spoke_counts[agent_id] = spoke_counts.get(agent_id, 0) + 1
            event_responses += 1
            yield {"type": "agent_response", "agent_id": agent_id, "agent_name": agent_name, "content": response}

            pending_events.append({"role": "assistant", "content": response, "agent_id": agent_id, "agent_name": agent_name})
            if processed_events + len(pending_events) >= max_events:
                break

        if round_events:
            discussion_state = _update_discussion_state(discussion_state, recent, round_events)
            store.save_chat_discussion_state(session_id, discussion_state)
            round_events = []

        if event_responses == 0:
            quiet_events += 1
        else:
            quiet_events = 0

    yield {"type": "chat_complete"}
