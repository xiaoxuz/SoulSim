"""SkillProfile 抽取器。六步流水线：parse → detect → map → fill → annotate → validate。

支持来源类型：
- nuwa: 女娲蒸馏的认知操作系统（五层结构，几乎全 mapped）
- dot-skill (celebrity): dot-skill 名人家族（接近 nuwa）
- dot-skill (colleague): 同事家族，Persona 六层 + Work Skill
- manual: 用户手写或粘贴的任意文本
"""
import re
import yaml
from app.llm import client

# ---- Step 1: Parse ----

def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """解析 YAML frontmatter + markdown body。"""
    text = text.strip()
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            try:
                fm = yaml.safe_load(parts[1]) or {}
            except yaml.YAMLError:
                fm = {}
            return fm, parts[2].strip()
    return {}, text


def _parse_sections(body: str) -> dict[str, str]:
    """按 ## 标题拆分成 sections dict。"""
    sections: dict[str, str] = {}
    current_title = "_intro"
    current_lines: list[str] = []

    for line in body.split("\n"):
        m = re.match(r"^#{1,3}\s+(.+)$", line)
        if m:
            if current_lines:
                sections[current_title] = "\n".join(current_lines).strip()
            current_title = m.group(1).strip()
            current_lines = []
        else:
            current_lines.append(line)

    if current_lines:
        sections[current_title] = "\n".join(current_lines).strip()

    return sections


# ---- Step 2: Detect ----

_NUWA_MARKERS = {"心智模型", "决策启发式", "表达 DNA", "表达DNA", "价值观底线", "诚实边界", "反模式"}
_CELEBRITY_MARKERS = {"外部评价对照", "认知框架", "决策启发式", "表达 DNA"}
_COLLEAGUE_MARKERS = {"硬规则", "身份层", "表达风格层", "决策模式层", "人际行为层", "Work Skill", "工作流程"}


def _detect_source(fm: dict, sections: dict[str, str]) -> str:
    """从 frontmatter 和 section 标题推断来源类型。"""
    fm_type = fm.get("source_type") or fm.get("type") or ""
    if fm_type:
        return fm_type

    titles = set(sections.keys())
    titles_lower = {t.lower().replace(" ", "") for t in titles}
    all_text = " ".join(titles)

    if len(_NUWA_MARKERS & titles) >= 3 or "nuwa" in str(fm).lower():
        return "nuwa"

    if len(_CELEBRITY_MARKERS & titles) >= 2 or "celebrity" in str(fm).lower():
        return "dot-skill"

    if len(_COLLEAGUE_MARKERS & titles) >= 2 or "colleague" in str(fm).lower():
        return "dot-skill"

    return "manual"


# ---- Step 3: Map ----

_SECTION_MAP_NUWA = {
    "identity": ["身份", "身份定义", "人物简介", "identity", "_intro"],
    "mental_models": ["心智模型", "认知框架", "心智模型/认知框架", "mental models"],
    "decision_rules": ["决策启发式", "决策规则", "decision rules", "决策"],
    "expression_style": ["表达 DNA", "表达DNA", "表达风格", "expression style", "表达"],
    "values": ["价值观", "价值观底线", "核心价值观", "values"],
    "anti_patterns": ["反模式", "anti-patterns", "禁止行为"],
    "honesty_boundary": ["诚实边界", "honesty boundary", "边界"],
}

_SECTION_MAP_COLLEAGUE = {
    "identity": ["身份层", "身份", "Persona 身份", "identity"],
    "expression_style": ["表达风格层", "表达风格", "表达 DNA", "expression"],
    "decision_rules": ["决策模式层", "决策模式", "决策", "Work Skill", "工作流程"],
    "anti_patterns": ["硬规则", "Correction", "硬规则层", "反模式"],
    "values": ["人际行为层", "人际行为", "价值观"],
    "mental_models": ["认知框架", "心智模型", "经验知识库"],
    "honesty_boundary": ["能力边界", "诚实边界", "边界"],
}


