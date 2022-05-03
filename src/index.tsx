/// <reference types="monaco-editor" />
import { InfoRecord, LeanJsOpts, Message, Severity } from "lean-client-js-browser";
import * as React from "react";
import { createPortal, findDOMNode, render } from "react-dom";
import * as sp from "react-split-pane";
import {
  allMessages,
  checkInputCompletionChange,
  checkInputCompletionPosition,
  currentlyRunning,
  delayMs,
  registerLeanLanguage,
  server,
  tabHandler,
} from "./langservice";
export const SplitPane: any = sp;

function leanColorize(text: string): string {
  // TODO(gabriel): use promises
  const colorized: string = (monaco.editor.colorize(text, "lean", {}) as any)._value;
  return colorized.replace(/&nbsp;/g, " ");
}

interface MessageWidgetProps {
  msg: Message;
}
function severityTo_zh(s: Severity): string {
  switch (s) {
    case "error":
      return "错误信息";
    case "information":
      return "提示信息";
    case "warning":
      return "警告信息";
  }
}

function MessageWidget({ msg }: MessageWidgetProps) {
  const colorOfSeverity = {
    information: "green",
    warning: "orange",
    error: "red",
  };
  // TODO: links and decorations on hover
  return (
    <div style={{ paddingBottom: "1em" }}>
      <div className="info-header" style={{ color: colorOfSeverity[msg.severity] }}>
        行 {msg.pos_line}，列 {msg.pos_col}   {severityTo_zh(msg.severity)}【{msg.caption}】
      </div>
      <div className="code-block" dangerouslySetInnerHTML={{ __html: leanColorize(msg.text) }} />
    </div>
  );
}

interface Position {
  line: number;
  column: number;
}

interface GoalWidgetProps {
  goal: InfoRecord;
  position: Position;
}
function GoalWidget({ goal, position }: GoalWidgetProps) {
  const tacticHeader = goal.text && (
    <div className="info-header doc-header">
      行 {position.line}，列 {position.column}{"   "}
      {
        <span className="code-block" style={{ fontWeight: "normal", display: "inline" }}>
          {goal.text}
        </span>
      }{" "}
      策略：
    </div>
  );
  const docs = goal.doc && <ToggleDoc doc={goal.doc} />;

  const typeHeader = goal.type && (
    <div className="info-header">
      行 {position.line}，列 {position.column}
      {goal["full-id"] && (
        <span>
          {"   "}
          <span className="code-block" style={{ fontWeight: "normal", display: "inline" }}>
            {goal["full-id"]}
          </span>{" "}
          的类型：
        </span>
      )}
    </div>
  );
  const typeBody = goal.type &&
    !goal.text && ( // don't show type of tactics
      <div
        className="code-block"
        dangerouslySetInnerHTML={{ __html: leanColorize(goal.type) + (!goal.doc && "<br />") }}
      />
    );

  const goalStateHeader = goal.state && (
    <div className="info-header">
      行 {position.line}，列 {position.column}   目标：
    </div>
  );
  const goalStateBody = goal.state && (
    <div className="code-block" dangerouslySetInnerHTML={{ __html: leanColorize(goal.state) + "<br/>" }} />
  );

  return (
    // put tactic state first so that there's less jumping around when the cursor moves
    <div>
      {goalStateHeader}
      {goalStateBody}
      {tacticHeader || typeHeader}
      {typeBody}
      {docs}
    </div>
  );
}

interface ToggleDocProps {
  doc: string;
}
interface ToggleDocState {
  showDoc: boolean;
}
class ToggleDoc extends React.Component<ToggleDocProps, ToggleDocState> {
  constructor(props: ToggleDocProps) {
    super(props);
    this.state = { showDoc: this.props.doc.length < 80 };
    this.onClick = this.onClick.bind(this);
  }
  onClick() {
    this.setState({ showDoc: !this.state.showDoc });
  }
  render() {
    return (
      <div onClick={this.onClick} className="toggleDoc">
        {this.state.showDoc ? (
          this.props.doc // TODO: markdown / highlighting?
        ) : (
          <span>
            {this.props.doc.slice(0, 75)} <span style={{ color: "#246" }}>[...]</span>
          </span>
        )}
        <br />
        <br />
      </div>
    );
  }
}

