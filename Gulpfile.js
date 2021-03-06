"use strict";
var fs = require("fs");
var gulp = require("gulp");
var logger = require("fancy-log");
var changed = require('gulp-changed');
var ts = require("gulp-typescript");
var newer = require('gulp-newer');
var gulpPrint = require('gulp-print');
var gulpSome = require('gulp-some');
var osPath = require('path');

var LIB_UGLIFY_JS = 'terser';
var DEST, enableSourceMap, willListFiles, willListEmittedFiles, removeComments, JSDEST;
var locally = false;
var debugging = process.env.DEBUG === "1";
var compileInBatch = true;
var typescript = null, tsOptionsLogged = false;
var envLegacy = process.env.SUPPORT_LEGACY === "1";
var envSourceMap = process.env.ENABLE_SOURCE_MAP === "1";
var disableErrors = process.env.SHOW_ERRORS !== "1" && (process.env.SHOW_ERRORS === "0" || !compileInBatch);
var forcedESTarget = (process.env.TARGET || "").toLowerCase();
var ignoreHeaderChanges = process.env.IGNORE_HEADER_CHANGES !== "0";
var manifest = readJSON("manifest.json", true);
var compilerOptions = loadValidCompilerOptions("scripts/gulp.tsconfig.json", false);
var has_dialog_ui = manifest.options_ui != null && manifest.options_ui.open_in_tab !== true;
gulpPrint = gulpPrint.default || gulpPrint;

var CompileTasks = {
  background: ["background/*.ts", "background/*.d.ts"],
  content: [["content/*.ts", "lib/*.ts", "!lib/polyfill.ts"], "content/*.d.ts"],
  lib: ["lib/*.ts"],
  front: [["front/*.ts", "lib/polyfill.ts", "pages/*.ts", "!pages/options*.ts", "!pages/show.ts"]
          , ["background/bg.d.ts", "content/*.d.ts"]],
  vomnibar: ["front/*.ts", ["background/bg.d.ts", "content/*.d.ts"]],
  polyfill: ["lib/polyfill.ts"],
  main_pages: [["pages/options*.ts", "pages/show.ts"], ["background/*.d.ts", "content/*.d.ts"]],
  show: ["pages/show.ts", ["background/bg.d.ts", "content/*.d.ts"]],
  options: ["pages/options*.ts", ["background/*.d.ts", "content/*.d.ts"]],
  others: [["pages/*.ts", "!pages/options*.ts", "!pages/show.ts"], "background/bg.d.ts"],
}

