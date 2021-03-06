/// <reference path="../content/base.d.ts" />
/// <reference path="../background/bg.d.ts" />
/// <reference path="../background/bg.exclusions.d.ts" />
type AllowedOptions = SettingsNS.PersistentSettings;
interface Checker<T extends keyof AllowedOptions> {
  init_? (): any;
  check_ (value: AllowedOptions[T]): AllowedOptions[T];
}

declare var browser: unknown;
if (typeof browser !== "undefined" && (browser && (browser as typeof chrome).runtime) != null) {
  window.chrome = browser as typeof chrome;
}
const KeyRe_ = <RegExpG> /<(?!<)(?:a-)?(?:c-)?(?:m-)?(?:[A-Z][\dA-Z]+|[a-z][\da-z]+|\S)>|\S/g,
__extends = function(child: Function, parent: Function): void {
  function __(this: { constructor: Function } ) { this.constructor = child; }
  __.prototype = parent.prototype;
  child.prototype = new (__ as any)();
},
debounce_ = function<T> (this: void, func: (this: T) => void
    , wait: number, bound_context: T, also_immediate: number
    ): (this: void) => void {
  let timeout = 0, timestamp: number;
  const later = function() {
    const last = Date.now() - timestamp;
    if (last < wait && last >= 0) {
      timeout = setTimeout(later, wait - last);
      return;
    }
    timeout = 0;
    if (timestamp !== also_immediate) {
      return func.call(bound_context);
    }
  };
  also_immediate = also_immediate ? 1 : 0;
  return function() {
    timestamp = Date.now();
    if (timeout) { return; }
    timeout = setTimeout(later, wait);
    if (also_immediate) {
      also_immediate = timestamp;
      return func.call(bound_context);
    }
  };
} as <T> (this: void, func: (this: T) => void
          , wait: number, bound_context: T, also_immediate: BOOL
          ) => (this: void) => void;

var $ = function<T extends HTMLElement>(selector: string): T {
  return document.querySelector(selector) as T;
},
BG_ = chrome.extension.getBackgroundPage() as Window as Window & { Settings: SettingsTmpl }, bgSettings_ = BG_.Settings;
const bgOnOther = BG_.OnOther, bgBrowserVer = BG_.ChromeVer;

abstract class Option_<T extends keyof AllowedOptions> {
  readonly element_: HTMLElement;
  readonly field_: T;
  previous_: AllowedOptions[T];
  saved_: boolean;
  locked_?: boolean;
  readonly onUpdated_: (this: void) => void;
  onSave_?(): void;
  checker_?: Checker<T>;