def _match_section(section_title: str, candidates: list[str]) -> bool:
    title_lower = section_title.lower().strip()
    for c in candidates:
        if c.lower() in title_lower or title_lower in c.lower():
            return True
    return False


def _map_sections(sections: dict[str, str], source_type: str) -> tuple[dict, dict[str, str]]:
    """确定性映射 sections → SkillProfile 字段。返回 (mapped_fields, unmapped_sections)。"""
    field_map = _SECTION_MAP_COLLEAGUE if "colleague" in source_type else _SECTION_MAP_NUWA
    mapped: dict = {}
    unmapped: dict[str, str] = {}

    for title, content in sections.items():
        found = False
        for field, candidates in field_map.items():
            if field not in mapped and _match_section(title, candidates):
                mapped[field] = content
                found = True
                break
        if not found and title != "_intro":
            unmapped[title] = content

    if "_intro" in sections and "identity" not in mapped:
        mapped["identity"] = sections["_intro"]

    return mapped, unmapped


# ---- Step 3.5: Structure mapped text ----

def _split_bullets(text: str) -> list[str]:
    """把 markdown 列表文本拆成条目。"""
    items = []
    for line in text.split("\n"):
        line = re.sub(r"^[\s]*[-*•]\s*", "", line).strip()
        if line:
            items.append(line)
    return items


def _parse_model_item(s: str) -> dict:
    """解析 '名称：描述' 或 '名称: 描述' 格式。"""
    for sep in ["：", ":"]:
        if sep in s:
            name, desc = s.split(sep, 1)
            return {"name": name.strip(), "description": desc.strip()}
    return {"name": s, "description": ""}


def _parse_rule_item(s: str) -> dict:
    """解析 '触发条件 → 规则' 或 '如果X，则Y' 格式。"""
    for sep in ["→", "->", "=>", "，则", "，就"]:
        if sep in s:
            trigger, rule = s.split(sep, 1)
            return {"trigger": trigger.strip(), "rule": rule.strip()}
    return {"rule": s, "trigger": ""}


def _structure_mapped(mapped: dict) -> dict:
    """将 mapped 的原始文本解析成结构化对象。"""
    if "mental_models" in mapped and isinstance(mapped["mental_models"], str):
        items = _split_bullets(mapped["mental_models"])
        mapped["mental_models"] = [_parse_model_item(i) for i in items] if items else mapped["mental_models"]

    if "decision_rules" in mapped and isinstance(mapped["decision_rules"], str):
        items = _split_bullets(mapped["decision_rules"])
        mapped["decision_rules"] = [_parse_rule_item(i) for i in items] if items else mapped["decision_rules"]

    if "values" in mapped and isinstance(mapped["values"], str):
        mapped["values"] = _split_bullets(mapped["values"]) or [mapped["values"]]

    if "anti_patterns" in mapped and isinstance(mapped["anti_patterns"], str):
        mapped["anti_patterns"] = _split_bullets(mapped["anti_patterns"]) or [mapped["anti_patterns"]]

    if "expression_style" in mapped and isinstance(mapped["expression_style"], str):
        text = mapped["expression_style"]
        mapped["expression_style"] = {"tone": text, "rhythm": "", "vocabulary": "", "habits": ""}

    if "identity" in mapped and isinstance(mapped["identity"], str):
        mapped["identity"] = {"name": mapped["identity"], "domain": "", "background": ""}

    return mapped


# ---- Step 4: Fill (LLM) ----

_FILL_SYS = """你是一个人物认知模型抽取器。从给定的原始材料中提取指定字段。
只基于材料内容推断，不凭空创造。如果材料不足以推断，输出空字符串。

输出 JSON 对象，key 是字段名，value 是提取结果。
- mental_models: [{name: string, description: string}]，3-5个心智模型
- decision_rules: [{rule: string, trigger: string}]，5-8条决策启发式
- expression_style: {tone: string, rhythm: string, vocabulary: string, habits: string}
- values: [string]，3-5条价值观
- anti_patterns: [string]，2-4条反模式
- honesty_boundary: string，诚实边界
- identity: {name: string, domain: string, background: string}"""