var Tasks = {
  "build/pages": ["build/main_pages", "build/others"],
  "static/special": function() {
    return copyByPath(["pages/newtab.js", "lib/math_parser*", "lib/*.min.js"]);
  },
  "static/uglify": function() {
    return uglifyJSFiles("lib/math_parser*.js", ".", "", { base: "." });
  },
  static: ["static/special", "static/uglify", function() {
    var arr = ["front/*", "pages/*", "icons/*", "lib/*.css"
      , "settings_template.json", "*.txt", "*.md"
      , "!**/manifest.json"
      , '!**/*.ts', "!**/*.js", "!**/tsconfig*.json"
      , "!front/vimium.css", "!test*", "!todo*"
    ];
    if (!has_dialog_ui) {
      arr.push("!*/dialog_ui.*");
    }
    return copyByPath(arr);
  }],

  "build/scripts": ["build/background", "build/content", "build/front"],
  "build/ts": ["build/scripts", "build/main_pages"],

  "min/bg": function(cb) {
    var exArgs = { nameCache: { vars: {}, props: {} }, passAll: true };
    var config = loadUglifyConfig(!!exArgs.nameCache);
    config.nameCache = exArgs.nameCache;
    require(LIB_UGLIFY_JS).minify("var CommandsData_, Completion_, ContentSettings_, FindModeHistory_, Marks_, TabRecency_, VClipboard_;", config);

    var sources = manifest.background.scripts;
    sources = ("\n" + sources.join("\n")).replace(/\n\//g, "\n").trim().split("\n");
    var ori_sources = sources.slice(0);
    var body = sources.splice(0, sources.indexOf("background/main.js") + 1, "background/main.js");
    var index = sources.indexOf("background/tools.js");
    var tail = sources.splice(index, sources.length - index, "background/tail.js");
    var rest = ["background/*.js"];
    for (var arr = ori_sources, i = 0, len = arr.length; i < len; i++) { rest.push("!" + arr[i]); }
    var maps = [
      [body, sources[0], null],
      [sources.slice(1, index), ".", ""],
      [tail, sources[index], null],
      [rest, ".", ""]
    ];
    manifest.background.scripts = sources;
    checkJSAndUglifyAll(maps, "min/bg", exArgs, cb);
  },
  "min/content": function(cb) {
    var cs = manifest.content_scripts[0], sources = cs.js;
    if (sources.length <= 1) {
      return cb();
    }
    cs.js = ["content/vimium-c.js"];
    var exArgs = { nameCache: { vars: {}, props: {} }, passAll: true };
    var rest = ["content/*.js"];
    for (var arr = sources, i = 0, len = arr.length; i < len; i++) { rest.push("!" + arr[i]); }
    var maps = [
      [sources.slice(0), cs.js[0], null], [rest, ".", ""]
    ];
    checkJSAndUglifyAll(maps, "min/content", exArgs, cb);
  },
  "min/others": function(cb) {
    gulp.task("min/others/_1", function() {
      return uglifyJSFiles(["front/*.js"], ".", "");
    });
    gulp.task("min/others/_2", function() {
      var exArgs = { nameCache: { vars: {}, props: {} } };
      return uglifyJSFiles(["pages/options_base.js", "pages/options.js", "pages/options_*.js"], ".", "", exArgs);
    });
    gulp.task("min/others/_3", function() {
      var oriManifest = readJSON("manifest.json", true);
      var res = ["**/*.js", "!background/*.js", "!content/*.js", "!front/*", "!pages/options*"];
      if (!has_dialog_ui) {
        res.push("!*/dialog_ui.*");
      }
      for (var arr = oriManifest.content_scripts[0].js, i = 0, len = arr.length; i < len; i++) {
        if (arr[i].lastIndexOf("lib/", 0) === 0) {
          res.push("!" + arr[i]);
        }
      }
      return uglifyJSFiles(res, ".", "");
    });
    gulp.parallel("min/others/_1", "min/others/_2", "min/others/_3")(cb);
  },
  "min/js": ["min/bg", "min/content", "min/others"],
  manifest: [["min/bg", "min/content"], function(cb) {
    var file = osPath.join(DEST, "manifest.json")
      , data = JSON.stringify(manifest, null, "  ");
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      var oldData = readFile(file);
      if (data === oldData) {
        if (willListEmittedFiles) {
          print('skip', file);
        }
        return cb();
      }
    }
    fs.writeFile(file, data, cb);
  }],
  dist: [["static", "build/ts"], ["manifest", "min/others"]],
  "dist/": ["dist"],

  build: ["dist"],
  rebuild: [["clean"], "dist"],
  all: ["build"],
  "clean/temp": function() {
    return cleanByPath([JSDEST + "**/*.js"
      , JSDEST + "**/*.js.map"
      , "!" + JSDEST + "/pages/newtab.js"]);
  },
  clean: ["clean/temp", function() {
    return cleanByPath(DEST + "/*");
  }],

  scripts: ["background", "content", "front"],
  pages: ["main_pages", "others"],
  "pages/": ["pages"],
  b: ["background"],
  ba: ["background"],
  bg: ["background"],
  c: ["content"],
  f: ["front"],
  l: ["lib"],
  p: ["pages"],
  pa: ["pages"],
  pg: ["pages"],
  local: ["scripts", "main_pages"],
  tsc: ["local"],
  "default": ["tsc"],
  watch: ["locally", function(done) {
    ignoreHeaderChanges = willListFiles = true;
    willListEmittedFiles = false;
    ["background", "content", "front", "options", "show"].forEach(makeWatchTask);
    done();
  }],
  debug: ["locally", function(done) {
    ignoreHeaderChanges = disableErrors = willListFiles = false;
    willListEmittedFiles = debugging = true;
    ["background", "content", "vomnibar", "polyfill", "options", "show", "others"].forEach(makeWatchTask);
    done();
  }],
  test: ["local"]
};