  static all_ = Object.create(null) as {
    [T in keyof AllowedOptions]: Option_<T>;
  } & SafeObject;
  static syncToFrontend_: Array<keyof SettingsNS.FrontendSettings>;

constructor (element: HTMLElement, onUpdated: (this: Option_<T>) => void) {
  this.element_ = element;
  this.field_ = element.id as T;
  this.previous_ = this.onUpdated_ = null as never;
  this.saved_ = true;
  if (this.field_ in bgSettings_.payload) {
    onUpdated = this._onCacheUpdated.bind(this, onUpdated);
  }
  this.fetch_();
  (Option_.all_ as SafeDict<Option_<keyof AllowedOptions>>)[this.field_] = this;
  this.onUpdated_ = debounce_(onUpdated, 330, this, 1);
}

fetch_ (): void {
  this.saved_ = true;
  return this.populateElement_(this.previous_ = bgSettings_.get(this.field_));
}
normalize_ (value: AllowedOptions[T], isJSON: boolean, str?: string): AllowedOptions[T] {
  const checker = this.checker_;
  if (isJSON) {
    str = checker || !str ? JSON.stringify(checker ? checker.check_(value) : value) : str;
    return BG_.JSON.parse(str);
  }
  return checker ? checker.check_(value) : value;
}
allowToSave_ (): boolean { return true; }
save_ (): void {
  let value = this.readValueFromElement_(), isJSON = typeof value === "object"
    , previous = isJSON ? JSON.stringify(this.previous_) : this.previous_
    , pod = isJSON ? JSON.stringify(value) : value;
  if (pod === previous) { return; }
  previous = pod;
  value = this.normalize_(value, isJSON, isJSON ? pod as string : "");
  if (isJSON) {
    pod = JSON.stringify(value);
    if (pod === JSON.stringify(bgSettings_.defaults[this.field_])) {
      value = bgSettings_.defaults[this.field_];
    }
  }
  bgSettings_.set(this.field_, value);
  this.previous_ = value = bgSettings_.get(this.field_);
  this.saved_ = true;
  if (previous !== (isJSON ? JSON.stringify(value) : value)) {
    this.populateElement_(value, true);
  }
  if (this.field_ in bgSettings_.payload) {
    Option_.syncToFrontend_.push(this.field_ as keyof SettingsNS.FrontendSettings);
  }
  this.onSave_ && this.onSave_();
}
abstract readValueFromElement_ (): AllowedOptions[T];
abstract populateElement_ (value: AllowedOptions[T], enableUndo?: boolean): void;
_onCacheUpdated: (this: Option_<T>, onUpdated: (this: Option_<T>) => void) => void;
areEqual_: (this: Option_<T>, a: AllowedOptions[T], b: AllowedOptions[T]) => boolean;
atomicUpdate_: (this: Option_<T> & {element_: TextElement}, value: string, undo: boolean, locked: boolean) => void;

static areJSONEqual_ (this: void, a: object, b: object): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
static saveOptions_: (this: void) => boolean;
static needSaveOptions_: (this: void) => boolean;
showError_: (msg: string, tag?: OptionErrorType | null, errors?: boolean) => void;
}
type OptionErrorType = "has-error" | "highlight";


