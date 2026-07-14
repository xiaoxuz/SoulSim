"""Report Agent 聊天。全局视角 + 图谱查询工具回答用户追问。"""
import json
import re

from app.graph import tools as graph_tools
from app.llm import client
from app.repositories import store

_REPORT_AGENT_SYS = """你是这个模拟世界的分析师（Report Agent），拥有全局视角。

已生成的报告摘要：
{report_summary}

你可以使用以下工具深入分析：
- TOOL:quick_search("查询内容") — 快速搜索特定实体或关系
- TOOL:panorama_search("查询内容") — 全景搜索某个主题
- TOOL:insight_forge("查询内容") — 深度洞察分析

使用工具时严格按上面格式输出。观察到结果后继续回答。
如果不需要工具，直接回答用户问题。

规则：
- 客观、全局视角回答
- 结论要有证据支撑
- 可以引用报告中的具体数据"""


def chat(session_id: str, user_message: str) -> str:
    session = store.get_chat_session(session_id)
    world_id = session["world_id"]
    run_id = session["run_id"]

    report = store.get_report_by_run(run_id)
    report_summary = ""
    if report:
        exec_sum = report.get("executive_summary", {})
        if isinstance(exec_sum, dict):
            report_summary = json.dumps(exec_sum, ensure_ascii=False, default=str)[:800]
        else:
            report_summary = str(exec_sum)[:800]

    sys_prompt = _REPORT_AGENT_SYS.format(report_summary=report_summary)

    history = store.list_chat_messages(session_id)
    conversation = "\n\n".join(
        f"{'用户' if m['role'] == 'user' else '分析师'}：{m['content']}"
        for m in history[-20:]
    )
    if conversation:
        conversation += f"\n\n用户：{user_message}"
    else:
        conversation = f"用户：{user_message}"

    tool_funcs = {
        "quick_search": lambda args: graph_tools.quick_search(world_id, args[0]),
        "panorama_search": lambda args: graph_tools.panorama_search(world_id, args[0]),
        "insight_forge": lambda args: graph_tools.insight_forge(world_id, args[0], run_id=run_id),
    }

    for round_num in range(3):
        response = client.complete(sys_prompt, conversation)

        tool_call = _parse_tool_call(response)
        if tool_call and round_num < 2:
            tool_name, tool_args = tool_call
            func = tool_funcs.get(tool_name)
            if func:
                try:
                    result = func(tool_args)
                    observation = json.dumps(result, ensure_ascii=False, default=str)[:2000]
                except Exception as e:
                    observation = f"工具调用失败：{e}"
                conversation += f"\n\n{response}\n\nObservation: {observation}\n\n请根据以上信息回答用户问题。"
            else:
                break
        else:
            final_response = response
            if "TOOL:" in response:
                parts = response.split("TOOL:", 1)
                final_response = parts[0].strip() or response
            store.append_chat_message(session_id, "user", user_message)
            store.append_chat_message(session_id, "assistant", final_response)
            return final_response

    store.append_chat_message(session_id, "user", user_message)
    store.append_chat_message(session_id, "assistant", response)
    return response


def _parse_tool_call(text: str) -> tuple[str, list[str]] | None:
    match = re.search(r'TOOL:(\w+)\((.+?)\)', text)
    if not match:
        return None
    tool_name = match.group(1)
    args_str = match.group(2)
    args = [a.strip().strip('"\'') for a in args_str.split('",')]
    return tool_name, args