typescript = compilerOptions.typescript = loadTypeScriptCompiler();
removeUnknownOptions();
if (!has_dialog_ui) {
  CompileTasks.front[0].push("!*/dialog_ui.*");
  CompileTasks.others[0].push("!*/dialog_ui.*");
}
gulp.task("locally", function(done) {
  if (locally) { return done(); }
  locally = true;
  compilerOptions = loadValidCompilerOptions("tsconfig.json", true);
  removeUnknownOptions();
  JSDEST = compilerOptions.outDir = ".";
  enableSourceMap = false;
  willListEmittedFiles = true;
  done();
});
makeCompileTasks();
makeTasks();

function makeCompileTask(src, header_files) {
  header_files = typeof header_files === "string" ? [header_files] : header_files || [];
  return function() {
    return compile(src, header_files);
  };
}

function makeCompileTasks() {
  var hasOwn = Object.prototype.hasOwnProperty;
  for (var key in CompileTasks) {
    if (!hasOwn.call(CompileTasks, key)) { continue; }
    var config = CompileTasks[key], task = makeCompileTask(config[0], config[1]);
    gulp.task(key, gulp.series("locally", task));
    gulp.task("build/" + key, task);
    if (fs.existsSync(key) && fs.statSync(key).isDirectory()) {
      gulp.task(key + "/", gulp.series(key));
    }
  }
}

var _notifiedTasks = [], _notifiedTaskTimer = 0;
function makeWatchTask(taskName) {
  var glob = CompileTasks[taskName][0];
  typeof glob === "string" && (glob = [glob]);
  if (!debugging) {
    glob.push("!background/*.d.ts", "!content/*.d.ts", "!pages/*.d.ts", "!types/*.d.ts");
  }
  gulp.watch(glob, function() {
    if (_notifiedTasks.indexOf(taskName) < 0) { _notifiedTasks.push(taskName); }
    if (_notifiedTaskTimer > 0) { clearTimeout(_notifiedTaskTimer); }
    _notifiedTaskTimer = setTimeout(function() {
      _notifiedTaskTimer = 0;
      gulp.parallel(..._notifiedTasks.slice(0))();
      _notifiedTasks.length = 0;
    }, 100);
  });
}

function makeTasks() {
  var hasOwn = Object.prototype.hasOwnProperty;
  var left = [];
  for (let key in Tasks) {
    if (!hasOwn.call(Tasks, key)) { continue; }
    left.push([key, Tasks[key]]);
  }
  while (left.length > 0) {
    let [ key, task ] = left.shift();
    if (typeof task === "function") {
      gulp.task(key, task);
      continue;
    }
    const knownTasks = gulp.tree().nodes, toTest = task[0] instanceof Array ? task[0] : task;
    let notFound = false;
    for (const i of toTest) {
      if (typeof i === "string" && knownTasks.indexOf(i) < 0) {
        notFound = true;
        break;
      }
    }
    if (notFound) {
      left.push([key, task]);
      continue;
    }
    if (typeof task[1] === "function" || task[0] instanceof Array) {
      gulp.task(key, Tasks[key] = gulp.series(task[0] instanceof Array ? gulp.parallel(...task[0]) : task[0], task[1]));
    } else {
      gulp.task(key, task.length === 1 && typeof Tasks[task[0]] === "function" ? Tasks[task[0]] : gulp.parallel(...task));
    }
  }
}

function tsProject() {
  return disableErrors ? ts(compilerOptions, ts.reporter.nullReporter()) : ts(compilerOptions);
}