class ExclusionRulesOption_ extends Option_<"exclusionRules"> {
  template_: HTMLTableRowElement;
  list_: HTMLTableSectionElement;
constructor (element: HTMLElement, onUpdated: (this: ExclusionRulesOption_) => void) {
  super(element, onUpdated);
  bgSettings_.fetchFile("exclusionTemplate", (): void => {
    this.element_.innerHTML = bgSettings_.cache.exclusionTemplate as string;
    this.template_ = $<HTMLTemplateElement>("#exclusionRuleTemplate").content.firstChild as HTMLTableRowElement;
    this.list_ = this.element_.getElementsByTagName('tbody')[0] as HTMLTableSectionElement;
    this.fetch_ = super.fetch_;
    this.fetch_();
    this.list_.addEventListener("input", this.onUpdated_);
    this.list_.addEventListener("click", e => this.onRemoveRow_(e));
    $("#exclusionAddButton").onclick = () => this.addRule_("");
    return this.onInit_();
  });
}
fetch_(): void {}
onRowChange_ (_isInc: number): void {}
addRule_ (pattern: string): HTMLTableRowElement {
  const element = this.appendRule_(this.list_, {
    pattern: pattern,
    passKeys: ""
  });
  ExclusionRulesOption_.getPattern_(element).focus();
  if (pattern) {
    this.onUpdated_();
  }
  this.onRowChange_(1);
  return element;
}
populateElement_ (rules: ExclusionsNS.StoredRule[]): void {
  this.list_.textContent = "";
  if (rules.length <= 0) {}
  else if (rules.length === 1) {
    this.appendRule_(this.list_, rules[0]);
  } else {
    const frag = document.createDocumentFragment();
    rules.forEach(this.appendRule_.bind(this, frag));
    this.list_.appendChild(frag);
  }
  return this.onRowChange_(rules.length);
}
appendRule_ (list: HTMLTableSectionElement | DocumentFragment, rule: ExclusionsNS.StoredRule): HTMLTableRowElement {
  const row = document.importNode(this.template_, true);
  let el = row.querySelector('.pattern') as HTMLInputElement, value: string;
  el.value = value = rule.pattern;
  if (value) {
    el.placeholder = "";
  }
  el = row.querySelector('.passKeys') as HTMLInputElement;
  el.value = value = rule.passKeys.trimRight();
  if (value) {
    el.placeholder = "";
  } else {
    el.addEventListener("input", ExclusionRulesOption_.OnNewPassKeyInput_);
  }
  list.appendChild(row);
  return row;
}
static OnNewPassKeyInput_ (this: HTMLInputElement): void {
  this.removeEventListener("input", ExclusionRulesOption_.OnNewPassKeyInput_);
  this.title = "Example: " + this.placeholder;
  this.placeholder = "";
}
onRemoveRow_ (event: Event): void {
  let element = event.target as HTMLElement;
  for (let i = 0; i < 2; i++) {
    if (element.classList.contains("exclusionRemoveButton")) { break; }
    element = element.parentElement as HTMLElement;
  }
  element = (element.parentNode as Node).parentNode as HTMLElement;
  if (element.classList.contains("exclusionRuleInstance")) {
    element.remove();
    this.onUpdated_();
    return this.onRowChange_(0);
  }
}

_reChar: RegExpOne;
_escapeRe: RegExpG;
readValueFromElement_ (part?: boolean): AllowedOptions["exclusionRules"] {
  const rules: ExclusionsNS.StoredRule[] = [],
  _ref = this.element_.getElementsByClassName<HTMLTableRowElement>("exclusionRuleInstance");
  part = (part === true);
  for (let _i = 0, _len = _ref.length; _i < _len; _i++) {
    const element = _ref[_i];
    if (part && element.style.display === "none") {
      continue;
    }
    let pattern = ExclusionRulesOption_.getPattern_(element).value.trim();
    if (!pattern) {
      continue;
    }
    let fixTail = false;
    if (pattern[0] === ":" || element.style.display === "none") {}
    else if (!this._reChar.test(pattern)) {
      fixTail = pattern.indexOf('/', pattern.indexOf("://") + 3) < 0;
      pattern = pattern.replace(this._escapeRe, "$1");
      pattern = (pattern.indexOf("://") === -1 ? ":http://" : ":") + pattern;
    } else if (pattern[0] !== "^") {
      fixTail = pattern.indexOf('/', pattern.indexOf("://") + 3) < 0;
      pattern = (pattern.indexOf("://") === -1 ? "^https?://" : "^") +
          (pattern[0] !== "*" || pattern[1] === "."
            ? ((pattern = pattern.replace(<RegExpG>/\./g, "\\.")),
              pattern[0] !== "*" ? pattern.replace("://*\\.", "://(?:[^./]+\\.)*?")
                : pattern.replace("*\\.", "(?:[^./]+\\.)*?"))
            : "[^/]" + pattern);
    }
    if (fixTail) {
      pattern += "/";
    }
    let passKeys = ExclusionRulesOption_.getPassKeys_(element).value;
    if (passKeys) {
      const passArr = passKeys.match(KeyRe_);
      passKeys = passArr ? (passArr.sort().join(" ") + " ") : "";
    }
    rules.push({
      pattern: pattern,
      passKeys: passKeys
    });
  }
  return rules;
}

readonly areEqual_ = Option_.areJSONEqual_;
static getPattern_ (element: HTMLTableRowElement): HTMLInputElement {
  return element.getElementsByClassName<HTMLInputElement>("pattern")[0];
}
static getPassKeys_ (element: HTMLTableRowElement): HTMLInputElement {
  return element.getElementsByClassName<HTMLInputElement>("passKeys")[0];
}
onInit_ (): void {}
sortRules_: (el?: HTMLElement) => void;
timer_?: number;
}
ExclusionRulesOption_.prototype._reChar = <RegExpOne> /^[\^*]|[^\\][$()*+?\[\]{|}]/;
ExclusionRulesOption_.prototype._escapeRe = <RegExpG> /\\(.)/g;

if (bgBrowserVer >= BrowserVer.MinSmartSpellCheck) {
  (document.documentElement as HTMLElement).removeAttribute("spellcheck");
}

