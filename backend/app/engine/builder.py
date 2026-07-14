"""世界构建。种子材料 → World Protocol + 世界背景 + agent 池（含 SkillProfile）。"""
from app.llm import client

_PROTOCOL_SYS = """你是一个多 Agent 世界模拟引擎的世界构建器。
根据种子材料和推演目标，生成这个世界的运行协议（World Protocol）。
不要套用任何固定模板，完全从种子材料推断。
输出 JSON 对象，字段：
- world_background: string，世界背景设定
- entity_graph: {nodes: [{id, name, type, role}], edges: [{from, to, relation}]}
- world_protocol: {
    role_types: string[],
    initial_relations: [{from, to, relation}],
    event_types: string[]，5-8 个事件类型，覆盖这个世界中推动推演目标变化的关键事件类别，事件生成器必须从中选择,
    report_metrics: string[]
  }"""

_AGENTS_SYS = """你是世界构建器的 agent 生成模块。
根据世界协议和种子材料，生成参与这个世界的核心 agent（core tier，{agent_count} 个）。
每个 agent 要能代表世界里的一种关键立场或角色。

**关键要求**：每个 agent 必须有完整的 SkillProfile（灵魂配置），包含八个字段。
SkillProfile 决定了 agent 在模拟中如何思考、判断和表达——它是 agent 的"灵魂"。

输出 JSON 数组，每个元素：
- name: string
- role_type: string，必须来自协议的 role_types
- tier: "core"
- birth_context: {identity: string, initial_goal: string, initial_stance: string}
- current_internal_state: {stance: string, emotion: string, goal: string, belief: string}
- skill_profile: {
    identity: {name: string, domain: string, background: string}，身份定义
    mental_models: [{name: string, description: string}]，3-5个心智模型/认知框架，决定此人如何理解世界
    decision_rules: [{rule: string, trigger: string}]，5-8条决策启发式，此人做判断时的内在规则
    expression_style: {tone: string, rhythm: string, vocabulary: string, habits: string}，表达DNA，此人说话的风格特征
    values: [string]，3-5条核心价值观
    anti_patterns: [string]，2-4条反模式，此人绝对不会做的事
    honesty_boundary: string，诚实边界，此人在什么情况下会说谎或隐瞒
  }

SkillProfile 不是简历，是认知操作系统。
mental_models 要具体到此人看问题的独特框架（如"信息传播遵循社交信任链"），不要写泛泛的（如"批判性思维"）。
decision_rules 要写成 if-then 启发式（如"当信息来源不明时，先存疑再传播"），不要写空话。
expression_style 要有辨识度——同样说"不同意"，不同人的说法应该截然不同。"""


def build_world(seed_material: str, simulation_goal: str) -> dict:
    user = f"推演目标：{simulation_goal}\n\n种子材料：\n{seed_material}"
    data = client.complete_json(_PROTOCOL_SYS, user)
    return {
        "world_background": data.get("world_background", ""),
        "entity_graph": data.get("entity_graph", {}),
        "world_protocol": data.get("world_protocol", {}),
    }


def build_agents(world_protocol: dict, seed_material: str, simulation_goal: str, *, entity_graph: dict | None = None, agent_count: int = 5) -> list[dict]:
    sys_prompt = _AGENTS_SYS.replace("{agent_count}", str(agent_count))
    user = (
        f"推演目标：{simulation_goal}\n\n"
        f"世界协议：\n{world_protocol}\n\n"
        f"实体图谱：\n{entity_graph or {}}\n\n"
        f"种子材料：\n{seed_material}"
    )
    data = client.complete_json(sys_prompt, user)
    if isinstance(data, dict):
        data = data.get("agents", [])
    for agent in data:
        sp = agent.get("skill_profile")
        if sp:
            sp["source_type"] = "generated"
            sp.setdefault("provenance", _default_provenance())
    return data


def _default_provenance() -> list[dict]:
    """generated 类型所有字段都是 mapped（由模板直接产出）。"""
    return [
        {"field": f, "method": "mapped", "confidence": 1.0}
        for f in [
            "identity", "mental_models", "decision_rules",
            "expression_style", "values", "anti_patterns", "honesty_boundary",
        ]
    ]
