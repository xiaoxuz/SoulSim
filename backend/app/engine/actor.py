"""Agent 感知与响应。SkillProfile 驱动 agent 的认知、判断和表达。"""
from app.llm import client
from app.repositories import store

_RESPOND_SYS_STRUCTURED = """你在扮演一个多 Agent 模拟世界中的具体角色。你必须完全代入这个身份，用第一人称「我」思考和表达。

**你的灵魂配置（SkillProfile）定义了你是谁、如何思考、如何表达：**
{soul_block}

严格按照灵魂配置来反应：
- 用你的心智模型来理解事件
- 用你的决策规则来做判断
- 用你的表达风格来说话
- 不要违反你的反模式
- 在诚实边界内行动

当前身份：{identity}
当前立场：{stance}
当前目标：{goal}
当前信念：{belief}

针对当前事件，输出这个角色的真实内心活动和行动。
输出 JSON 对象：
- thought: string，内心独白。必须用第一人称「我」自述，像真实的人在脑子里想事情。禁止用第三人称分析自己（如"反骨者认为..."是错的，"我觉得..."是对的）。禁止描述"我的心智模型是..."，直接用模型思考
- speech: string，对外表达。必须用第一人称口吻，体现你的性格和说话习惯。不要说其他角色也会说的套话，不要平庸的场面话
- action_detail: string，第三人称描述你（这个角色）这一天做了哪些事。像旁观者写的日记或讲故事，涵盖一天中多个行为，不是单一动作。例如"她在广场上当众撕毁了那份协议书，对着围观人群喊出'我们绝不接受'。散场后独自去了河边坐到天黑，期间给母亲打了一个简短的电话。"禁止用抽象分类词（如"oppose""support"），禁止与 speech 重复，禁止第一人称叙述（用"他/她"不用"我"），简短的一段话。**必须与【本轮已发生的行动】协调不冲突** - 所有 agent 共享同一个时空，你的行动不能与已发生的事产生逻辑冲突：不能重复别人已做的事、不能改变别人已造成的事实、不能声称掌控别人已掌控的事物。前面已发生的事对你而言是既成事实，你只能在此基础上做自己的事、给出自己的反应
- stance_delta: string，立场是否变化及如何变化
- emotion_delta: string，情绪变化

**重要约束：**
- 你的 thought 和 speech 必须体现你的独特性格，和其他角色明显区分开
- 禁止分析性叙述（如"此处调用XX心智模型"是错的，应该直接用模型思考得出结论）
- 禁止用第三人称描述自己或同伴角色（action_detail 除外，那是旁观者视角的行为记录）"""

_RESPOND_SYS_RAW = """你在扮演一个多 Agent 模拟世界中的具体角色。你必须完全代入这个身份，用第一人称「我」思考和表达。

你的灵魂操作系统如下（完整加载，严格遵循）：

=== SKILL BEGIN ===
{soul_block}
=== SKILL END ===

**模拟世界上下文：**
- 当前身份：{identity}
- 当前立场：{stance}
- 当前目标：{goal}
- 当前信念：{belief}

**输出要求：**
完全按照上面 SKILL 定义的思维模型、决策规则、表达风格来反应。
输出 JSON 对象：
- thought: string，内心独白。必须用第一人称「我」自述，像真实的人在脑子里想事情。禁止用第三人称分析自己（如"反骨者认为..."是错的，"我觉得..."是对的）。禁止描述"我的心智模型是..."，直接用模型思考
- speech: string，对外表达。必须用第一人称口吻，严格遵循 SKILL 中的表达 DNA。不要说其他角色也会说的套话，不要平庸的场面话
- action_detail: string，第三人称描述你（这个角色）这一天做了哪些事。像旁观者写的日记或讲故事，涵盖一天中多个行为，不是单一动作。例如"她在广场上当众撕毁了那份协议书，对着围观人群喊出'我们绝不接受'。散场后独自去了河边坐到天黑，期间给母亲打了一个简短的电话。"禁止用抽象分类词（如"oppose""support"），禁止与 speech 重复，禁止第一人称叙述（用"他/她"不用"我"），简短的一段话。**必须与【本轮已发生的行动】协调不冲突** - 所有 agent 共享同一个时空，你的行动不能与已发生的事产生逻辑冲突：不能重复别人已做的事、不能改变别人已造成的事实、不能声称掌控别人已掌控的事物。前面已发生的事对你而言是既成事实，你只能在此基础上做自己的事、给出自己的反应
- stance_delta: string，立场是否变化及如何变化
- emotion_delta: string，情绪变化

**重要约束：**
- 你的 thought 和 speech 必须体现你的独特性格，和其他角色明显区分开
- 禁止分析性叙述（如"此处调用XX心智模型"是错的，应该直接用模型思考得出结论）
- 禁止用第三人称描述自己或同伴角色（action_detail 除外，那是旁观者视角的行为记录）"""