if (bgBrowserVer < BrowserVer.MinEnsuredBorderWidthWithoutDeviceInfo
  || window.devicePixelRatio < 2 && bgBrowserVer >= BrowserVer.MinRoundedBorderWidthIsNotEnsured
) (function(): void {
  const css = document.createElement("style"), ratio = window.devicePixelRatio, version = bgBrowserVer;
  const onlyInputs = version >= BrowserVer.MinRoundedBorderWidthIsNotEnsured && ratio >= 1;
  let scale: string | number = onlyInputs || version >= BrowserVer.MinEnsuredBorderWidthWithoutDeviceInfo ? 1.12 / ratio : 1;
  scale = ("" + scale).substring(0, 7);
  css.textContent = onlyInputs ? `input, textarea { border-width: ${scale}px; }`
    : `* { border-width: ${scale}px !important; }`;
  (document.head as HTMLHeadElement).appendChild(css);
})();

$<HTMLElement>(".version").textContent = bgSettings_.CONST.VerName;

location.pathname.indexOf("/popup.html") !== -1 && BG_.Utils.require("Exclusions").then((function(callback) {
  return function() {
    chrome.tabs.query({currentWindow: true as true, active: true as true}, callback);
  };
})(function(tabs: [chrome.tabs.Tab] | never[]): void {
interface PopExclusionRulesOption extends ExclusionRulesOption_ {
  inited_: 0 | 1 /* no initial matches */ | 2 /* some matched */ | 3 /* is saving (temp status) */;
  init_(this: PopExclusionRulesOption, element: HTMLElement
    , onUpdated: (this: PopExclusionRulesOption) => void, onInit: (this: PopExclusionRulesOption) => void
    ): void;
  rebuildTesters_ (this: PopExclusionRulesOption): void;
  addRule_ (): HTMLTableRowElement;
  populateElement_ (rules: ExclusionsNS.StoredRule[]): void;
  OnInput_ (this: void, event: Event): void;
  generateDefaultPattern_ (this: PopExclusionRulesOption): string;
}
  let ref = BG_.Backend.indexPorts(tabs[0].id), blockedMsg = $("#blocked-msg");
  const notRunnable = !ref && !(tabs[0] && tabs[0].url && tabs[0].status === "loading"
    && (tabs[0].url.lastIndexOf("http", 0) === 0 || tabs[0].url.lastIndexOf("ftp", 0) === 0));
  if (notRunnable) {
    const body = document.body as HTMLBodyElement;
    body.textContent = "";
    blockedMsg.style.display = "";
    (blockedMsg.querySelector(".version") as HTMLElement).textContent = bgSettings_.CONST.VerName;
    const refreshTip = blockedMsg.querySelector("#refresh-after-install") as HTMLElement;
    if (!tabs[0] || !tabs[0].url || !(tabs[0].url.lastIndexOf("http", 0) === 0 || tabs[0].url.lastIndexOf("ftp", 0) === 0)) {
      refreshTip.remove();
    } else if (bgOnOther === BrowserType.Edge) {
      (refreshTip.querySelector(".action") as HTMLElement).textContent = "open a new web page";
    }
    body.style.width = "auto";
    body.appendChild(blockedMsg);
    (document.documentElement as HTMLHtmlElement).style.height = "";
  } else {
    blockedMsg.remove();
    blockedMsg = null as never;
  }
  const element = $<HTMLAnchorElement>(".options-link"), optionsUrl = bgSettings_.CONST.OptionsPage;
  element.href !== optionsUrl && (element.href = optionsUrl);
  element.onclick = function(this: HTMLAnchorElement, event: Event): void {
    event.preventDefault();
    const a: MarksNS.FocusOrLaunch = BG_.Object.create(null);
    a.url = bgSettings_.CONST.OptionsPage;
    BG_.Backend.focus(a);
    window.close();
  };
  if (notRunnable) {
    return;
  }

const bgExclusions: ExclusionsNS.ExclusionsCls = BG_.Exclusions,
tabId = ref ? ref[0].s.t : tabs[0].id,
stateLine = $("#state"), saveBtn = $<HTMLButtonElement>("#saveOptions"),
url = ref ? ref[0].s.u : tabs[0].url,
exclusions: PopExclusionRulesOption = Object.setPrototypeOf(<PopExclusionRulesOption>{
  inited_: 0,
  init_ (this: PopExclusionRulesOption, element: HTMLElement
      , onUpdated: (this: ExclusionRulesOption_) => void, onInit: (this: ExclusionRulesOption_) => void
      ): void {
    this.rebuildTesters_();
    this.onInit_ = onInit;
    (ExclusionRulesOption_ as any).call(this, element, onUpdated);
    this.element_.addEventListener("input", this.OnInput_);
    this.init_ = null as never;
  },
  rebuildTesters_ (this: PopExclusionRulesOption): void {
    const rules = bgSettings_.get("exclusionRules")
      , ref1 = bgExclusions.testers = BG_.Object.create(null)
      , ref2 = bgExclusions.rules;
    for (let _i = 0, _len = rules.length; _i < _len; _i++) {
      ref1[rules[_i].pattern] = ref2[_i * 2];
    }
    this.rebuildTesters_ = null as never;
  },
  addRule_ (this: PopExclusionRulesOption): HTMLTableRowElement {
    return ExclusionRulesOption_.prototype.addRule_.call(this, this.generateDefaultPattern_());
  },
  populateElement_ (this: PopExclusionRulesOption, rules: ExclusionsNS.StoredRule[]): void {
    ExclusionRulesOption_.prototype.populateElement_.call(this, rules);
    const elements = this.element_.getElementsByClassName<HTMLTableRowElement>("exclusionRuleInstance");
    let haveMatch = -1;
    for (let _i = 0, _len = elements.length; _i < _len; _i++) {
      const element = elements[_i];
      const pattern = ExclusionRulesOption_.getPattern_(element).value.trim();
      const rule = (bgExclusions.testers as EnsuredSafeDict<ExclusionsNS.Tester>)[pattern];
      if (typeof rule === "string" ? !url.lastIndexOf(rule, 0) : rule.test(url)) {
        haveMatch = _i;
      } else {
        element.style.display = "none";
      }
    }
    if (this.inited_ === 0) {
      if (haveMatch >= 0) {
        ExclusionRulesOption_.getPassKeys_(elements[haveMatch]).focus();
      } else {
        this.addRule_();
      }
      this.inited_ = haveMatch >= 0 ? 2 : 1;
    }
    this.populateElement_ = null as never;
  },
  OnInput_ (this: void, event: Event): void {
    const patternElement = event.target as HTMLInputElement;
    if (!patternElement.classList.contains("pattern")) {
      return;
    }
    const rule = bgExclusions.getRe(patternElement.value);
    if (typeof rule === "string" ? !url.lastIndexOf(rule, 0) : rule.test(url)) {
      patternElement.title = patternElement.style.color = "";
    } else {
      patternElement.style.color = "red";
      patternElement.title = "Red text means that the pattern does not\nmatch the current URL.";
    }
  },
  generateDefaultPattern_ (this: PopExclusionRulesOption): string {
    const url2 = url.lastIndexOf("https:", 0) === 0
      ? "^https?://" + url.split("/", 3)[2].replace(<RegExpG>/[.[\]]/g, "\\$&") + "/"
      : (<RegExpOne>/^[^:]+:\/\/./).test(url) && url.lastIndexOf("file:", 0) < 0
      ? ":" + (url.split("/", 3).join("/") + "/")
      : ":" + url;
    this.generateDefaultPattern_ = () => url2;
    return url2;
  }
}, ExclusionRulesOption_.prototype);

  let saved = true, oldPass: string | null = null, curLockedStatus = Frames.Status.__fake;
  function collectPass(pass: string): string {
    pass = pass.trim();
    const dict = Object.create<1>(null);
    for (let i of pass.split(" ")) {
      const n = i.charCodeAt(0);
      i = n === KnownKey.lt ? "&lt;" : n === KnownKey.gt ? "&gt;" : n === KnownKey.and ? "&amp;" : i;
      dict[i] = 1;
    }
    return Object.keys(dict).join(" ");
  }
  function updateState(initing: boolean): void {
    let pass = bgExclusions.getTemp(url, exclusions.readValueFromElement_(true));
    pass && (pass = collectPass(pass));
    if (initing) {
      oldPass = exclusions.inited_ >= 2 ? pass : null;
    }
    const isSaving = exclusions.inited_ === 3;
    exclusions.inited_ = 2;
    const same = pass === oldPass;
    let html = '<span class="Vim">Vim</span>ium <span class="C">C</span> '
      + (isSaving ? pass ? "becomes to exclude" : "becomes"
        : (same ? "keeps to " : "will ") + (pass ? "exclude" : "be"))
      + (pass
      ? `: <span class="state-value code">${pass}</span>`
      : `:<span class="state-value fixed-width">${pass !== null ? 'disabled' : ' enabled'}</span>`);
    if (curLockedStatus !== Frames.Status.__fake && !isSaving && same) {
      html += ` (on this tab, ${curLockedStatus === Frames.Status.enabled ? "enabled" : "disabled"} for once)`;
    }
    stateLine.innerHTML = html;
    saveBtn.disabled = same;
    (saveBtn.firstChild as Text).data = same ? "No Changes" : "Save Changes";
  }
  function onUpdated(this: void): void {
    if (saved) {
      saved = false;
      let el = $("#helpSpan");
      if (el) {
        (el.nextElementSibling as HTMLElement).style.display = "";
        el.remove();
      }
      saveBtn.removeAttribute("disabled");
      (saveBtn.firstChild as Text).data = "Save Changes";
    }
    if (!exclusions.init_) {
      updateState(false);
    }
  }
  function saveOptions(this: void): void {
    if (saveBtn.disabled) {
      return;
    }
    const testers = bgExclusions.testers;
    BG_.Backend.forceStatus("reset", tabId);
    exclusions.save_();
    setTimeout(function() {
      bgExclusions.testers = testers;
    }, 50);
    exclusions.inited_ = 3;
    updateState(true);
    (saveBtn.firstChild as Text).data = "Saved";
    if (bgOnOther === BrowserType.Firefox) { saveBtn.blur(); }
    saveBtn.disabled = true;
    saved = true;
  }
  saveBtn.onclick = saveOptions;
  document.addEventListener("keyup", function(event): void {
    if (event.keyCode === VKeyCodes.enter && (event.ctrlKey || event.metaKey)) {
      setTimeout(window.close, 300);
      if (!saved) { return saveOptions(); }
    }
  });
  exclusions.init_($("#exclusionRules"), onUpdated, function (): void {
    let sender = ref ? ref[0].s : <Readonly<Frames.Sender>>{ s: Frames.Status.enabled, f: Frames.Flags.Default }, el: HTMLElement
      , newStat = sender.s !== Frames.Status.disabled ? "Disable" as "Disable" : "Enable" as "Enable";
    curLockedStatus = sender.f & Frames.Flags.locked ? sender.s : Frames.Status.__fake;
    ref = null;
    el = $<HTMLElement>("#toggleOnce");
    el.textContent = newStat + " for once";
    el.onclick = forceState.bind(null, newStat);
    if (sender.f & Frames.Flags.locked) {
      el = el.nextElementSibling as HTMLElement;
      el.classList.remove("hidden");
      el = el.firstElementChild as HTMLElement;
      el.onclick = forceState.bind(null, "Reset");
    }
    setTimeout(function(): void {
      (document.documentElement as HTMLHtmlElement).style.height = "";
    }, 17);
    this.onInit_ = null as never;
    return updateState(true);
  });
  interface WindowEx extends Window { exclusions?: PopExclusionRulesOption; }
  (window as WindowEx).exclusions = exclusions;
  window.onunload = function(): void {
    bgExclusions.testers = null;
    BG_.Utils.GC();
  };

  function forceState(act: "Reset" | "Enable" | "Disable", event?: Event): void {
    event && event.preventDefault();
    BG_.Backend.forceStatus(act.toLowerCase() as "reset" | "enable" | "disable", tabId);
    window.close();
  }
}));
