"""Draw the README illustrations and export plugin market previews."""

import json
from argparse import ArgumentParser
from html import escape
from pathlib import Path
from shutil import which
from subprocess import run

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs/images/readme"

STYLE = """
    text { fill: #1e293b; font: 16px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
    .small { font-size: 14px; }
    .muted { fill: #526378; }
    .label { font-weight: 600; }
    .heading { font-size: 22px; font-weight: 650; }
    .lead { font-size: 18px; font-weight: 600; }
    .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    .serif { font-family: Georgia, "Times New Roman", serif; }
    .math { font: 26px Georgia, "Times New Roman", serif; }
    .paper { fill: #fff; }
    .pane { fill: #f8fafc; }
    .chrome { fill: #f1f5f9; }
    .code { fill: #edf2f7; }
    .select { fill: #0d9488; fill-opacity: .11; }
    .accent { fill: #0f766e; }
    .warning { fill: #92400e; }
    .warning-bg { fill: #fffbeb; }
    .border { stroke: #94a3b8; stroke-opacity: .65; }
    .rule { stroke: #94a3b8; stroke-opacity: .42; }
    .edge { stroke: #0d9488; stroke-width: 2; }
    .placeholder { stroke: #1e293b; stroke-opacity: .17; stroke-width: 3; stroke-linecap: round; }
    .icon { fill: none; stroke: #64748b; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
""".strip("\n")

ICONS = {
    "search": "M9.8 9.8l3.5 3.5M10.6 6.4a4.2 4.2 0 1 0-8.4 0 4.2 4.2 0 0 0 8.4 0Z",
    "folder": "M1.5 4h5l1.7 2h6.3v6.5h-13ZM1.5 4V2.8h5L8 4h5v2",
    "doc": "M3 1.5h6l4 4v9H3Zm6 0v4h4M5.5 8h5m-5 3h5",
    "plus": "M8 3v10M3 8h10",
    "close": "M4 4l8 8m0-8-8 8",
    "panel": "M1.8 2.5h12.4v11H1.8Zm8.5 0v11",
    "copy": "M5 5h9v9H5ZM2 11V2h9",
    "download": "M8 1v9m-4-4 4 4 4-4M2 11v3h12v-3",
    "spark": "M8 1.5 9.8 6.2 14.5 8l-4.7 1.8L8 14.5 6.2 9.8 1.5 8l4.7-1.8Z",
    "refresh": "M13.5 5a6 6 0 1 0 .4 4.3M13.5 1.8v3.8H9.6",
    "chevron": "m4 6 4 4 4-4",
    "up": "M8 13V3M4 7l4-4 4 4",
    "eye": "M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8ZM10 8a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z",
    "trash": "M2.5 4h11M4 4l.7 10h6.6L12 4M6 4V1.8h4V4M7 6.5v5m2-5v5",
    "link": "m6 10 4-4m-5 2-2 2a2.1 2.1 0 0 0 3 3l2-2m0-6 2-2a2.1 2.1 0 0 1 3 3l-2 2",
}

ATTENTION = "Attention Is All You Need"
GPT = "Language Models are Few-Shot Learners"
COT = "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models"
DIFFUSION = "Denoising Diffusion Probabilistic Models"
ORIGIN = ("梳理 Transformer 架构起源论文", "Papers on the origins of the Transformer")
SCHOLARLY = ("管理科学大模型论文检索", "LLMs in management science")
PANEL = ("文献面板", "Literature panel")
TRAIL = ("文献轨迹", "Literature trail")
PARSED = ("PDF 全文", "PDF full text")
MANAGER = ("解析管理", "Parsing management")
LOCAL_PDF = "Vaswani et al. 2017"
SCOPE = ("语言模型与注意力", "Language models and attention")
ATTENTION_QUOTE = [
    "An attention function can be described as mapping a query and a set of",
    "key-value pairs to an output, where the query, keys, values, and output",
    "are all vectors. The output is computed as a weighted sum of the values,",
    "where the weight assigned to each value is computed by a compatibility function",
    "of the query with the corresponding key.",
]


class Scene:
    def __init__(self, lang, width=800, *, height=None):
        self.lang = lang
        self.width = width
        self.height = width * 5 // 8 if height is None else height
        self.elements = []
        self.clips = []

    def local(self, value):
        return value[self.lang] if isinstance(value, tuple) else value

    def rect(self, x, y, w, h, cls="paper", radius=0, *, fill=None):
        color = f' fill="{fill}"' if fill else ""
        self.elements.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" class="{cls}"{color}/>'
        )

    def line(self, x1, y1, x2, y2, cls="rule"):
        self.elements.append(f'<path d="M{x1} {y1}L{x2} {y2}" class="{cls}"/>')

    def dot(self, x, y, cls="accent"):
        self.elements.append(f'<circle cx="{x}" cy="{y}" r="3" class="{cls}"/>')

    def text(self, x, y, value, cls="", anchor="start"):
        self.markup(x, y, escape(self.local(value)), cls, anchor)

    def markup(self, x, y, markup, cls="", anchor="start"):
        self.elements.append(
            f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}">{markup}</text>'
        )

    def lines(self, x, y, values, cls="", step=21):
        for index, value in enumerate(self.local(values)):
            self.text(x, y + index * step, value, cls)

    def placeholder(self, x, y, widths, step=14):
        for index, width in enumerate(widths):
            top = y + index * step
            self.line(x, top, x + width, top, "placeholder")

    def icon(self, name, x, y):
        self.elements.append(
            f'<path d="{ICONS[name]}" transform="translate({x} {y})" class="icon"/>'
        )

    def group(self, name, bounds=None):
        if bounds:
            x, y, w, h, radius = bounds
            self.clips.append(
                f'<clipPath id="{name}-clip"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}"/></clipPath>'
            )
        clip = f' clip-path="url(#{name}-clip)"' if bounds else ""
        self.elements.append(f'<g id="{name}"{clip}>')

    def end(self):
        self.elements.append("</g>")

    def finish(self, title, desc):
        lang = ("zh-CN", "en")[self.lang]
        w, h = self.width, self.height
        self.end()
        self.rect(0.5, 0.5, w - 1, h - 1, "border", 10, fill="none")
        body = "\n  ".join(self.elements)
        clips = "\n    ".join(self.clips)
        return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" xml:lang="{lang}" role="img" aria-labelledby="title desc">
  <title id="title">{escape(self.local(title))}</title>
  <desc id="desc">{escape(self.local(desc))}</desc>
  <style>
{STYLE}
  </style>
  <defs>
    {clips}
  </defs>
  {body}