def _fill_missing(mapped: dict, unmapped: dict[str, str], raw_text: str, missing_fields: list[str]) -> dict:
    """用 LLM 从原始材料补齐缺失字段。"""
    if not missing_fields:
        return {}

    context = raw_text[:4000]
    if unmapped:
        extra = "\n\n".join(f"## {k}\n{v}" for k, v in list(unmapped.items())[:5])
        context = f"{context}\n\n未映射的补充材料：\n{extra}"

    user = f"需要提取的字段：{missing_fields}\n\n原始材料：\n{context}"
    return client.complete_json(_FILL_SYS, user)


# ---- Step 5: Annotate ----

def _annotate(profile: dict, mapped_fields: set[str], filled_fields: set[str]) -> list[dict]:
    """为每个字段标注 provenance。"""
    all_fields = ["identity", "mental_models", "decision_rules", "expression_style", "values", "anti_patterns", "honesty_boundary"]
    provenance = []
    for f in all_fields:
        val = profile.get(f)
        has_value = bool(val) and val != "" and val != [] and val != {}
        if f in mapped_fields and has_value:
            provenance.append({"field": f, "method": "mapped", "confidence": 1.0})
        elif f in filled_fields and has_value:
            provenance.append({"field": f, "method": "inferred", "confidence": 0.7})
        else:
            provenance.append({"field": f, "method": "empty", "confidence": 0.0})
    return provenance


# ---- Step 6: Validate ----

def _ensure_structure(profile: dict) -> dict:
    """确保每个字段都是正确类型。"""
    if isinstance(profile.get("identity"), str):
        profile["identity"] = {"name": profile["identity"], "domain": "", "background": ""}
    if not isinstance(profile.get("identity"), dict):
        profile["identity"] = {}

    for list_field in ["mental_models", "decision_rules", "values", "anti_patterns"]:
        if not isinstance(profile.get(list_field), list):
            v = profile.get(list_field)
            profile[list_field] = [v] if v else []

    if isinstance(profile.get("expression_style"), str):
        profile["expression_style"] = {"tone": profile["expression_style"], "rhythm": "", "vocabulary": "", "habits": ""}
    if not isinstance(profile.get("expression_style"), dict):
        profile["expression_style"] = {}

    if not isinstance(profile.get("honesty_boundary"), str):
        profile["honesty_boundary"] = str(profile.get("honesty_boundary", ""))

    return profile


# ---- Public API ----

def extract(text: str) -> dict:
    """从 SKILL.md 文本抽取 SkillProfile。返回完整 profile dict（含 provenance）。"""
    # 1. Parse
    fm, body = _parse_frontmatter(text)
    sections = _parse_sections(body)

    # 2. Detect
    source_type = _detect_source(fm, sections)

    # 3. Map
    mapped, unmapped = _map_sections(sections, source_type)
    mapped = _structure_mapped(mapped)
    mapped_fields = set(mapped.keys())

    # 4. Fill
    all_fields = {"identity", "mental_models", "decision_rules", "expression_style", "values", "anti_patterns", "honesty_boundary"}
    missing = list(all_fields - mapped_fields)
    filled = {}
    filled_fields: set[str] = set()
    if missing:
        filled = _fill_missing(mapped, unmapped, text, missing)
        filled_fields = set(filled.keys())

    # Merge: mapped takes priority
    profile = {**filled, **mapped}
    profile["source_type"] = source_type
    profile["source_ref"] = fm.get("name", fm.get("github", ""))

    # 5. Annotate
    profile = _ensure_structure(profile)
    profile["provenance"] = _annotate(profile, mapped_fields, filled_fields)

    # 6. Validate
    profile = _ensure_structure(profile)

    # 7. Attach raw content for direct prompt injection
    profile["raw_content"] = text

    return profile
