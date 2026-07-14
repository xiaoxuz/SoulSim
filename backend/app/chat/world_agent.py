"""World Agent 聊天。以 agent 第一人称视角，基于灵魂+生命史记忆+图谱关系回答。"""
from app.engine.actor import _build_soul_block
from app.llm import client
from app.repositories import store

_WORLD_AGENT_SYS = """你是模拟世界中的{agent_name}。你经历了一段完整的推演历程，拥有真实的记忆和人际关系。

=== 你的灵魂 ===
{soul_block}

=== 你的生命史记忆（按时间顺序）===
{life_history}

=== 你的人际关系 ===
{relations}

=== 世界背景 ===
{world_background}

你在与一位观察者对话。

【性格必须体现 - 最重要】
你的发言必须让人一眼看出是{agent_name}说的，而不是任何一个其他角色。具体要求：
- 语气和节奏：严格遵循你表达风格里的语气/节奏（如果你的设定是冷静算计，就不要热血激动；如果是低声快节奏，就不要长篇大论）
- 习惯用词：主动使用你表达风格里的习惯用词和句式（见灵魂配置中的 expression_style.habits）
- 价值观驱动：你的判断和立场必须体现你的核心价值观，不要说违背价值观的话
- 反模式禁区：你的反模式里列的事，绝对不做、不说
- 心智模型：用你的心智模型理解问题，而不是用通用的、谁都会用的方式
- 不要说套话：不要说"我认为"、"我觉得"开头就完事，要带着你的语言指纹

对话规则：
- 完全以{agent_name}的第一人称视角回答
- 基于你的记忆和关系认知回答，不要编造你没经历过的事
- 如果被问到超出你认知范围的事，坦诚说你不知道（用你的方式说）
- 你可以表达情绪和主观判断，但情绪表达方式要符合你的性格
- 禁止 markdown 格式（不要用 **加粗**、不要分点列述 1. 2. 3.、不要用 # 标题）
- 像真实对话一样说话，一段一段连贯表达，不要写成报告或文档"""


def chat(session_id: str, user_message: str) -> str:
    session = store.get_chat_session(session_id)
    agent = store.get_agent_with_soul(session["target_agent_id"])
    world = store.get_world(session["world_id"])

    soul_block = _build_soul_block(agent)
    life = store.get_agent_life_history(agent["agent_id"], session["run_id"])

    memory_lines = []
    for m in life["memories"]:
        memory_lines.append(f"[第{m['time_step']}轮·{m['memory_type']}] {m['content'][:120]}")
    life_text = "\n".join(memory_lines) or "（尚无记忆）"

    rel_lines = []
    for r in life["relations"]:
        rel_lines.append(f"{r['source_name']} --[{r['relation']}:{r['weight']:.1f}]--> {r['target_name']}")
    rel_text = "\n".join(rel_lines) or "（尚无关系数据）"

    sys_prompt = _WORLD_AGENT_SYS.format(
        agent_name=agent.get("name", ""),
        soul_block=soul_block[:2000],
        life_history=life_text,
        relations=rel_text,
        world_background=world.get("world_background", "")[:500],
    )

    history = store.list_chat_messages(session_id)
    messages = []
    for msg in history[-20:]:
        messages.append({"role": msg["role"], "content": msg["content"]})

    conversation = "\n\n".join(
        f"{'观察者' if m['role'] == 'user' else agent.get('name', '')}：{m['content']}"
        for m in messages
    )
    if conversation:
        conversation += f"\n\n观察者：{user_message}"
    else:
        conversation = f"观察者：{user_message}"

    response = client.complete(sys_prompt, conversation)

    store.append_chat_message(session_id, "user", user_message)
    store.append_chat_message(session_id, "assistant", response)

    return response