function compile(pathOrStream, header_files, skipOutput) {
  if (typeof pathOrStream === "string") {
    pathOrStream = [pathOrStream];
  }
  if (pathOrStream instanceof Array) {
    pathOrStream.push("!node_modules/**/*.ts");
    pathOrStream.push("!types/**/*.ts");
    pathOrStream.push("!types/*.ts");
  }
  var stream = pathOrStream instanceof Array ? gulp.src(pathOrStream, { base: "." }) : pathOrStream;
  var extra = ignoreHeaderChanges || header_files === false ? undefined
    : ["types/**/*.d.ts", "types/*.d.ts"].concat(header_files);
  var allIfNotEmpty = gulpAllIfNotEmpty();
  stream = stream.pipe(allIfNotEmpty.prepare);
  if (!debugging) {
    stream = stream.pipe(newer({ dest: JSDEST, ext: '.js', extra: extra }));
  }
  stream = stream.pipe(gulpSome(function(file) {
    var t = file.relative, s = ".d.ts", i = t.length - s.length;
    return i < 0 || t.indexOf(s, i) !== i;
  }));
  if (compileInBatch) {
    stream = stream.pipe(allIfNotEmpty.cond);
  }
  if (willListFiles) {
    stream = stream.pipe(gulpPrint());
  }
  if (enableSourceMap) {
    stream = stream.pipe(require('gulp-sourcemaps').init());
  }
  var project = tsProject();
  var tsResult = stream.pipe(project);
  if (skipOutput) {
    return tsResult;
  }
  return outputJSResult(tsResult.js);
}

function outputJSResult(stream) {
  if (locally) {
    stream = stream.pipe(gulpMap(function(file) {
      if (file.history.join("|").indexOf("extend_click") >= 0) {
        file.contents = new Buffer(patchExtendClick(String(file.contents)));
      }
    }));
  }
  stream = stream.pipe(changed(JSDEST, {
    hasChanged: compareContentAndTouch
  }));
  if (willListEmittedFiles) {
    stream = stream.pipe(gulpPrint());
  }
  if (enableSourceMap) {
    stream = stream.pipe(require('gulp-sourcemaps').write(".", {
      sourceRoot: ""
    }));
  }
  return stream.pipe(gulp.dest(JSDEST));
}

function checkJSAndUglifyAll(maps, key, exArgs, cb) {
  Promise.all(maps.map(function(i) {
    var is_file = i[1] && i[1] !== ".";
    return checkAnyNewer(i[0], JSDEST, is_file ? osPath.join(DEST, i[1]) : DEST, is_file ? "" : ".js");
  })).then(function(all) {
    var isNewer = false;
    for (var i = 0; i < all.length; i++) {
      if (all[i]) {
        isNewer = true; break;
      }
    }
    if (!isNewer) { return cb(); }
    var tasks = [];
    for (var i = 0; i < maps.length; i++) {
      var name = key + "/_" + (i + 1);
      tasks.push(name);
      gulp.task(name, (function(map) {
        return function() {
          return uglifyJSFiles(map[0], map[1], map[2], exArgs);
        }
      })(maps[i]));
    }
    gulp.series(...tasks)(cb);
  });
}