enum DisplayMode {
  OnlyState, // only the state at the current cursor position including the tactic state
  AllMessage, // all messages
}

interface InfoViewProps {
  file: string;
  cursor?: Position;
}
interface InfoViewState {
  goal?: GoalWidgetProps;
  messages: Message[];
  displayMode: DisplayMode;
}
class InfoView extends React.Component<InfoViewProps, InfoViewState> {
  private subscriptions: monaco.IDisposable[] = [];

  constructor(props: InfoViewProps) {
    super(props);
    this.state = {
      messages: [],
      displayMode: DisplayMode.OnlyState,
    };
  }
  componentWillMount() {
    this.updateMessages(this.props);
    let timer = null; // debounce
    this.subscriptions.push(
      server.allMessages.on((allMsgs) => {
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          this.updateMessages(this.props);
          this.refreshGoal(this.props);
        }, 100);
      })
    );
  }
  componentWillUnmount() {
    for (const s of this.subscriptions) {
      s.dispose();
    }
    this.subscriptions = [];
  }
  componentWillReceiveProps(nextProps) {
    if (nextProps.cursor === this.props.cursor) {
      return;
    }
    this.updateMessages(nextProps);
    this.refreshGoal(nextProps);
  }

  updateMessages(nextProps) {
    this.setState({
      messages: allMessages.filter((v) => v.file_name === this.props.file),
    });
  }

  refreshGoal(nextProps?: InfoViewProps) {
    if (!nextProps) {
      nextProps = this.props;
    }
    if (!nextProps.cursor) {
      return;
    }

    const position = nextProps.cursor;
    server.info(nextProps.file, position.line, position.column).then((res) => {
      this.setState({ goal: res.record && { goal: res.record, position } });
    });
  }

  render() {
    const goal = this.state.displayMode === DisplayMode.OnlyState && this.state.goal && (
      <div key={"goal"}>{GoalWidget(this.state.goal)}</div>
    );
    const filteredMsgs =
      this.state.displayMode === DisplayMode.AllMessage
        ? this.state.messages
        : this.state.messages.filter(({ pos_col, pos_line, end_pos_col, end_pos_line }) => {
            if (!this.props.cursor) {
              return false;
            }
            const { line, column } = this.props.cursor;
            return (
              pos_line <= line &&
              ((!end_pos_line && line === pos_line) || line <= end_pos_line) &&
              (line !== pos_line || pos_col <= column) &&
              (line !== end_pos_line || end_pos_col >= column)
            );
          });
    const msgs = filteredMsgs.map((msg, i) => <div key={i}>{MessageWidget({ msg })}</div>);
    return (
      <div style={{ overflow: "auto", height: "100%" }}>
        <div className="infoview-buttons">
          <img
            src="./display-goal-light.svg"
            title="Display Goal"
            style={{ opacity: this.state.displayMode === DisplayMode.OnlyState ? 1 : 0.25 }}
            onClick={() => {
              this.setState({ displayMode: DisplayMode.OnlyState });
            }}
          />
          <img
            src="./display-list-light.svg"
            title="Display Messages"
            style={{ opacity: this.state.displayMode === DisplayMode.AllMessage ? 1 : 0.25 }}
            onClick={() => {
              this.setState({ displayMode: DisplayMode.AllMessage });
            }}
          />
        </div>
        {goal}
        {msgs}
      </div>
    );
  }
}

interface PageHeaderProps {
  file: string;
  url: string;
  onSubmit: (value: string) => void;
  status: string;
  onSave: () => void;
  onLoad: (localFile: string, lastFileName: string) => void;
  clearUrlParam: () => void;
  onChecked: () => void;
}
interface PageHeaderState {
  currentlyRunning: boolean;
}
class PageHeader extends React.Component<PageHeaderProps, PageHeaderState> {
  private subscriptions: monaco.IDisposable[] = [];

  constructor(props: PageHeaderProps) {
    super(props);
    this.state = { currentlyRunning: true };
    this.onFile = this.onFile.bind(this);
    // this.restart = this.restart.bind(this);
  }