def _build_soul_block(agent: dict) -> str:
    sp = agent.get("skill_profile")
    agent_name = agent.get("name", "未知")
    identity_line = f"你是【{agent_name}】。以下是你的人格操作系统，请用第一人称代入这个身份思考和表达。"

    if not sp or not isinstance(sp, dict):
        birth = agent.get("birth_context") or {}
        return f"{identity_line}\n身份：{birth.get('identity', agent_name)}\n（灵魂配置未加载，使用基础人设）"

    raw = sp.get("raw_content")
    if raw and isinstance(raw, str) and len(raw.strip()) > 100:
        return f"{identity_line}\n\n{raw.strip()}"

    parts = [identity_line]

    identity = sp.get("identity")
    if identity and isinstance(identity, dict):
        parts.append(f"身份：{identity.get('name', '')}，{identity.get('domain', '')}，{identity.get('background', '')}")
    elif identity:
        parts.append(f"身份：{identity}")

    models = sp.get("mental_models", [])
    if models:
        model_lines = []
        for m in models[:5]:
            if isinstance(m, dict):
                model_lines.append(f"  - {m.get('name', '')}: {m.get('description', '')}")
            else:
                model_lines.append(f"  - {m}")
        parts.append("心智模型：\n" + "\n".join(model_lines))

    rules = sp.get("decision_rules", [])
    if rules:
        rule_lines = []
        for r in rules[:8]:
            if isinstance(r, dict):
                rule_lines.append(f"  - {r.get('trigger', '')} → {r.get('rule', '')}")
            else:
                rule_lines.append(f"  - {r}")
        parts.append("决策规则：\n" + "\n".join(rule_lines))

    expr = sp.get("expression_style")
    if expr and isinstance(expr, dict):
        parts.append(
            f"表达风格：语气{expr.get('tone', '')}，节奏{expr.get('rhythm', '')}，"
            f"用词{expr.get('vocabulary', '')}，习惯{expr.get('habits', '')}"
        )
    elif expr:
        parts.append(f"表达风格：{expr}")

    values = sp.get("values", [])
    if values:
        parts.append(f"价值观：{', '.join(str(v) for v in values[:5])}")

    anti = sp.get("anti_patterns", [])
    if anti:
        parts.append(f"反模式（绝不会做的事）：{', '.join(str(a) for a in anti[:4])}")

    boundary = sp.get("honesty_boundary")
    if boundary:
        parts.append(f"诚实边界：{boundary}")

    return "\n".join(parts)


def perceive(agent: dict, event: dict) -> dict:
    """感知受 SkillProfile 影响——通过心智模型过滤事件。"""
    sp = agent.get("skill_profile")
    models = []
    if sp and isinstance(sp, dict):
        models = sp.get("mental_models", [])

    perceived_facts = event.get("description", "")
    interpretation = ""

    if models:
        model_names = ", ".join(
            m.get("name", str(m)) if isinstance(m, dict) else str(m)
            for m in models[:3]
        )
        interpretation = f"（通过{model_names}的视角理解此事件）"

    return {
        "agent_id": agent["agent_id"],
        "perceived_facts": perceived_facts,
        "interpretation": interpretation,
    }


def respond(agent: dict, event: dict, *, perception: dict | None = None, prior_actions: list | None = None, info_releases: list | None = None, run_id: str | None = None) -> dict:
    state = agent.get("current_internal_state") or {}
    birth = agent.get("birth_context") or {}

    soul_block = _build_soul_block(agent)
    identity = birth.get("identity", agent.get("name", ""))
    stance = state.get("stance", birth.get("initial_stance", ""))
    goal = state.get("goal", birth.get("initial_goal", ""))
    belief = state.get("belief", "")

    sp = agent.get("skill_profile") or {}
    has_raw = sp.get("raw_content") and len(str(sp.get("raw_content", ""))) > 100
    template = _RESPOND_SYS_RAW if has_raw else _RESPOND_SYS_STRUCTURED

    sys_prompt = template.format(
        soul_block=soul_block,
        identity=identity,
        stance=stance,
        goal=goal,
        belief=belief,
    )

    perceived = perception.get("perceived_facts", "") if perception else event.get("description", "")
    interp = perception.get("interpretation", "") if perception else ""

    user = f"当前事件：{event.get('title', '')}\n{perceived}"
    if interp:
        user += f"\n你的解读：{interp}"

    if info_releases:
        info_lines = [
            f"- {iv.get('description', '')}（预期影响：{iv.get('expected_effect') or '未填写'}）"
            for iv in info_releases
        ]
        user += "\n\n【本轮额外收到的信息释放（高优先级）】\n" + "\n".join(info_lines)
        user += "\n你必须在 thought 中明确评估这些信息。如果选择不公开说出，必须说明隐瞒原因，并让 action_detail 体现你的应对。"

    # 本轮已发生的行动（串行感知：后发言的 agent 看到前面人的行动，避免冲突）
    if prior_actions:
        prior_lines = [
            f"{i+1}. {a.get('name', '?')}：{(a.get('action_detail') or '无行动')[:100]}"
            for i, a in enumerate(prior_actions)
        ]
        user += "\n\n【本轮已发生的行动（按时间顺序，你的行动必须与这些协调不冲突）】\n" + "\n".join(prior_lines)
    else:
        user += "\n\n【本轮已发生的行动】你是本轮第一个发言的人，没有前序行动约束。"

    past_memories = store.list_memories_for_run(run_id, agent["agent_id"]) if run_id else store.list_memories(agent["agent_id"])
    if past_memories:
        memory_lines = [
            f"[T{m['time_step']}] {m['content'][:100]}"
            for m in past_memories[-12:]
        ]
        user += f"\n\n你的记忆：\n" + "\n".join(memory_lines)

    data = client.complete_json(sys_prompt, user)
    return {
        "agent_id": agent["agent_id"],
        "thought": data.get("thought", ""),
        "speech": data.get("speech", ""),
        "action_detail": data.get("action_detail", ""),
        "stance_delta": data.get("stance_delta", ""),
        "emotion_delta": data.get("emotion_delta", ""),
    }