function uglifyJSFiles(path, output, new_suffix, exArgs) {
  const base = exArgs && exArgs.base || JSDEST;
  path = formatPath(path, base);
  path.push("!**/*.min.js");
  output = output || ".";
  new_suffix = new_suffix !== "" ? (new_suffix || ".min") : "";
  exArgs || (exArgs = {});

  var stream = gulp.src(path, { base: base });
  var is_file = output.indexOf(".js", Math.max(0, output.length - 3)) > 0;
  if (!exArgs.passAll) {
    stream = stream.pipe(newer(is_file ? {
      dest: osPath.join(DEST, output)
    } : exArgs.nameCache ? {
      dest: DEST,
      ext: new_suffix + ".js",
      extra: path
    } : {
      dest: DEST,
      ext: new_suffix + ".js"
    }));
  }
  let mayPatch = false;
  if (enableSourceMap) {
    stream = stream.pipe(require('gulp-sourcemaps').init({ loadMaps: true }));
  } else {
    stream = stream.pipe(gulpMap(function(file) {
      if (file.history.join("|").indexOf("extend_click") >= 0) {
        mayPatch = true;
      }
    }));
  }
  if (is_file) {
    if (willListEmittedFiles) {
      stream = stream.pipe(gulpPrint());
    }
    stream = stream.pipe(require('gulp-concat')(output));
  }
  var config = loadUglifyConfig(!!exArgs.nameCache);
  if (exArgs.nameCache) {
    config.nameCache = exArgs.nameCache;
    patchGulpUglify();
  }
  var compose = require('gulp-uglify/composer');
  var logger = require('gulp-uglify/lib/log');
  var uglify = require(LIB_UGLIFY_JS);
  stream = stream.pipe(compose(
    uglify,
    logger
  )(config));
  if (!is_file && new_suffix !== "") {
     stream = stream.pipe(require('gulp-rename')({ suffix: new_suffix }));
  }
  stream = stream.pipe(gulpMap(function(file) {
    if (!mayPatch) { return; }
    if (is_file || file.history.join("|").indexOf("extend_click") >= 0) {
      file.contents = new Buffer(patchExtendClick(String(file.contents)));
    }
  }));
  if (willListEmittedFiles && !is_file) {
    stream = stream.pipe(gulpPrint());
  }
  if (enableSourceMap) {
    stream = stream.pipe(require('gulp-sourcemaps').write(".", {
      sourceRoot: "/"
    }));
  }
  return stream.pipe(gulp.dest(DEST));
}

function copyByPath(path) {
  var stream = gulp.src(path, { base: "." })
    .pipe(newer(DEST))
    .pipe(changed(DEST, {
      hasChanged: compareContentAndTouch
    }));
  if (willListEmittedFiles) {
    stream = stream.pipe(gulpPrint());
  }
  return stream.pipe(gulp.dest(DEST));
}

function cleanByPath(path) {
  return gulp.src(path, {read: false}).pipe(require('gulp-clean')());
}

function formatPath(path, base) {
  if (typeof path === "string") {
    path = [path];
  } else {
    path = path.slice(0);
  }
  if (base && base !== ".") {
    for (var i = 0; i < path.length; i++) {
      var p = path[i];
      path[i] = p[0] !== "!" ? osPath.join(base, p) : "!" + osPath.join(base, p.substring(1));
    }
  }
  return path;
}

function convertToStream(pathOrStream) {
  return typeof pathOrStream === "string" || pathOrStream instanceof Array
    ? gulp.src(pathOrStream, { base: "." }) : pathOrStream;
}

function compareContentAndTouch(stream, sourceFile, targetPath) {
  if (sourceFile.isNull()) {
    return changed.compareContents.apply(this, arguments);
  }
  var isSame = false, equals = sourceFile.contents.equals,
  newEquals = sourceFile.contents.equals = function(targetData) {
    var curIsSame = equals.apply(this, arguments);
    isSame || (isSame = curIsSame);
    return curIsSame;
  };
  return changed.compareContents.apply(this, arguments
  ).then(function() {
    sourceFile.contents.equals === newEquals && (sourceFile.contents.equals = equals);
    if (!isSame) { return; }
    var fd = fs.openSync(targetPath, "a"), len1 = targetPath.length, fd2 = null;
    try {
      var s = s = fs.fstatSync(fd);
      if (s.mtime != null && len1 > 3 && targetPath.indexOf(".js", len1 - 3) > 0) {
        var src = (sourceFile.history && sourceFile.history[0] || targetPath).substring(0, len1 - 3) + ".ts";
        if (fs.existsSync(src)) {
          var mtime = fs.fstatSync(fd2 = fs.openSync(src, "r")).mtime;
          if (mtime != null && mtime < s.mtime) {
            return;
          }
        }
      }
      fs.futimesSync(fd, parseInt(s.atime.getTime() / 1000, 10), parseInt(Date.now() / 1000, 10));
      print("Touch an unchanged file:", sourceFile.relative);
    } finally {
      fs.closeSync(fd);
      if (fd2 != null) {
        fs.closeSync(fd2);
      }
    }
  }).catch(function(e) {
    sourceFile.contents.equals === newEquals && (sourceFile.contents.equals = equals);
    throw e;
  });
}