</svg>
'''

    def button(self, x, y, width, label, *, active=False, icon=None):
        self.rect(x, y, width, 26, "select border" if active else "paper border", 4)
        if icon:
            self.icon(icon, x + 6, y + 5)
            self.text(x + 26, y + 18, label, "small label" if active else "small")
        else:
            self.text(x + width / 2, y + 18, label, "small label accent" if active else "small", "middle")

    def tag(self, x, y, width, label, active=False):
        self.rect(x, y, width, 21, "select" if active else "chrome", 4)
        self.text(x + width / 2, y + 15, label, "small accent label" if active else "small muted", "middle")


def tabs(s, x, entries, active, y=0, low=False):
    for index, (width, label) in enumerate(entries):
        selected = index == active
        if selected:
            s.rect(x, y + 3, width, 25, "select", 4)
            s.line(x + 7, y + 29, x + width - 7, y + 29, "edge")
        s.text(x + 8, y + 21, label, "small label accent" if selected else "small muted")
        x += width + 3
    if low:
        s.icon("plus", x + 4, y + 8)


def frame(s, *, session=ORIGIN, trail=False, right=0, dock=(), active=0):
    w, h = s.width, s.height
    s.group("application", (0, 0, w, h, 10))
    s.rect(0, 0, w, h)
    s.rect(0, 0, 34, h, "chrome")
    s.line(34, 0, 34, h)
    s.rect(35, 0, w - 35, 61, "pane")
    s.line(34, 61, w, 61)
    s.icon("panel", 9, 13)
    for index, name in enumerate(("plus", "spark", "folder", "search")):
        s.icon(name, 9, 56 + index * 33)
    if right:
        s.group("session-header", (35, 0, right - 35, 61, 0))
    s.text(48, 22, ("Transformer 架构起源…", "Transformer origins…") if right else session, "small label")
    small_tabs = [(48, ("对话", "Chat")), (48, ("轨迹", "Trace"))]
    tabs(s, 42, small_tabs if right else [*small_tabs, (125, TRAIL)], 2 if trail else 0, 30)
    if right:
        s.end()
        s.rect(right, 0, w - right, h, "pane")
        s.line(right, 0, right, h)
        s.line(right, 31, w, 31)
        tabs(s, right + 7, dock, active, low=True)
    s.icon("panel", w - 26, 11)


def composer(s, x=76, w=684, stop=False):
    y = s.height - 47
    s.group("composer")
    s.rect(x, y, w, 36, "pane border", 7)
    s.icon("plus", x + 9, y + 10)
    placeholder = ("发送消息…", "Send a message") if w < 250 else ("发送消息或创建任务", "Send a message or create a task")
    s.text(x + 33, y + 23, placeholder, "small muted")
    if stop:
        s.rect(x + w - 24, y + 12, 10, 10, "accent", 2)
    else:
        s.icon("up", x + w - 25, y + 10)
    s.end()


def bubble(s, y, values, x=229):
    s.group("user-question")
    s.rect(x, y, 760 - x, 58, "chrome", 6)
    s.lines(x + 14, y + 23, values, step=22)
    s.end()


def quote(s, x, y, width, values, *, cls="", step=19):
    values = s.local(values)
    height = len(values) * step + 12
    s.rect(x, y, width, height, "select", 4)
    s.line(x + 1, y + 3, x + 1, y + height - 3, "edge")
    s.lines(x + 12, y + 18, values, cls, step)


def tool(s, y, name, detail, icon="search"):
    s.icon(icon, 77, y - 13)
    s.text(102, y, name, "small mono accent")
    s.text(279, y, detail)


def chat_search(s):
    frame(s)
    bubble(s, 74, (
        ["在我 Zotero 库里找一下 Transformer 架构起源相关的论文，", "按时间脉络梳理每篇的贡献。"],
        ["Find papers in my Zotero library on the origins of the Transformer.", "Trace each paper’s contribution chronologically."],
    ))
    s.text(76, 160, ("已完成，用时 50 秒", "Completed in 50 seconds"), "small muted")
    s.line(76, 172, 760, 172)
    s.text(76, 199, ("已调用工具", "Tools called"), "lead")
    tool(s, 228, "skill", ("加载技能 · zotero-research-landscape", "Loaded zotero-research-landscape"), "doc")
    s.placeholder(77, 249, [466, 313])
    s.text(76, 302, ("检索范围 · 本地 Zotero 文献库", "Search scope · Local Zotero library"), "label")
    for index, (query, hits) in enumerate(zip(
        ("Transformer", "Attention Is All You Need", "attention", "BERT", "GPT"), (1, 1, 1, 2, 0)
    )):
        result = (f"找到 {hits} 篇文献", f"{hits} {'paper' if hits == 1 else 'papers'} found")
        if query == "GPT":
            result = ("找到 0 篇文献（+1 条笔记）", "0 papers found (+1 note)")
        y = 327 + index * 23
        tool(s, y, "zotero_search", f"“{query}”")
        s.text(535, y, result, "small label")
    composer(s)


def chat_answer(s):
    frame(s)
    s.icon("search", 76, 75)
    s.text(101, 89, "zotero_retrieve", "mono accent")
    s.text(273, 89, ("提取 1 条原文片段", "1 passage retrieved"), "label")
    s.rect(96, 101, 664, 107, "pane border", 5)
    s.tag(108, 110, 76, ("摘要", "Abstract"), True)
    s.tag(193, 110, 133, ("命中查询词", "Query matched"))
    s.text(747, 126, ("复制  ·  在 Zotero 中打开  ·  复制链接", "Copy  ·  Open in Zotero  ·  Copy link"), "small accent", "end")
    s.lines(109, 150, [
        "We explore how generating a chain of thought — a series of intermediate reasoning",
        "steps — significantly improves the ability of large language models to perform",
        "complex reasoning.",
    ], step=21)
    s.text(76, 237, ("库内共 11 篇文献，「语言模型与注意力」合集收录其中 4 篇主线论文。",
                     "The library has 11 papers. The Language models and attention collection"), "small")
    if s.lang:
        s.text(76, 257, "contains four papers in this lineage.", "small")
    s.text(76, 285, ("时间脉络一览", "Timeline"), "heading")
    s.text(76, 313, ("年份", "Year"), "small muted")
    s.text(144, 313, ("论文", "Paper"), "small muted")
    s.text(550, 313, ("角色", "Role"), "small muted")
    for index, (year, title, role) in enumerate([
        (2017, "Attention Is All You Need (Vaswani et al.)", ("架构起源", "Architecture origin")),
        (2019, "BERT (Devlin et al.)", ("编码器路线", "Encoder lineage")),
        (2020, "Language Models are Few-Shot Learners (Brown et al.)", ("解码器路线 + 规模化", "Decoder lineage + scale")),
        (2022, "Chain-of-Thought Prompting (Wei et al.)", ("能力涌现", "Emergent capability")),
    ]):
        y = 336 + index * 28
        s.line(76, y - 16, 760, y - 16)
        s.text(76, y + 3, str(year), "small mono")
        s.text(144, y + 3, title, "small label" if index == 0 else "small")
        s.text(550, y + 3, role, "small")
    composer(s)


def chat_formulas_prompt(s):
    frame(s)
    bubble(s, 74, (
        ["Attention Is All You Need 里多头注意力的公式和定义是怎么写的？", "引用原文并标明出处。"],
        ["How does Attention Is All You Need define multi-head attention?", "Quote the original text and cite where it appears."],
    ), x=189)
    s.text(76, 158, ("已完成，用时 23 秒", "Completed in 23 seconds"), "small muted")
    s.text(76, 191, ("出处", "Provenance"), "heading")
    s.rect(76, 204, 684, 120, "pane border", 5)
    s.text(89, 227, ATTENTION, "lead")
    s.text(89, 248, "Vaswani et al. · Advances in Neural Information Processing Systems 30 · 2017", "small")
    s.text(89, 271, ("PDF 全文 · 索引覆盖 15/15 页（完整）", "PDF full text · Index coverage 15/15 pages (complete)"), "small label accent")
    s.text(746, 271, "arXiv:1706.03762", "small mono accent", "end")
    s.text(89, 294, ("§3.2.1 · 全文分块 8/32–9/32", "§3.2.1 · Full-text chunks 8/32–9/32"), "small muted")
    s.text(89, 314, ("§3.2.2 · 全文分块 9/32–10/32", "§3.2.2 · Full-text chunks 9/32–10/32"), "small muted")
    s.text(76, 345, ("1. 注意力的一般定义（§3.2 开头）", "1. General definition of attention (§3.2)"), "lead")
    quote(s, 76, 354, 684, ATTENTION_QUOTE, step=16)
    composer(s)


def chat_formulas_def(s):
    frame(s)
    s.text(76, 91, ("1. 注意力的一般定义（§3.2 开头）", "1. General definition of attention (§3.2)"), "lead")
    quote(s, 76, 102, 684, ATTENTION_QUOTE, step=16)
    s.text(76, 216, ("2. 缩放点积注意力（§3.2.1，式 (1)）", "2. Scaled Dot-Product Attention (§3.2.1, Eq. 1)"), "lead")
    quote(s, 76, 226, 684, [
        "We compute the dot products of the query with all keys, divide each by √dₖ,",
        "and apply a softmax function to obtain the weights on the values.",
    ])
    s.group("scaled-dot-product-equation")
    s.text(203, 314, "Attention(Q, K, V) = softmax", "math")
    s.elements.append('<path d="M548 282Q534 309 548 330 M617 282Q631 309 617 330" fill="none" stroke="#1e293b" stroke-width="1.4"/>')
    s.markup(582, 301, 'QK<tspan dy="-9" font-size="15">T</tspan>', "math", "middle")
    s.line(553, 308, 613, 308, "edge")
    s.elements.append('<path d="M561 323l5-3 5 12 6-17h24" fill="none" stroke="#1e293b" stroke-width="1.35"/>')
    s.markup(579, 329, 'd<tspan dy="4" font-size="13">k</tspan>', "serif lead")
    s.text(635, 314, "V", "math")
    s.text(751, 313, "(1)", "small muted", "end")
    s.end()
    s.text(76, 354, ("3. 多头注意力（§3.2.2）", "3. Multi-head attention (§3.2.2)"), "lead")
    quote(s, 76, 363, 684, [
        "… we found it beneficial to linearly project the queries, keys and values h times",
        "with different, learned linear projections to dₖ, dₖ and dᵥ dimensions, respectively.",
        "… we then perform the attention function in parallel, yielding dᵥ-dimensional",
        "output values. These are concatenated and once again projected …",
    ], step=17)
    composer(s)


def trail_frame(s, exported=False):
    frame(s, trail=True)
    s.rect(35, 62, 765, 44, "pane")
    s.line(35, 106, 800, 106)
    s.dot(50, 83)
    s.text(59, 88, ("已连接到 Zotero", "Connected to Zotero"), "small")
    s.button(197, 70, 88, ("文献", "Literature"), active=not exported)
    s.button(289, 70, 89, ("导出 3", "Exports 3"), active=exported)
    s.text(391, 88, ("12 篇文献 · 13 处摘录 · 3 次导出", "12 items · 13 passages · 3 exports"), "small muted")
    s.text(783, 88, ("刷新", "Refresh"), "small muted", "end")


def trail_inspector(s):
    trail_frame(s)
    s.group("session-literature")
    s.rect(35, 107, 160, 337, "pane")
    s.line(195, 106, 195, 447)
    s.tag(44, 117, 48, ("全部 12", "All 12"))
    s.tag(98, 117, 89, ("有摘录 4", "Passages 4"), True)
    s.text(45, 160, ("会话摘录全景 13", "All passages 13"), "small accent")
    for index, (titles, author) in enumerate([
        (["BERT"], "Devlin et al."),
        (["Attention Is", "All You Need"], "Vaswani et al."),
        (["Language Models", "are Few-Shot", "Learners"], "Brown et al. · 2020"),
        (["Chain-of-Thought", "Prompting"], "Wei et al."),
    ]):
        y = (180, 228, 296, 366)[index]
        step = 18
        if index == 2:
            step = 15
            s.rect(41, y - 13, 149, 75, "select", 4)
            s.line(42, y - 9, 42, y + 58, "edge")
        s.lines(49, y + 6, titles, "small label" if index == 2 else "small", step)
        s.text(49, y + 8 + len(titles) * step, author, "small muted")
    s.end()
    s.group("selected-item-passages")
    s.text(208, 132, GPT, "label")
    s.text(208, 153, "Tom B. Brown et al. · NeurIPS 33 · 2020", "small muted")
    s.button(208, 163, 115, ("问这篇", "Ask about this"))
    s.text(208, 209, ("核心原文摘录 1", "Key passage 1"), "label")
    s.text(208, 229, ("检索 1 次 · 保留 1 条 · 报告 1 条", "1 retrieve · 1 kept · 1 reported"), "small muted")
    s.tag(208, 239, 81, ("摘要", "Abstract"), True)
    quote(s, 208, 266, 358, [
        "We train GPT-3, an autoregressive language",
        "model with 175 billion parameters, 10x larger",
        "than any previous non-sparse language model,",
        "and test its performance in the few-shot setting.",
    ], cls="small", step=18)
    s.text(208, 374, ("关联支撑 1 次对话问答论点", "Supports 1 claim in the conversation"), "small accent")
    s.text(208, 402, "BibTeX  1", "small label")
    s.text(208, 425, "brown_language_2020", "small mono")
    s.end()
    s.group("citation-and-retrieval")
    s.rect(577, 107, 223, 337, "pane")
    s.line(577, 106, 577, 447)
    s.tag(587, 117, 65, "BibTeX", True)
    s.tag(660, 117, 98, "GB/T 7714")
    s.rect(587, 148, 201, 76, "code", 4)
    s.lines(594, 166, ["@inproceedings{", "  brown_language_2020,"], "mono small accent", 18)
    s.placeholder(596, 203, [164])
    s.text(587, 247, ("检索来源", "Search origins"), "label")
    s.text(587, 271, ("文献库 · 元数据", "Library · Metadata"), "small")
    s.text(587, 290, ("命中 11 条文献", "11 papers matched"), "small muted")
    s.text(587, 312, SCOPE, "small")
    s.text(587, 331, ("元数据 · 命中 4 条文献", "Metadata · 4 papers matched"), "small muted")
    s.line(587, 343, 788, 343)
    s.text(587, 363, ("最近一次各检索来源状态", "Latest retrieval sources"), "small label")
    s.lines(587, 383, (
        ["abstract · 返回 1 条匹配", "fulltext · 该来源不可用", "annotation / note · 不可用"],
        ["abstract · 1 match", "fulltext · Unavailable", "annotation / note · Unavailable"],
    ), "small muted", 18)
    s.end()
    composer(s)


def trail_export(s):
    trail_frame(s, exported=True)
    s.group("export-summary")
    s.text(48, 137, "BibTeX  3", "lead")
    s.button(536, 116, 111, ("复制全部", "Copy all"))
    s.button(654, 116, 132, ("下载全部 .bib", "Download all .bib"))
    s.icon("chevron", 48, 150)
    s.text(73, 163, "brown_language_2020", "mono label")
    s.button(576, 145, 80, r"\cite{…}")
    s.button(664, 145, 122, ("下载 .bib", "Download .bib"))
    s.rect(48, 181, 738, 139, "code border", 5)
    s.rect(49, 182, 736, 26, "chrome", 4)
    s.text(60, 200, "bibtex", "small mono muted")
    s.text(774, 200, ("复制", "Copy"), "small", "end")
    s.lines(61, 229, [
        "@inproceedings{brown_language_2020,",
        "  title = {Language {Models} are {Few}-{Shot} {Learners}},",
        "  url = {https://arxiv.org/abs/2005.14165},",
    ], "mono", 21)
    s.placeholder(63, 294, [469, 361], 12)
    for index, (key, title) in enumerate([
        ("wei_chain--thought_2022", COT),
        ("shannon_mathematical_1948", "A Mathematical Theory of Communication"),
    ]):
        y = 345 + index * 48
        s.icon("chevron", 48, y - 12)
        s.text(73, y, key, "small mono label")
        s.text(73, y + 20, title, "small muted")
        s.button(664, y - 17, 122, ("下载 .bib", "Download .bib"))
    s.end()
    composer(s)


def side_frame(s, dock, active, *, reading=False):
    split = 291 if s.width == 1000 else 225
    frame(s, right=split, dock=dock, active=active)
    s.group("background-conversation", (35, 62, split - 35, s.height - 62, 0))
    x = 48
    if reading:
        s.rect(x + 22, 77, split - x - 34, 54, "chrome", 5)
        s.placeholder(x + 35, 93, [split - x - 65, split - x - 90, split - x - 73], 12)
        for y, widths in [(158, [106]), (194, [143, 121, 154]), (256, [153, 128, 142, 101]), (340, [146, 152, 84])]:
            s.placeholder(x, y, widths)
    else:
        s.placeholder(x, 86, [157, 143, 126, 151, 108])
        s.text(x, 177, ("时间脉络一览", "Timeline"), "lead")
        for index, (year, title) in enumerate([
            (2017, ATTENTION), (2019, "BERT"), (2020, "GPT-3"), (2022, "Chain-of-Thought"),
        ]):
            y = 208 + index * 33
            s.line(x, y - 17, split - 13, y - 17)
            s.text(x, y, str(year), "small mono muted")
            s.text(x + 42, y, title if index else "Attention Is All…", "small muted")
        s.placeholder(x, 354, [157, 134, 102])
    composer(s, 45, split - 56)
    s.end()
    return split


PANEL_TAB = (120, PANEL)
PDF_TAB = (132, LOCAL_PDF)
PARSED_TAB = (104, PARSED)
MANAGER_TAB = (155, MANAGER)


def library(s, *, state="full"):
    full = s.width == 1000
    searching = state == "search"
    dock = [PANEL_TAB] if full else [PDF_TAB, PANEL_TAB]
    split = side_frame(s, dock, len(dock) - 1, reading=state == "confirm")
    w, h = s.width, s.height
    s.group("library-panel")
    s.rect(split + 1, 32, w - split - 1, 43, "pane")
    s.button(split + 9, 41, 104, "My Library")
    s.icon("chevron", split + 92, 46)
    s.icon("doc", split + 122, 46)
    s.text(split + 142, 59, ("解析文档管理", "Manage parsed docs"), "small")
    field = split + 282
    s.rect(field, 41, w - field - 141, 26, "paper border" if not searching else "select edge", 4)
    s.icon("search", field + 7, 46)
    query_placeholder = ("搜索标题、作者、年份…", "Search title, author, year…") if full else ("搜索标题、作者…", "Search title…")
    s.text(field + 28, 59, "diffusion" if searching else query_placeholder,
           "label" if searching else "small muted")
    if searching:
        s.icon("close", w - 162, 46)
    s.button(w - 134, 41, 83, ("修改时间", "Modified"))
    s.dot(w - 42, 54)
    s.icon("refresh", w - 27, 46)
    s.line(split, 76, w, 76)

    tree = 128 if full else 113
    items = split + tree
    detail = 721 if full else 565
    s.group("collection-tree")
    s.rect(split + 1, 77, tree - 1, h - 77, "chrome")
    s.line(items, 76, items, h)
    s.rect(split + 5, 91, tree - 10, 26, "select", 4)
    s.line(split + 6, 94, split + 6, 114, "edge")
    for y, label in [(109, ("全部条目", "All items")), (137, ("我的出版物", "Publications")), (165, ("回收站", "Trash"))]:
        s.text(split + 14, y, label, "small label" if y == 109 else "small muted")
    s.text(split + 12, 197, ("合集", "Collections"), "small muted")
    for index, (label, count) in enumerate([
        (("视觉与生成…", "Vision…"), "4"), (("语言模型与…", "Language…"), "4"), (("综述与经典", "Surveys…"), "2"),
    ]):
        y = 224 + index * 28
        s.icon("folder", split + 10, y - 12)
        s.text(split + 30, y, label, "small")
        if full:
            s.text(items - 10, y, count, "small muted", "end")
    s.end()

    s.group("library-items", (items + 1, 77, (w if searching else detail) - items - 1, h - 77, 0))
    filters = [(0, 61, ("条目类型", "Type")), (64, 52, ("标签", "Tags")),
               (119, 93, ("附件条件", "Attachment")), (215, 55, ("年份", "Year"))]
    if state == "confirm":
        filters = filters[:3]
    for dx, width, label in filters:
        s.tag(items + 8 + dx, 88, width, label)
    s.line(items, 117, w if searching else detail, 117)
    s.text(items + 11, 142, ("全部条目", "All items"), "label")
    count = ("共 1 条", "1 item") if searching else ("共 11 条", "11 items")
    s.text((w if searching else detail) - 12, 142, count, "small muted", "end")
    entries = (
        [(DIFFUSION, "2020 · Jonathan Ho; Ajay Jain; Pieter Abbeel", True)]
        if searching else [
            (ATTENTION, "2017 · Ashish Vaswani et al.", True),
            ("BERT: Pre-training of Deep…", "2019 · Jacob Devlin et al.", True),
            (GPT, "2020 · Tom B. Brown et al.", False),
            ("Chain-of-Thought Prompting", "2022 · Jason Wei et al.", False),
            ("ImageNet Classification with Deep…", "2012 · Alex Krizhevsky et al.", False),
            ("Deep Residual Learning for…", "2016 · Kaiming He et al.", True),
            ("Denoising Diffusion…", "2020 · Jonathan Ho et al.", True),
        ]
    )
    for index, (title, metadata, pdf) in enumerate(entries):
        y = 151 + index * 53
        limit = w if searching else detail
        if not searching and index == 0:
            s.rect(items + 6, y, limit - items - 12, 48, "select", 4)
            s.line(items + 7, y + 3, items + 7, y + 45, "edge")
        if full or searching or index == 0:
            s.text(items + 13, y + 20, title, "label" if index == 0 else "small label")
            s.text(items + 13, y + 39, metadata, "small muted")
            if pdf and state != "confirm":
                s.tag(limit - 53, y + 14, 43, "PDF", True)
        else:
            s.placeholder(items + 13, y + 20, [172 - index * 7, 126 - index * 9])
    s.end()

    if not searching:
        s.group("item-inspector")
        s.line(detail, 76, detail, h)
        x = detail + 12
        s.text(x, 100, ("会议论文", "Conference paper"), "small muted")
        s.text(x, 125, ATTENTION, "lead")
        s.lines(x, 150, ["Ashish Vaswani; Noam Shazeer;", "Niki Parmar; Jakob Uszkoreit et al.",
                         "NeurIPS 30 · 2017-12"], "small muted", 19)
        s.button(x, 207, 83, ("阅读 PDF", "Read PDF"), active=True)
        s.button(x + 89, 207, 100, ("解析此 PDF", "Parse PDF"))
        s.button(x, 241, 104, ("复制引用", "Copy citation"))
        s.button(x + 110, 241, 121 if full else 99, ("导出引用", ("Export citation" if full else "Export")))
        if full:
            s.button(x + 195, 207, 58, ("提问", "Ask"))
        s.line(detail, 282, w, 282)
        s.text(x, 308, ("摘要", "Abstract"), "label")
        s.lines(x, 335, ["The dominant sequence", "transduction models are based",
                         "on complex recurrent or", "convolutional neural networks…"], "small", 19)
        s.line(detail, 414, w, 414)
        s.text(x, 441, ("信息", "Info"), "label")
        s.text(x, 467, "arXiv:1706.03762", "small mono accent")
        if full:
            s.line(detail, 487, w, 487)
            s.text(x, 513, ("所属合集", "Collections"), "small muted")
            s.tag(x, 525, 217, SCOPE)
            s.line(detail, 562, w, 562)
            s.text(x, 589, ("附件 (1)", "Attachments (1)"), "small label")
        s.end()
    s.end()


def panel_full(s):
    library(s)


def panel_search(s):
    library(s, state="search")


ATTRIBUTION = [
    "Provided proper attribution is provided, Google hereby grants permission",
    "to reproduce the tables and figures in this paper solely for use",
    "in journalistic or scholarly works.",
]


def panel_pdf(s):
    split = side_frame(s, [PANEL_TAB, PDF_TAB], 1)
    s.group("pdf-reader", (split + 1, 32, 800 - split - 1, 467, 0))
    s.rect(split + 1, 32, 800 - split, 30, "chrome")
    s.text(split + 13, 52, "Vaswani et al. 2017 - Attention Is All You Need.pdf", "small muted")
    s.icon("refresh", 748, 38)
    s.icon("folder", 773, 38)
    s.line(split, 62, 800, 62)
    s.rect(split + 42, 75, 492, 458, "paper border")
    mid = split + 288
    for i, value in enumerate(ATTRIBUTION):
        s.text(mid, 111 + i * 16, value, "small serif warning", "middle")
    s.line(mid - 192, 158, mid + 192, 158, "border")
    s.text(mid, 187, ATTENTION, "heading serif", "middle")
    s.line(mid - 192, 202, mid + 192, 202, "border")
    for y, authors in [
        (233, ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"]),
        (262, ["Llion Jones", "Aidan N. Gomez", "Łukasz Kaiser"]),
        (291, ["Illia Polosukhin"]),
    ]:
        for index, author in enumerate(authors):
            s.text(mid + (index - (len(authors) - 1) / 2) * 121, y, author, "small serif label", "middle")
    s.text(mid, 326, "Abstract", "lead serif", "middle")
    s.lines(mid - 177, 352, [
        "The dominant sequence transduction models are based on",
        "complex recurrent or convolutional neural networks that",
        "include an encoder and a decoder.",
    ], "small serif", 17)
    s.placeholder(mid - 177, 413, [358, 335, 349, 326, 356, 255], 12)
    s.end()


def scholarly_search(s):
    frame(s, session=SCHOLARLY)
    bubble(s, 74, (
        ["用学术检索查一下 2026 年大语言模型在管理科学领域的最新论文，", "须是 AJG 4 以上期刊发表的。"],
        ["Find recent 2026 papers on LLMs in management science", "published in journals rated AJG 4 or higher."],
    ), x=184)
    tool(s, 166, "scholarly_search", "large language models management science 2026", "spark")
    tool(s, 197, "scholarly_search", "LLM decision making operations management 2026", "spark")
    s.rect(76, 216, 684, 59, "warning-bg border", 5)
    s.lines(88, 239, (
        ["OpenAlex / Semantic Scholar 限流（429），DBLP 遇到验证。", "返回以 arXiv 预印本为主，继续按期刊和来源定向检索。"],
        ["OpenAlex / Semantic Scholar rate-limited (429). DBLP challenge.", "Mostly arXiv preprints. Continuing with targeted source and journal searches."],
    ), "warning", 21)
    tool(s, 306, "scholarly_search", "large language model operations management", "spark")
    tool(s, 337, "scholarly_search", "generative AI large language model Management Science journal", "spark")
    s.icon("doc", 77, 356)
    s.text(102, 369, ("网页获取", "Web fetch"), "small muted")
    s.text(279, 369, "github.com/xiaoyangyyy/abs-journals", "small")
    tool(s, 411, "scholarly_get", "10.1177/10591478261474243", "spark")
    composer(s, stop=True)


def scholarly_results(s):
    frame(s, session=SCHOLARLY)
    s.text(76, 91, ("检索口径", "Search parameters"), "heading")
    s.text(76, 116, ("2026 年（截至 11 月 22 日，含在线优先） · AJG 2024 的 139 本 4/4* 期刊",
                     "2026 (through Nov 22, including online-first) · 139 AJG 2024 journals rated 4 or 4*"), "small")
    s.rect(76, 128, 698, 54, "warning-bg border", 4)
    s.lines(87, 149, (
        ["OpenAlex / Semantic Scholar 限流（HTTP 429），改用 Crossref 交叉核验。",
         "回答报告约 165 篇命中，精选 22 篇。"],
        ["OpenAlex / Semantic Scholar rate-limited (HTTP 429). Cross-checked via Crossref.",
         "The answer reports about 165 matches and highlights 22 papers."],
    ), "small warning", 19)
    s.text(76, 210, ("运筹优化与运营管理", "Optimization and operations management"), "lead")
    s.text(76, 237, ("期刊（AJG）", "Journal (AJG)"), "small muted")
    s.text(304, 237, ("论文", "Paper"), "small muted")
    s.text(774, 237, ("在线日期", "Online date"), "small muted", "end")
    for index, (journal, paper, date) in enumerate([
        (["Operations Research (4*)"],
         ["Democratizing Optimization with Generative AI", "Simchi-Levi, Dai, Menache, Wu"], "11-03"),
        (["Production and Operations", "Management (4)"],
         ["Assured autonomy: How operations research", "powers and orchestrates generative AI systems"], "06-12"),
        (["Production and Operations", "Management (4)"],
         ["AI and its impact on creativity and diversity", "Terwiesch, Meincke, Girotra, Mollick, Nave, Ulrich"], "07-22"),
        (["Management Science (4*)"],
         ["Regurgitative Training: The Value of Real Data", "in Training LLMs"], "05-11"),
    ]):
        y = 262 + index * 47
        s.line(76, y - 16, 774, y - 16)
        s.lines(76, y, journal, "small label", 17)
        s.lines(304, y, paper, "accent", 17)
        s.text(774, y, date, "small mono", "end")
    composer(s)


def parse_confirm(s):
    library(s, state="confirm")
    s.group("mineru-confirmation")
    s.elements.append('<rect width="800" height="500" fill="#1e293b" opacity=".28"/>')
    s.rect(180, 118, 440, 264, "paper border", 9)
    s.text(196, 150, ("使用 MinerU 解析文档", "Parse document with MinerU"), "heading")
    s.icon("close", 588, 135)
    for y, label, value in [
        (186, ("所选文档", "Selected document"), PARSED),
        (213, ("外部服务", "External service"), "MinerU (mineru.net)"),
        (240, ("提交模式", "Submission mode"), ("Agent 轻量解析", "Agent Lightweight Parse")),
    ]:
        s.text(196, y, label, "small muted")
        s.text(334, y, value, "label warning" if y == 213 else "label")
    s.rect(195, 253, 410, 74, "warning-bg", 4)
    s.lines(205, 273, (
        ["单文件上限 10 MB、20 页。", "解析正在后台进行，如需停止请点击「取消解析」。"],
        ["Up to 10 MB and 20 pages per PDF.", "Parsing is in progress in the background.",
         "To stop, choose “Cancel parsing”."],
    ), "small warning", 20)
    s.button(271, 336, 131, ("刷新状态", "Refresh status"), icon="refresh")
    s.button(412, 336, 191, ("提交 PDF 到 MinerU", "Submit PDF to MinerU"), active=True)
    s.end()


def parsed_reader(s, selected):
    split = side_frame(s, [PDF_TAB, PANEL_TAB, PARSED_TAB], 2, reading=True)
    x = split + 12
    s.group("markdown-reader", (split + 1, 32, 800 - split - 1, 468, 0))
    s.text(x, 53, ATTENTION, "small label")
    s.icon("copy", 631, 40)
    s.icon("download", 656, 40)
    s.text(710, 53, ("重新解析", "Reparse"), "small muted", "middle")
    s.icon("refresh", 772, 40)
    s.line(split, 62, 800, 62)
    s.placeholder(x, 79, [468, 135])
    s.text(x, 126, ATTENTION, "heading")
    s.lines(x, 155, [
        "Ashish Vaswani · Google Brain", "Noam Shazeer · Google Brain",
        "Niki Parmar · Google Research", "Jakob Uszkoreit · Google Research",
    ], "small muted", 20)
    s.placeholder(x, 237, [174, 137], 13)
    s.text(x, 282, "Abstract", "heading")
    s.lines(x, 308, [
        "The dominant sequence transduction models are based on complex",
        "recurrent or convolutional neural networks that include an encoder and a",
    ], "small", step=19)
    if selected:
        s.rect(x - 1, 333, 497, 20, "select", 2)
    accent = ' class="accent"' if selected else ""
    s.markup(x, 347, f'<tspan textLength="495"{accent}>decoder. The best performing models also connect the encoder an</tspan>d', "small")
    s.lines(x, 367, [
        "decoder through an attention mechanism. We propose a new simple",
        "network architecture, the Transformer, based solely on attention",
        "mechanisms, dispensing with recurrence and convolutions entirely.",
    ], "small", step=19)
    s.placeholder(x, 434, [504, 363])
    s.rect(split + 1, 471, 800 - split - 1, 29, "chrome")
    s.line(split, 471, 800, 471)
    s.text(785, 490, ("共 42187 字符", "42,187 characters"), "small muted", "end")
    if selected:
        s.group("selection-menu")
        s.rect(558, 354, 228, 62, "paper border", 5)
        s.rect(562, 358, 220, 26, "select", 4)
        s.icon("spark", 567, 363)
        s.text(590, 377, ("让模型解释", "Explain"), "small accent label")
        s.icon("copy", 567, 391)
        s.text(590, 405, ("复制选中内容", "Copy selection"), "small")
        s.end()
    s.end()


def parsed_markdown(s):
    parsed_reader(s, selected=False)


def parsed_select(s):
    parsed_reader(s, selected=True)


def parsed_manager(s):
    split = side_frame(s, [PDF_TAB, PANEL_TAB, PARSED_TAB, MANAGER_TAB], 3, reading=True)
    x = split + 12
    s.group("parsed-document-manager")
    for offset, width, label in [
        (0, 43, ("全部", "All")), (49, 62, ("正常", "Normal")),
        (117, 77, ("孤立", "Orphaned")), (200, 77, ("损坏", "Broken")),
    ]:
        s.tag(x + offset, 44, width, label, active=offset == 0)
    s.rect(x, 74, 275, 26, "paper border", 4)
    s.icon("search", x + 6, 79)
    s.text(x + 28, 92, ("搜索标题或来源", "Search titles or sources"), "small muted")
    s.button(520, 74, 120, ("解析 PDF URL", "Parse PDF URL"))
    s.button(646, 74, 130, ("批量解析 PDF", "Batch parse PDFs"))
    s.line(split, 111, 800, 111)
    s.dot(x + 5, 134)
    s.text(x + 16, 140, ("全文检索 · 1/1 篇文档可搜索", "Full-text search · 1/1 documents searchable"), "label")
    s.text(x, 177, ("共 1 个文档", "1 document"), "small muted")
    s.text(783, 177, ("全选", "Select all"), "small muted", "end")
    s.line(x, 189, 787, 189)
    s.rect(x, 205, 15, 15, "paper border", 2)
    s.text(x + 25, 219, ATTENTION, "lead")
    s.text(x + 25, 243, ("附件 9VWQ8CZ9 · 4 分钟前 · 41 KB · 42,187 字符",
                         "Attachment 9VWQ8CZ9 · 4 min ago · 41 KB · 42,187 characters"), "small muted")
    s.icon("eye", 711, 229)
    s.icon("spark", 739, 229)
    s.icon("trash", 768, 229)
    s.end()


def project_overview(s):
    def connect(path, *, dashed=False):
        dash = ' stroke-dasharray="4 4"' if dashed else ""
        s.elements.append(
            f'<path d="{path}" class="edge" fill="none" stroke-linecap="round"'
            f' stroke-linejoin="round"{dash}/>'
        )

    s.group("project-overview", (0, 0, s.width, s.height, 10))
    s.rect(0, 0, s.width, s.height)

    s.group("scholarly-indexes")
    s.rect(18, 48, 164, 70, "pane border", 6)
    s.text(30, 76, ("外部学术索引", "Scholarly indexes"), "label")
    s.text(30, 100, ("可选检索", "Opt-in search"), "small muted")
    s.end()

    s.group("local-zotero")
    s.rect(18, 144, 164, 117, "pane border", 6)
    s.text(30, 173, ("本地 Zotero", "Local Zotero"), "lead")
    s.text(30, 194, "Local API", "small mono accent")
    s.line(30, 205, 169, 205)
    s.lines(30, 226, (
        ["条目 · 合集", "PDF · 批注"], ["Items · Collections", "PDFs · Annotations"],
    ), "small muted", 20)
    s.end()
    s.text(30, 291, ("写入需审批", "Writes require approval"), "small muted")

    s.group("harness-workspace")
    s.rect(212, 16, 610, 308, "pane border", 8)
    s.text(230, 43, "DeepSeek Harness", "lead")
    s.group("research-question")
    s.rect(230, 55, 574, 35, "chrome", 5)
    s.text(244, 77, ("研究问题", "Research question"), "small label")
    s.text(390, 77, ("“哪些论文支持这个结论？”", "“Which papers support this claim?”"), "small muted")
    s.end()

    s.group("agent-research")
    s.rect(230, 112, 234, 132, "paper border", 6)
    s.icon("spark", 244, 123)
    s.text(269, 137, ("Agent 研读", "Research agent"), "lead")
    s.text(244, 162, ("动态加载研究 SOP", "Dynamic SOP loading"), "small label")
    s.text(244, 182, ("阶段预算与终止条件", "Stage budgets · Exit criteria"), "small muted")
    s.line(244, 194, 450, 194)
    s.text(244, 214, ("Zotero 工具", "Zotero tools"), "small label")
    s.text(244, 233, ("检索 · 摘录 · 生成引用", "Search · Retrieve · Cite"), "small muted")
    s.end()

    s.group("session-literature-trail")
    s.rect(530, 112, 274, 132, "select border", 6)
    s.icon("link", 544, 123)
    s.text(569, 137, TRAIL, "lead accent")
    s.text(544, 162, ("本会话 · 只读", "Session · Read-only"), "small accent")
    s.line(547, 180, 547, 225)
    for y, value in [
        (187, ("检索条件 · 范围", "Queries · Scope")),
        (208, ("摘录 · 出处 · 覆盖度", "Passages · Sources · Coverage")),
        (229, ("BibTeX 与引用去重汇总", "Deduplicated BibTeX & citations")),
    ]:
        s.dot(547, y - 5)
        s.text(560, y, value, "small")
    s.end()

    s.group("independent-library-panel")
    s.rect(230, 275, 574, 33, "paper border", 5)
    s.icon("folder", 244, 283)
    s.text(268, 297, PANEL, "lead")
    s.text(428, 297, ("独立浏览文献库 · 阅读 PDF · 复制引用",
                     "Browse independently · Read PDFs · Copy citations"), "small muted")
    s.end()
    s.text(497, 136, "Zotero", "small muted", "middle")
    s.text(497, 154, ("工具结果", "results"), "small muted", "middle")
    s.text(365, 266, ("文献引用填入会话草稿", "Insert references into chat draft"), "small muted")
    s.end()

    s.group("research-connections")
    connect("M182 83H195V133H224", dashed=True)
    connect("M225 129l4 4-4 4M182 178H229m-4-4 4 4-4 4")
    connect("M202 178V291H229m-4-4 4 4-4 4")
    connect("M346 91v20m-4-4 4 4 4-4M464 168H529m-4-4 4 4-4 4")
    connect("M346 274V250", dashed=True)
    connect("M342 249l4-4 4 4")
    s.dot(202, 178)
    s.end()

    s.group("optional-document-parsing")
    s.rect(18, 339, 804, 31, "pane border", 5)
    s.text(31, 359, ("可选解析", "Opt-in parsing"), "small label accent")
    s.text(149, 359, (
        "用户主动提交 PDF 至 MinerU 解析，生成的 Markdown 可供后续研读复用。",
        "Users submit PDFs to MinerU for parsing. Later reads can reuse the resulting Markdown.",
    ), "small muted")
    s.end()


def main():
    parser = ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Check that the committed SVGs match the renderer.")
    mode.add_argument("--market-png", action="store_true", help="Export screenshots.json entries from their matching SVGs.")
    args = parser.parse_args()

    if args.market_png:
        renderer = which("rsvg-convert")
        if renderer is None:
            parser.error("--market-png requires rsvg-convert")
        for entry in json.loads((ROOT / "screenshots.json").read_text(encoding="utf-8")):
            png = ROOT / entry
            svg = OUTPUT / f"{png.stem}.svg"
            png.parent.mkdir(parents=True, exist_ok=True)
            run([renderer, "--zoom", "2", "--output", str(png), str(svg)], check=True)
        return

    scenes = (
        (project_overview, ("dsh-zotero 科研工作流架构", "dsh-zotero research workflow architecture"),
         ("研究问题进入 DeepSeek Harness 会话。Agent 动态加载研究 SOP，按阶段预算和终止条件调用 Zotero 工具及可选的外部学术检索。文献轨迹汇总本会话的工具结果，供核对摘录、出处和覆盖度，并提供 BibTeX 与引用的去重导出。文献面板支持独立浏览文献库，并将选中条目的引用填入会话草稿。写入需审批。用户可主动提交 PDF 至 MinerU 解析，生成的 Markdown 可供后续研读复用。",
          "A research question enters a DeepSeek Harness session. The agent dynamically loads a research SOP and follows its stage budgets and exit criteria when using Zotero tools and opt-in scholarly search. The session literature trail collects tool results for passage, source, and coverage review, and offers deduplicated BibTeX and citation exports. The literature panel lets users browse the library independently and insert references to selected items into the chat draft. Library writes require approval. Users can submit PDFs to MinerU for parsing, and later reads can reuse the resulting Markdown.")),
        (chat_search, ("Agent 对话中的 Zotero 检索", "Zotero search in chat"),
         ("本地库检索问题、工具调用，以及五个查询的文献与笔记命中数。", "A local library question, tool calls, and paper and note counts for five queries.")),
        (chat_answer, ("摘要证据与论文时间线", "Abstract evidence and paper timeline"),
         ("同一会话中关于思维链的摘要摘录，以及 2017 至 2022 年的四篇论文。", "An abstract passage about chain-of-thought and four papers from 2017 to 2022 in the same chat.")),
        (chat_formulas_prompt, ("询问多头注意力并定位 PDF 原文", "Question and PDF provenance for multi-head attention"),
         ("用户的公式问题、论文出处、索引覆盖、全文分块和原文定义。", "A formula question, paper citation, index coverage, full-text chunks, and a quoted definition.")),
        (chat_formulas_def, ("注意力原文定义与缩放点积公式", "Quoted definition and scaled dot-product attention equation"),
         ("正文摘录与论文第 3.2.1 节的公式 (1)，以及第 3.2.2 节的多头定义摘录。", "Excerpts from the paper, equation 1 from section 3.2.1, and a multi-head definition excerpt from section 3.2.2.")),
        (trail_inspector, ("文献轨迹中的 GPT-3 摘录与来源", "GPT-3 passage and origins in the literature trail"),
         ("会话顶部文献轨迹中的筛选列表、选中文献的摘要证据、BibTeX 和各检索来源状态。", "The session-level trail shows the filtered papers, selected abstract evidence, BibTeX, and retrieval source states.")),
        (trail_export, ("文献轨迹中的三条 BibTeX 导出", "Three BibTeX exports in the literature trail"),
         ("导出标签页显示三个引用键、展开的 BibTeX 代码片段和复制或下载入口。", "The exports tab shows three citation keys, an expanded BibTeX excerpt, and copy and download controls.")),
        (panel_full, ("右侧文献面板中的合集、列表和详情", "Collections, items, and details in the right-hand literature panel"),
         ("对话旁的文献面板分为三栏，选中 Attention Is All You Need，并显示 PDF 与引用操作。", "The literature panel beside the chat has three panes, with Attention Is All You Need selected and PDF and citation actions visible.")),
        (panel_search, ("文献面板按 diffusion 筛选", "Filtering the literature panel for diffusion"),
         ("右侧文献面板的搜索框输入 diffusion，列表显示一篇命中的扩散模型论文。", "The right-hand literature panel searches for diffusion and shows one matching paper.")),
        (panel_pdf, ("右侧独立 PDF 标签页", "A separate PDF tab on the right"),
         ("对话右侧打开 Attention Is All You Need 的 PDF 首页。", "The first page of Attention Is All You Need is open beside the conversation.")),
        (scholarly_search, ("对话中的学术工具调用与索引限流", "Scholarly tool calls and index rate limits in chat"),
         ("Agent 按 2026 年与 AJG 4 以上期刊的条件检索，遇到索引限流后改为定向查找。", "The agent searches for 2026 papers in journals rated AJG 4 or higher, then follows up with targeted queries after rate limits.")),
        (scholarly_results, ("学术检索口径与代表性结果", "Scholarly search criteria and representative results"),
         ("回答注明检索范围、429 限流与 Crossref 交叉核验，并列出部分论文、期刊和在线日期。", "The answer states the search scope, HTTP 429 rate limits, and Crossref cross-check and lists sample papers, journals, and online dates.")),
        (parse_confirm, ("MinerU 的 PDF 外发确认卡", "MinerU PDF submission dialog"),
         ("文献面板上方的确认卡显示外部服务、提交模式、文件限制、后台解析提示和提交按钮。", "The modal over the literature panel shows the external service, submission mode, file limits, background parsing notice, and submit button.")),
        (parsed_markdown, ("解析后的 Markdown 全文阅读", "Reading parsed Markdown"),
         ("右侧全文标签页显示论文标题与摘要，左侧保留会话上下文。", "The full-text tab shows the title and abstract beside the conversation.")),
        (parsed_select, ("在解析全文中选段并让模型解释", "Selecting parsed text for the model to explain"),
         ("同一论文的摘要中有选中文字，旁边的菜单提供让模型解释和复制选中内容。", "A selection in the same abstract opens a menu to explain it with the model or copy it.")),
        (parsed_manager, ("解析管理中的全文索引和条目", "Full-text index and item in parse management"),
         ("右侧解析管理标签页提供状态筛选和解析入口，显示一篇可全文检索的文档。", "The right-hand management tab has status filters and parse actions and shows one full-text searchable document.")),
    )
    if not args.check:
        OUTPUT.mkdir(parents=True, exist_ok=True)
    stale = []
    for draw, title, desc in scenes:
        for lang, suffix in enumerate(("zh", "en")):
            if draw == project_overview:
                scene = Scene(lang, width=840, height=386)
            else:
                scene = Scene(lang, width=1000 if draw == panel_full else 800)
            draw(scene)
            svg = scene.finish(title, desc)
            name = draw.__name__.replace("_", "-")
            path = OUTPUT / f"{name}.{suffix}.svg"
            if args.check:
                if not path.is_file() or path.read_text(encoding="utf-8") != svg:
                    stale.append(path.name)
            else:
                path.write_text(svg, encoding="utf-8")
    if stale:
        parser.exit(1, "Stale or missing SVGs: " + ", ".join(stale) + "\n")


if __name__ == "__main__":
    main()