  componentWillMount() {
    this.updateRunning(this.props);
    this.subscriptions.push(currentlyRunning.updated.on((fns) => this.updateRunning(this.props)));
  }
  componentWillUnmount() {
    for (const s of this.subscriptions) {
      s.dispose();
    }
    this.subscriptions = [];
  }
  componentWillReceiveProps(nextProps) {
    this.updateRunning(nextProps);
  }

  updateRunning(nextProps) {
    this.setState({
      currentlyRunning: currentlyRunning.value.indexOf(nextProps.file) !== -1,
    });
  }

  onFile(e) {
    const reader = new FileReader();
    const file = e.target.files[0];
    reader.readAsText(file);
    reader.onload = () => this.props.onLoad(reader.result as string, file.name);
    this.props.clearUrlParam();
  }

  // This doesn't work! /test.lean not found after restarting
  // restart() {
  //   // server.restart();
  //   registerLeanLanguage(leanJsOpts);
  // }

  render() {
    const isRunning = this.state.currentlyRunning ? "正在运行" : "处于空闲状态";
    const runColor = this.state.currentlyRunning ? "orange" : "lightgreen";
    // TODO: add input for delayMs
    // checkbox for console spam
    // server.logMessagesToConsole = true;
    return (
      <div className="wrap-collapsible">
        <input
          id="collapsible"
          className="toggle"
          type="checkbox"
          defaultChecked={true}
          onChange={this.props.onChecked}
        />
        <label style={{ background: runColor }} htmlFor="collapsible" className="lbl-toggle" tabIndex={0}>
          Lean 定理证明器 {isRunning}
        </label>
        <div className="collapsible-content">
          <div className="leanheader">
            <a href="https://leanprover.github.io">
              <img
                className="logo"
                src="./lean_logo.svg"
                style={{ height: "5em", margin: "1ex", paddingLeft: "1em", paddingRight: "1em" }}
              />
            </a>
            <a href="https://chesium.com">
              <img
                className="logo"
                src="./chesium_studio.png"
                style={{ height: "5em", margin: "1ex", paddingLeft: "1em", paddingRight: "1em" }}
              />
            </a>
            <div className="headerForms">
              <UrlForm
                url={this.props.url}
                onSubmit={this.props.onSubmit}
                clearUrlParam={this.props.clearUrlParam}
              />
              <div style={{ float: "right", margin: "1em" }}>
                <button onClick={this.props.onSave}>下载</button>
              </div>
              <label className="logo" htmlFor="lean_upload">
                打开磁盘中的 .lean 文件:&nbsp;
              </label>
              <input id="lean_upload" type="file" accept=".lean" onChange={this.onFile} />
              <div className="leanlink">
                <Modal />
                &nbsp;
                <span className="logo">在线 </span>
                <a href="https://leanprover.github.io/">Lean 定理证明器</a>
                <span className="logo"> 中文版</span>
              </div>
              {this.props.status && (
                <span style={{ color: "red" }}>
                  Could not fetch (error: {this.props.status})!&nbsp;
                  {this.props.status.startsWith("TypeError") && (
                    <span>
                      If you see{" "}
                      <a href="https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS">
                        cross-origin (CORS) errors
                      </a>{" "}
                      in your browser's dev console, try{" "}
                      <a href="https://cors-anywhere.herokuapp.com/">a CORS proxy</a>, e.g. prepend
                      https://cors-anywhere.herokuapp.com/ to the beginning of your URL.
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

interface UrlFormProps {
  url: string;
  onSubmit: (value: string) => void;
  clearUrlParam: () => void;
}
interface UrlFormState {
  value: string;
}
class UrlForm extends React.Component<UrlFormProps, UrlFormState> {
  constructor(props) {
    super(props);
    this.state = { value: this.props.url };

    this.handleChange = this.handleChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleChange(event) {
    this.setState({ value: event.target.value });
    this.props.clearUrlParam();
  }

  handleSubmit(event) {
    this.props.onSubmit(this.state.value);
    event.preventDefault();
  }

  render() {
    return (
      <div className="urlForm">
        <form onSubmit={this.handleSubmit}>
          <span className="url">打开链接中的 .lean 文件&nbsp;</span>
          <input type="text" value={this.state.value} onChange={this.handleChange} />
          <input type="submit" value="打开" />
        </form>
      </div>
    );
  }
}

interface ModalState {
  isOpen: boolean;
}
// https://assortment.io/posts/accessible-modal-component-react-portals-part-1 & 2
// TODO: change focus back to button when modal closes
class Modal extends React.Component<{}, ModalState> {
  private modalNode: Node;
  constructor(props) {
    super(props);
    this.state = {
      isOpen: false,
    };
    this.open = this.open.bind(this);
    this.close = this.close.bind(this);
    this.keyDown = this.keyDown.bind(this);
    this.clickAway = this.clickAway.bind(this);
  }

  open() {
    this.setState({ isOpen: true }, () => {});
  }
  close() {
    this.setState({ isOpen: false });
  }
  keyDown({ keyCode }) {
    return keyCode === 27 && this.close();
  }
  clickAway(e) {
    if (this.modalNode && this.modalNode.contains(e.target)) {
      return;
    }
    this.close();
  }

  render() {
    return (
      <React.Fragment>
        <button className="modalButton" onClick={this.open}>
          ?
        </button>
        {this.state.isOpen && (
          <ModalContent
            onClose={this.close}
            onKeyDown={this.keyDown}
            clickAway={this.clickAway}
            modalRef={(n) => (this.modalNode = n)}
          />
        )}
      </React.Fragment>
    );
  }
}

function ModalContent({ onClose, modalRef, onKeyDown, clickAway }) {
  const libinfo = []; // populated with info about included libraries
  if (info) {
    for (const k in info) {
      if (info.hasOwnProperty(k)) {
        const v = info[k];
        if (v.match(/^https:\/\/raw\.githubusercontent\.com/)) {
          const urlArray = v.slice(34).split("/").slice(0, 3);
          const commit = urlArray[2].slice(0, 8);
          urlArray.unshift("https://github.com");
          urlArray.splice(3, 0, "tree");
          const url = urlArray.join("/");
          libinfo.push(
            <div key={libinfo.length - 1} className="code-block" style={{ fontWeight: "normal" }}>
              {k} : <a href={url}>{commit}</a>
            </div>
          );
        } else {
          libinfo.push(
            <div key={libinfo.length - 1} className="code-block" style={{ fontWeight: "normal" }}>
              {k} : {v}
            </div>
          );
        }
      }
    }
  }

  return createPortal(
    <aside className="c-modal-cover" tabIndex={-1} onClick={clickAway} onKeyDown={onKeyDown}>
      <div className="c-modal" ref={modalRef}>
        <h1>Lean 网页编辑器:</h1>
        <button className="c-modal__close" onClick={onClose} autoFocus>
          <span className="u-hide-visually">关闭</span>
          <svg className="c-modal__close-icon" viewBox="0 0 40 40">
            <path d="M 10,10 L 30,30 M 30,10 L 10,30"></path>
          </svg>
        </button>
        <div className="c-modal__body">
          <p>
            此网页由 Chesium 翻译 此网页运行着一个 WebAssembly 或 JavaScript 版本的{" "}
            <a href="https://leanprover.github.io">Lean 3</a>， 一个由{" "}
            <a href="https://research.microsoft.com/">Microsoft Research</a> 开发的定理证明器兼编程语言。
          </p>

          <h3>不熟悉 Lean？</h3>
          <p>
            注意此编辑器不是为严肃的使用目的设计的。大部分 Lean 用户使用 VS Code 或 Emacs 中的 Lean
            扩展插件来编写证明和程序。对于 Lean 3 和其标准库“mathlib”，
            <a href="https://leanprover-community.github.io/get_started.html">这里</a>
            有详细的安装教程。我们推荐新手从书籍《
            <a href="https://leanprover.github.io/theorem_proving_in_lean">Theorem Proving in Lean</a>》和《
            <a href="https://leanprover.github.io/logic_and_proof/">Logic and Proof</a>》开始学习 Lean。
            <a href="http://wwwf.imperial.ac.uk/~buzzard/xena/natural_number_game/">
              The "Natural number game"
            </a>{" "}
            提供了一个更加具有互动性的学习平台。更多资源请见 Github 上的{" "}
            <a href="https://leanprover-community.github.io/learn.html">Learning Lean page</a>{" "}
            一页。如果你有其他问题，欢迎来{" "}
            <a href="https://leanprover.zulipchat.com/#">leanprover zulip chat</a> 提出！
          </p>

          <h3>使用编辑器</h3>
          <p>
            在编辑器面板中输入 Lean 代码，或者在页面顶端的输入框中从链接或本地导入一个 .lean 文件并进行编辑。
            如果出现错误、警告或提示信息，相关代码会在编辑器中以红色或绿色的波浪线标出，而相关信息则会显示在页面中的信息栏。
          </p>
          <p>
            如果要输入 Unicode 字符，可以输入反斜线 “\”，输入字符对应的代码（见下）然后按下空格、逗号或 TAB
            键。
          </p>
          <p>
            下面是一些常用的代码，其实许多字符的代码与其 LaTeX 代码是一致的
            <br />
            "lam" 为 "λ"，"to" (或 "-&gt;") 为 "→"，"l" (或 "&lt;-") 为 "←"，"u" 为 "↑"，"d" 为 "↓"，"in" 为
            "∈"，"and" 为 "∧"，"or" 为 "∨"，"x" 为 "×"，"le" 与 "ge" (或 "&lt;=" 与 "&gt;=") 为 "≤" 与
            "≥"，"&lt;" 与 "&gt;" 为 "⟨" 与 "⟩"，"ne" 为 "≠"，"nat" 为 "ℕ"，"not" 为 "¬"，"int" 为 "ℤ",
            <br />
            (详细列表请见
            <a href="https://github.com/Chesium/lean-web-editor-zh_cn/blob/master/src/translations.json">
              这里
            </a>
            .)
          </p>
          <p>
            将指针悬浮在一个项（term）上，旁边会出现一个悬浮框，显示其类型。将光标置于代码中，对应类型或相关文档会显示在信息面板中。
          </p>
          <p>点击页面顶部有颜色的横条以 显示/隐藏 页面顶部 UI</p>
          <p>可以通过拖动编辑器面板和信息面板之间的分割线来改变其在页面中的大小占比</p>

          <h3>关于此编辑器</h3>
          <p>
            <a href="https://github.com/Chesium/lean-web-editor-zh_cn">此编辑器</a>是原
            <a href="https://leanprover.github.io/live">lean-web-editor</a> 的一个 Fork，其由
            TypeScript+ReactJS 写成 使用了 Monaco editor 作为编辑器，具体请见
            <a href="https://github.com/leanprover/lean-web-editor">原 Github 仓库</a>)。
          </p>
          <h3>library.zip 中的 Lean 扩展库</h3>
          {libinfo}
          <h3>设置</h3>
          <p>
            <input
              id="showUnderlines"
              type="checkbox"
              defaultChecked={!document.getElementById("hideUnderline")}
              onChange={(e) => {
                if (!e.target.checked && !document.getElementById("hideUnderline")) {
                  const style = document.createElement("style");
                  style.type = "text/css";
                  style.id = "hideUnderline";
                  style.appendChild(
                    document.createTextNode(`.monaco-editor .greensquiggly,
              .monaco-editor .redsquiggly { background-size:0px; }`)
                  );
                  document.head.appendChild(style);
                  window.localStorage.setItem("underline", "true");
                } else if (document.getElementById("hideUnderline")) {
                  document.getElementById("hideUnderline").remove();
                  window.localStorage.setItem("underline", "false");
                }
              }}
            />{" "}
            <label htmlFor="showUnderlines">使用波浪线来标识代码中的错误、警告和提示信息</label>
          </p>
          <p>
            <input
              id="showDocs"
              type="checkbox"
              defaultChecked={!document.getElementById("hideDocs")}
              onChange={(e) => {
                if (!e.target.checked && !document.getElementById("hideDocs")) {
                  const style = document.createElement("style");
                  style.type = "text/css";
                  style.id = "hideDocs";
                  style.appendChild(document.createTextNode(`.toggleDoc, .doc-header { display:none; }`));
                  document.head.appendChild(style);
                  window.localStorage.setItem("docs", "true");
                } else if (document.getElementById("hideDocs")) {
                  document.getElementById("hideDocs").remove();
                  window.localStorage.setItem("dosc", "false");
                }
              }}
            />{" "}
            <label htmlFor="showDocs">
              在信息栏中显示策略文档（无论其是否已被检验。策略文档也可以通过让指针悬浮在策略名上来查看）
            </label>
          </p>
          <h3>调试</h3>
          <p>
            <input
              id="logToConsole"
              type="checkbox"
              defaultChecked={server.logMessagesToConsole}
              onChange={(e) => {
                server.logMessagesToConsole = e.target.checked;
                window.localStorage.setItem("logging", e.target.checked ? "true" : "false");
                console.log(`server logging ${server.logMessagesToConsole ? "start" : "end"}ed!`);
              }}
            />{" "}
            {/* <label htmlFor="logToConsole">Log server messages to console</label> */}
            <label htmlFor="logToConsole">将 Lean server 的信息输入至控制台</label>
          </p>
          <p>
            <button
              onClick={(e) => {
                const req = indexedDB.deleteDatabase("leanlibrary");
                req.onsuccess = () => {
                  console.log("成功删除 leanlibrary");
                  location.reload();
                };
                req.onerror = () => {
                  console.log("无法删除 leanlibrary");
                };
                req.onblocked = () => {
                  console.log("无法删除 leanlibrary，由于操作被阻碍（operation being blocked）");
                };
              }}
            >
              清除扩展库缓存并刷新
            </button>
          </p>
          <p>
            <button
              onClick={() => {
                if ((self as any).WebAssembly) {
                  fetch(leanJsOpts.webassemblyJs, { cache: "reload" })
                    .then(() => fetch(leanJsOpts.webassemblyWasm, { cache: "reload" }))
                    .then(() => {
                      console.log("成功更新 JS & WASM 缓存");
                      location.reload();
                    })
                    .catch((e) => console.log(e));
                } else {
                  fetch(leanJsOpts.javascript, { cache: "reload" })
                    .then(() => {
                      console.log("成功更新 JS 缓存");
                      location.reload();
                    })
                    .catch((e) => console.log(e));
                }
              }}
            >
              清除 JS/WASM 缓存并刷新
            </button>
          </p>
        </div>
      </div>
    </aside>,
    document.body
  );
}

interface LeanEditorProps {
  file: string;
  initialValue: string;
  onValueChange?: (value: string) => void;
  initialUrl: string;
  onUrlChange?: (value: string) => void;
  clearUrlParam: () => void;
}
interface LeanEditorState {
  cursor?: Position;
  split: "vertical" | "horizontal";
  url: string;
  status: string;
  size: number;
  checked: boolean;
  lastFileName: string;
}
class LeanEditor extends React.Component<LeanEditorProps, LeanEditorState> {
  model: monaco.editor.IModel;
  editor: monaco.editor.IStandaloneCodeEditor;
  constructor(props: LeanEditorProps) {
    super(props);
    this.state = {
      split: "vertical",
      url: this.props.initialUrl,
      status: null,
      size: null,
      checked: true,
      lastFileName: this.props.file,
    };
    this.model = monaco.editor.createModel(this.props.initialValue, "lean", monaco.Uri.file(this.props.file));
    this.model.updateOptions({ tabSize: 2 });
    this.model.onDidChangeContent((e) => {
      checkInputCompletionChange(e, this.editor, this.model);
      const val = this.model.getValue();

      // do not change code URL param unless user has actually typed
      // (this makes the #url=... param a little more "sticky")
      return (!e.isFlush || !val) && this.props.onValueChange && this.props.onValueChange(val);
    });

    this.updateDimensions = this.updateDimensions.bind(this);
    this.dragFinished = this.dragFinished.bind(this);
    this.onSubmit = this.onSubmit.bind(this);
    this.onSave = this.onSave.bind(this);
    this.onLoad = this.onLoad.bind(this);
    this.onChecked = this.onChecked.bind(this);
  }
  componentDidMount() {
    /* TODO: factor this out */
    const ta = document.createElement("div");
    ta.style.fontSize = "1px";
    ta.style.lineHeight = "1";
    ta.innerHTML = "a";
    document.body.appendChild(ta);
    const minimumFontSize = ta.clientHeight;
    ta.remove();
    const node = findDOMNode(this.refs.monaco) as HTMLElement;
    const DEFAULT_FONT_SIZE = 12;
    const options: monaco.editor.IEditorConstructionOptions = {
      selectOnLineNumbers: true,
      roundedSelection: false,
      readOnly: false,
      theme: "vs",
      cursorStyle: "line",
      automaticLayout: true,
      cursorBlinking: "solid",
      model: this.model,
      minimap: { enabled: false },
      wordWrap: "on",
      scrollBeyondLastLine: false,
      fontSize: Math.max(DEFAULT_FONT_SIZE, minimumFontSize),
    };
    this.editor = monaco.editor.create(node, options);

    // context key which keeps track of whether unicode translation is possible
    const canTranslate = this.editor.createContextKey("canTranslate", false);
    this.editor.addCommand(
      monaco.KeyCode.Tab,
      () => {
        tabHandler(this.editor, this.model);
      },
      "canTranslate"
    );
    this.editor.onDidChangeCursorPosition((e) => {
      canTranslate.set(checkInputCompletionPosition(e, this.editor, this.model));
      this.setState({ cursor: { line: e.position.lineNumber, column: e.position.column - 1 } });
    });

    this.determineSplit();
    window.addEventListener("resize", this.updateDimensions);
  }
  componentWillUnmount() {
    this.editor.dispose();
    this.editor = undefined;
    window.removeEventListener("resize", this.updateDimensions);
  }
  componentDidUpdate() {
    // if state url is not null, fetch, then set state url to null again
    if (this.state.url) {
      fetch(this.state.url)
        .then((s) => s.text())
        .then((s) => {
          this.model.setValue(s);
          this.setState({ status: null });
        })
        .catch((e) => this.setState({ status: e.toString() }));
      this.setState({ url: null });
    }
  }

  updateDimensions() {
    this.determineSplit();
  }
  determineSplit() {
    const node = findDOMNode(this.refs.root) as HTMLElement;
    this.setState({ split: node.clientHeight > 0.8 * node.clientWidth ? "horizontal" : "vertical" });
    // can we reset the pane "size" when split changes?
  }
  dragFinished(newSize) {
    this.setState({ size: newSize });
  }

  onSubmit(value) {
    const lastFileName = value.split("#").shift().split("?").shift().split("/").pop();
    this.props.onUrlChange(value);
    this.setState({ url: value, lastFileName });
  }

  onSave() {
    const file = new Blob([this.model.getValue()], { type: "text/plain" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(file);
    a.href = url;
    a.download = this.state.lastFileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 0);
  }
  onLoad(fileStr, lastFileName) {
    this.model.setValue(fileStr);
    this.props.clearUrlParam();
    this.setState({ lastFileName });
  }

  onChecked() {
    this.setState({ checked: !this.state.checked });
  }

  render() {
    const infoStyle = {
      height:
        this.state.size && this.state.split === "horizontal"
          ? `calc(95vh - ${this.state.checked ? 115 : 0}px - ${this.state.size}px)`
          : this.state.split === "horizontal"
          ? // crude hack to set initial height if horizontal
            `calc(35vh - ${this.state.checked ? 45 : 0}px)`
          : "100%",
      width:
        this.state.size && this.state.split === "vertical"
          ? `calc(98vw - ${this.state.size}px)`
          : this.state.split === "vertical"
          ? "38vw"
          : "99%",
    };
    return (
      <div className="leaneditorContainer">
        <div className="headerContainer">
          <PageHeader
            file={this.props.file}
            url={this.props.initialUrl}
            onSubmit={this.onSubmit}
            clearUrlParam={this.props.clearUrlParam}
            status={this.state.status}
            onSave={this.onSave}
            onLoad={this.onLoad}
            onChecked={this.onChecked}
          />
        </div>
        <div className="editorContainer" ref="root">
          <SplitPane
            split={this.state.split}
            defaultSize="60%"
            allowResize={true}
            onDragFinished={this.dragFinished}
          >
            <div ref="monaco" className="monacoContainer" />
            <div className="infoContainer" style={infoStyle}>
              <InfoView file={this.props.file} cursor={this.state.cursor} />
            </div>
          </SplitPane>
        </div>
      </div>
    );
  }
}

const defaultValue = `-- Live ${(self as any).WebAssembly ? "WebAssembly" : "JavaScript"} version of Lean
#eval let v := lean.version in let s := lean.special_version_desc in string.join
["Lean (version ", v.1.repr, ".", v.2.1.repr, ".", v.2.2.repr, ", ",
if s ≠ "" then s ++ ", " else s, "commit ", (lean.githash.to_list.take 12).as_string, ")"]

example (m n : ℕ) : m + n = n + m :=
by simp [nat.add_comm]`;

interface HashParams {
  url: string;
  code: string;
}
function parseHash(hash: string): HashParams {
  hash = hash.slice(1);
  const hashObj = hash
    .split("&")
    .map((s) => s.split("="))
    .reduce((pre, [key, value]) => ({ ...pre, [key]: value }), {}) as any;
  const url = decodeURIComponent(hashObj.url || "");
  const code = decodeURIComponent(hashObj.code || defaultValue);
  return { url, code };
}
function paramsToString(params: HashParams): string {
  let s = "#";
  if (params.url) {
    s = "#url=" + encodeURIComponent(params.url).replace(/\(/g, "%28").replace(/\)/g, "%29");
  }
  // nonempty params.code will wipe out params.url
  if (params.code) {
    params.url = null;
    s = "#code=" + encodeURIComponent(params.code).replace(/\(/g, "%28").replace(/\)/g, "%29");
  }
  return s;
}

function App() {
  const initUrl: URL = new URL(window.location.href);
  const params: HashParams = parseHash(initUrl.hash);

  function changeUrl(newValue, key) {
    params[key] = newValue;
    // if we just loaded a url, wipe out the code param
    if (key === "url" || !newValue) {
      params.code = null;
    }
    history.replaceState(undefined, undefined, paramsToString(params));
  }

  function clearUrlParam() {
    params.url = null;
    history.replaceState(undefined, undefined, paramsToString(params));
  }

  const fn = monaco.Uri.file("test.lean").fsPath;

  if (window.localStorage.getItem("underline") === "true") {
    const style = document.createElement("style");
    style.type = "text/css";
    style.id = "hideUnderline";
    style.appendChild(
      document.createTextNode(`.monaco-editor .greensquiggly,
    .monaco-editor .redsquiggly { background-size:0px; }`)
    );
    document.head.appendChild(style);
  }

  if (window.localStorage.getItem("docs") === "true") {
    const style = document.createElement("style");
    style.type = "text/css";
    style.id = "hideDocs";
    style.appendChild(document.createTextNode(`.toggleDoc, .doc-header { display:none; }`));
    document.head.appendChild(style);
  }

  return (
    <LeanEditor
      file={fn}
      initialValue={params.code}
      onValueChange={(newValue) => changeUrl(newValue, "code")}
      initialUrl={params.url}
      onUrlChange={(newValue) => changeUrl(newValue, "url")}
      clearUrlParam={clearUrlParam}
    />
  );
}

// const hostPrefix = process.env.COMMUNITY ? 'https://cdn.jsdelivr.net/gh/bryangingechen/lean-web-editor-dist/' : './';
// const hostPrefix = process.env.COMMUNITY ? 'https://tqft.net/lean/web-editor/' : './';
const hostPrefix = process.env.COMMUNITY ? "https://bryangingechen.github.io/lean/lean-web-editor/" : "./";

const leanJsOpts: LeanJsOpts = {
  javascript: hostPrefix + "lean_js_js.js",
  libraryZip: hostPrefix + "library.zip",
  libraryMeta: hostPrefix + "library.info.json",
  libraryOleanMap: hostPrefix + "library.olean_map.json",
  libraryKey: "library",
  webassemblyJs: hostPrefix + "lean_js_wasm.js",
  webassemblyWasm: hostPrefix + "lean_js_wasm.wasm",
  dbName: "leanlibrary",
};

let info = null;
const metaPromise = fetch(leanJsOpts.libraryMeta)
  .then((res) => res.json())
  .then((j) => (info = j));

// tslint:disable-next-line:no-var-requires
(window as any).require(["vs/editor/editor.main"], () => {
  registerLeanLanguage(leanJsOpts);
  render(<App />, document.getElementById("root"));
});