function readFile(fileName, info) {
  info == null && (info = {});
  var buffer = fs.readFileSync(fileName);
  var len = buffer.length;
  if (len >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
      // Big endian UTF-16 byte order mark detected. Since big endian is not supported by node.js,
      // flip all byte pairs and treat as little endian.
      len &= ~1;
      for (var i = 0; i < len; i += 2) {
          const temp = buffer[i];
          buffer[i] = buffer[i + 1];
          buffer[i + 1] = temp;
      }
      info.bom = "\uFFFE";
      return buffer.toString("utf16le", 2);
  }
  if (len >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
      // Little endian UTF-16 byte order mark detected
      info.bom = "\uFEFF";
      return buffer.toString("utf16le", 2);
  }
  if (len >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      // UTF-8 byte order mark detected
      info.bom = "\uFEFF";
      return buffer.toString("utf8", 3);
  }
  info.bom = "";
  // Default is UTF-8 with no byte order mark
  return buffer.toString("utf8");
}

function _makeJSONReader() {
  var stringOrComment = /"(?:\\[\\\"]|[^"])*"|'(?:\\[\\\']|[^'])*'|\/\/[^\r\n]*|\/\*.*?\*\//g
    , notLF = /[^\r\n]+/g, notWhiteSpace = /\S/;
  function spaceN(str) {
    return ' '.repeat(str.length);
  }
  function onReplace(str) {
    switch (str[0]) {
    case '/': case '#':
      if (str[0] === "/*") {
        // replace comments with whitespace to preserve original character positions
        return str.replace(notLF, spaceN);
      }
      return spaceN(str);
    case '"': case "'": // falls through
    default:
      return str;
    }
  }
  function readJSON(fileName, throwError) {
    var text = readFile(fileName);
    text = text.replace(stringOrComment, onReplace);
    try {
      return notWhiteSpace.test(text) ? JSON.parse(text) : {};
    } catch (e) {
      if (throwError === true) {
        throw e;
      }
      var err = "Failed to parse file '" + fileName + "': " + e + ".";
      console.warn(err);
      return {};
    }
  }
  global._readJSON = readJSON;
}

function readJSON(fileName, throwError) {
  if (!global._readJSON) {
    _makeJSONReader();
  }
  return _readJSON(fileName, throwError);
}

function readCompilerOptions(tsConfigFile, throwError) {
  if (tsConfigFile.lastIndexOf(".json") !== tsConfigFile.length - 5) {
    tsConfigFile += ".json";
  }
  var config = readJSON(tsConfigFile);
  var opts = config ? config.compilerOptions || {} : null;
  if (opts && config.extends) {
    var baseFile = osPath.join(osPath.dirname(tsConfigFile), config.extends);
    var baseOptions = readCompilerOptions(baseFile, throwError);
    if (baseOptions) {
      for (var key in baseOptions) {
        if (baseOptions.hasOwnProperty(key) && !(key in opts)) {
          opts[key] = baseOptions[key];
        }
      }
    }
  }
  return opts;
}

function loadValidCompilerOptions(tsConfigFile, keepCustomOptions) {
  var opts = readCompilerOptions(tsConfigFile, true);
  if (!keepCustomOptions && (keepCustomOptions === false || !opts.typescript)) {
    delete opts.inferThisForObjectLiterals;
    delete opts.narrowFormat;
  }
  if (opts.noImplicitUseStrict) {
    opts.alwaysStrict = false;
  }
  opts.target = forcedESTarget || locally && opts.target || "es5";
  if (typescript && !opts.typescript) {
    opts.typescript = typescript;
  }
  DEST = opts.outDir;
  if (!DEST || DEST === ".") {
    DEST = opts.outDir = "dist";
  }
  JSDEST = osPath.join(DEST, ".build");
  enableSourceMap = !!opts.sourceMap && envSourceMap;
  willListFiles   = !!opts.listFiles;
  willListEmittedFiles = !!opts.listEmittedFiles;
  removeComments  = !!opts.removeComments;
  return opts;
}

function loadTypeScriptCompiler(path) {
  var typescript;
  path = path || compilerOptions.typescript || null;
  if (typeof path === "string") {
    var exists1 = fs.existsSync(path), exists = exists1 || fs.existsSync(path + ".js");
    if (!exists) {
      var dir = "./node_modules/" + path;
      exists1 = fs.existsSync(dir);
      if (exists1 || fs.existsSync(dir + ".js")) { path = dir; exists = true; }
    }
    if (exists) {
      if (exists1 && fs.statSync(path).isDirectory()) {
        path = osPath.join(path, "typescript");
      }
      try {
        typescript = require(path);
      } catch (e) {}
    }
    print('Load customized TypeScript compiler:', typescript != null ? "succeed" : "fail");
  }
  if (typescript == null) {
    typescript = require("typescript/lib/typescript");
  }
  return typescript;
}

function removeUnknownOptions() {
  var hasOwn = Object.prototype.hasOwnProperty, toDelete = [], key, val;
  for (var key in compilerOptions) {
    if (key === "typescript" || key === "__proto__") { continue; }
    if (!hasOwn.call(compilerOptions, key)) { continue; }
    var declared = typescript.optionDeclarations.some(function(i) {
      return i.name === key;
    });
    declared || toDelete.push(key);
  }
  for (var i = 0; i < toDelete.length; i++) {
    key = toDelete[i], val = compilerOptions[key];
    delete compilerOptions[key];
  }
  if (tsOptionsLogged) { return; }
  tsOptionsLogged = true;
  if (toDelete.length > 1) {
    print("Skip these TypeScript options:", toDelete.join(", "));
  } else if (toDelete.length === 1) {
    print("Skip the TypeScript option:", toDelete[0]);
  }
}

function print() {
  return logger.apply(null, arguments);
}

function checkAnyNewer(path, pathBase, dest, ext) {
  path = formatPath(path, pathBase);
  return new Promise(function(resolve, reject) {
    gulp.src(path, { base: pathBase })
      .pipe(newer(ext ? { dest: dest, ext: ext, } : { dest: dest, }))
      .pipe(gulpCheckEmpty(function(isEmpty) {
        resolve(!isEmpty);
      }))
    ;
  });
}

function gulpAllIfNotEmpty() {
  var Transform = require('stream').Transform;
  var b = new Transform({objectMode: true});
  var a = gulpCheckEmpty(function(isEmpty) {
    if (!isEmpty) {
      var arr = b.files;
      for (var i = 0; i < arr.length; i++) {
        this.push(arr[i]);
      }
    }
  });
  b.files = [];
  b._transform = function(srcFile, encoding, done) {
    this.files.push(srcFile);
    this.push(srcFile);
    done();
  };
  return {
    cond: a,
    prepare: b,
  };
}

function gulpCheckEmpty(callback, log) {
  var Transform = require('stream').Transform;
  var a = new Transform({objectMode: true});
  a._empty = true;
  a._transform = function(srcFile, encoding, done) {
    a._empty = false;
    done();
  };
  a._flush = function(done) {
    callback.call(a, a._empty);
    done();
  };
  return a;
}

function gulpMap(map) {
  var Transform = require('stream').Transform;
  var transformer = new Transform({objectMode: true});
  transformer._transform = function(srcFile, encoding, done) {
    var dest = map(srcFile);
    this.push(dest || srcFile);
    done();
  };
  transformer._flush = function(done) { done(); };
  return transformer;
}

function patchExtendClick(source) {
  if (locally && envLegacy) { return source; }
  print('Patch the extend_click module');
  source = source.replace(/(addEventListener|toString) ?: ?function \w+/g, "$1 "); // es6 member function
  let match = /\/: \?function \\w\+\/g, ?(""|'')/.exec(source);
  if (match) {
    const start = Math.max(0, match.index - 64), end = match.index;
    let prefix = source.substring(0, start), suffix = source.substring(end);
    source = source.substring(start, end).replace(/>= ?45/, "< 45").replace(/45 ?<=/, "45 >");
    suffix = '/\\b(addEventListener|toString) \\(/g, "$1:function $1("' + suffix.substring(match[0].length);
    source = prefix + source + suffix;
  }
  match = /' ?\+ ?\(?function VC ?\(/.exec(source);
  if (match) {
    let start = match.index, end = source.indexOf('}).toString()', start) + 1 || source.indexOf('}.toString()', start) + 1;
    let end2 = source.indexOf("')();'", end + 2) + 1 || source.indexOf('")();"', end + 2) + 1;
    if (end2 <= 0) {
      throw new Error('Can not find the end ".toString() + \')();\'" around the injected function.');
    }
    let prefix = source.substring(0, start), suffix = source.substring(end2 + ")();'".length);
    source = source.substring(start + match[0].length, end).replace(/ \/\/.*?$/g, "").replace(/'/g, '"');
    source = source.replace(/\\/g, "\\\\");
    if (locally) {
      source = source.replace(/([\r\n]) {4,8}/g, "$1").replace(/\r\n?|\n/g, "\\n\\\n");
    } else {
      source = source.replace(/[\r\n]\s*/g, "");
    }
    source = "function(" + source;
    source = prefix + source + ")();'" + suffix;
  } else {
    logger.error("Error: can not wrap extend_click scripts!!!");
  }
  return source;
}

var _gulpUglifyPatched = false;
function patchGulpUglify() {
  if (_gulpUglifyPatched) { return; }
  var path = "node_modules/gulp-uglify/lib/minify.js";
  var info = {};
  try {
    var minify_tmpl = readFile(path, info);
    if (! /nameCache\s*=/.test(minify_tmpl)) {
      minify_tmpl = minify_tmpl.replace(/\b(\w+)\s?=\s?setup\(([^)]+)\)(.*?);/, "$1 = setup($2)$3;\n      $1.nameCache = ($2).nameCache || null;");
      fs.writeFileSync(path, minify_tmpl);
      print("Patch gulp-uglify: succeed");
    }
  } catch (e) {
    logger.error("Error: Failed to patch gulp-uglify: " + e);
  }
  _gulpUglifyPatched = true;
}

var _uglifyjsConfig = null;
function loadUglifyConfig(reload) {
  let a = _uglifyjsConfig;
  if (a == null || reload) {
    a = readJSON("scripts/uglifyjs.json");
    if (!reload) {
      _uglifyjsConfig = a;
    }
    a.output || (a.output = {});
    var c = a.compress || (a.compress = {}), gd = c.global_defs || (c.global_defs = {});
    gd.NO_DIALOG_UI = !has_dialog_ui;
    if (typeof c.keep_fnames === "string") {
      let re = c.keep_fnames.match(/^\/(.*)\/([a-z]*)$/);
      c.keep_fnames = new RegExp(re[1], re[2]);
    }
    var m = a.mangle, p = m && m.properties;
    if (p && typeof p.regex === "string") {
      let re = p.regex.match(/^\/(.*)\/([a-z]*)$/);
      p.regex = new RegExp(re[1], re[2]);
    }
    if (m && typeof m.keep_fnames === "string") {
      let re = m.keep_fnames.match(/^\/(.*)\/([a-z]*)$/);
      m.keep_fnames = new RegExp(re[1], re[2]);
    }
    else if (m && !typeof m.keep_fnames) {
      m.keep_fnames = c.keep_fnames;
    }
  }
  a.output.comments = removeComments ? /^!/ : "all";
  return a;
}
